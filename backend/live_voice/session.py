"""Orchestrates mic, VAD, STT, streaming LLM, TTS, playback, and barge-in."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import numpy as np
import torch

from live_voice.audio_io import MicStream, PlaybackStream
from live_voice.default_prompt import DEFAULT_SYSTEM_PROMPT
from live_voice.errors import error_event
from live_voice.chat_title import FIRST_TURN_TITLE_INSTRUCTION, FirstTurnTitleParser
from live_voice.llm_client import (
    StreamChunk,
    reasoning_fallback_reply,
    resolve_llm_params,
    stream_chat_completions,
)
from live_voice.multimodal import (
    AttachmentDict,
    MultimodalError,
    attachments_root,
    build_user_content,
    check_multimodal_support,
    content_for_history,
    user_display_text,
)
from live_voice.knowledge import KnowledgeManager, build_reference_context
from live_voice.knowledge.context import resolve_active_file_ids
from live_voice.knowledge.fingerprint import (
    all_enabled_already_indexed,
    library_fingerprint,
)
from live_voice.protocol import server_event
from live_voice.stt import STTEngine
from live_voice.text_split import flush_tts_chunks, should_start_tts
from live_voice.tts_engine import TTSEngine
from live_voice.vad import SileroStreamVAD

logger = logging.getLogger(__name__)


def _normalize_audio_level(level: float) -> float:
    """Soft-knee: preserve quiet/moderate levels, tame only loud peaks."""
    x = max(0.0, min(1.0, float(level)))
    knee = 0.42
    if x <= knee:
        return x
    excess = x - knee
    return knee + float(np.tanh(excess * 2.8)) * 0.4


def _resample_linear(x: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr or x.size == 0:
        return x.astype(np.float32, copy=False)
    ratio = target_sr / orig_sr
    new_len = max(1, int(len(x) * ratio))
    idx = np.linspace(0.0, len(x) - 1, num=new_len, dtype=np.float64)
    y = np.interp(idx, np.arange(len(x), dtype=np.float64), x.astype(np.float64))
    return y.astype(np.float32)


CLIENT_MSG_TYPES = frozenset(
    {
        "config",
        "start",
        "stop",
        "interrupt",
        "ptt_down",
        "ptt_up",
        "user_text",
        "user_message",
        "knowledge_reindex",
    }
)

class VoiceSession:
    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self._running = False
        self._main_task: asyncio.Task[None] | None = None
        self.gen_id = 0
        self._messages: list[dict[str, Any]] = []
        self.cancel_turn = asyncio.Event()
        self._assistant_talking = False
        self._tts_playing = False
        self._last_level_ts = 0.0
        self._models_ready = False
        self._vad: SileroStreamVAD | None = None
        self._stt: STTEngine | None = None
        self._mic: MicStream | None = None
        self._playback: PlaybackStream | None = None
        self._tts: TTSEngine | None = None
        self._active_turn_task: asyncio.Task[None] | None = None
        self._pending_user_messages: list[tuple[str, list[AttachmentDict]]] = []
        self.config: dict[str, Any] = {
            "llm_provider": "lm_studio",
            "lm_base_url": "http://127.0.0.1:1234",
            "model": "local-model",
            "api_key": "",
            "max_context_tokens": 128_000,
            "chat_history": [],
            "push_to_talk": False,
            "input_gain": 1.0,
            "vad_sensitivity": 0.5,
            "system_prompt": DEFAULT_SYSTEM_PROMPT,
            "piper_model": "",
            "supertonic_voice": "",
            "supertonic_lang": "en",
            "supertonic_model": "supertonic-3",
            "models_root": "",
            "whisper_model": "small",
            # When True, mic VAD can interrupt the assistant (needs headphones to avoid echo).
            "vad_barge_in": False,
            # Boost TTS before enqueue (1.0 = unchanged). Helps quiet pyttsx3 WAVs.
            "playback_gain": 1.5,
        }
        self._ptt_active = False
        self._ptt_buffer: list[np.ndarray] = []
        self._vad_threshold_used = 0.5
        self._knowledge = KnowledgeManager()
        self._knowledge_text_cache: dict[str, str] = {}
        self._knowledge_revision_seen: int | None = None
        self._knowledge_library_fingerprint: str = ""
        self.config.setdefault("knowledge_mode", "off")
        self.config.setdefault("knowledge_selection", {"folder_ids": [], "file_ids": []})
        self.config.setdefault("knowledge_catalog", [])
        self.config.setdefault("knowledge_revision", 0)
        self.config.setdefault("knowledge_dir", "")
        self.config.setdefault("knowledge_index_dir", "")
        self.config.setdefault("chat_system_prompt", "")

    def _log_config_update(self) -> None:
        sp = str(self.config.get("system_prompt", ""))
        preview = (sp[:80] + "…") if len(sp) > 80 else sp
        km = str(self.config.get("knowledge_mode") or "off")
        sel = self.config.get("knowledge_selection")
        if not isinstance(sel, dict):
            sel = {}
        catalog = self.config.get("knowledge_catalog")
        if not isinstance(catalog, list):
            catalog = []
        n_files = len(
            resolve_active_file_ids(km, sel, catalog),
        )
        logger.info(
            "Config | provider=%s LLM base=%s chat_model=%r | history_turns=%d | whisper_model=%r | "
            "push_to_talk=%s vad_barge_in=%s input_gain=%.2f vad_sensitivity=%.2f | "
            "piper_model=%r | supertonic voice=%r lang=%r model=%r | "
            "knowledge_mode=%s active_files=%d knowledge_dir=%s | system_prompt[%d chars]=%s",
            self.config.get("llm_provider"),
            self.config.get("lm_base_url"),
            self.config.get("model"),
            len(self._messages),
            self.config.get("whisper_model"),
            self.config.get("push_to_talk"),
            self.config.get("vad_barge_in"),
            float(self.config.get("input_gain", 1.0)),
            float(self.config.get("vad_sensitivity", 0.5)),
            self.config.get("piper_model") or "",
            str(self.config.get("supertonic_voice") or ""),
            str(self.config.get("supertonic_lang") or "en"),
            str(self.config.get("supertonic_model") or "supertonic-3"),
            km,
            n_files,
            self._knowledge_root_dir() or "(unset)",
            len(sp),
            preview or "(empty)",
        )

    def _apply_chat_history(self, raw: Any) -> None:
        if not isinstance(raw, list):
            return
        out: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role not in ("user", "assistant"):
                continue
            if isinstance(content, list):
                out.append({"role": role, "content": content})
                continue
            if isinstance(content, str) and content.strip():
                if role == "user":
                    root = attachments_root(str(self.config.get("attachments_dir") or ""))
                    out.append(
                        {
                            "role": role,
                            "content": content_for_history(content.strip(), root=root),
                        },
                    )
                else:
                    out.append({"role": role, "content": content.strip()})
        self._messages = out
        logger.info("Loaded chat_history: %d messages", len(self._messages))

    def _log_pipeline_loaded(self) -> None:
        assert self._vad is not None and self._stt is not None and self._tts is not None
        logger.info(
            "Pipeline | VAD=Silero threshold=%.3f frame=%d @ 16 kHz (min_silence tuned via vad_sensitivity)",
            self._vad_threshold_used,
            self._vad.window_samples,
        )
        logger.info(
            "Pipeline | STT=openai-whisper checkpoint=%r torch_device=%s fp16=%s",
            self._stt.model_size,
            self._stt.device,
            getattr(self._stt, "_fp16", False),
        )
        logger.info(
            "Pipeline | LLM provider=%s base=%s model=%r history=%d",
            self.config.get("llm_provider"),
            str(self.config.get("lm_base_url", "")).rstrip("/"),
            self.config.get("model"),
            len(self._messages),
        )
        logger.info("Pipeline | TTS=%s", self._tts.backend_label)

    async def _maybe_emit_audio_level(self, source: str, level: float) -> None:
        now = time.monotonic()
        if now - self._last_level_ts < 0.032:
            return
        self._last_level_ts = now
        clamped = _normalize_audio_level(level)
        await self.send_json(
            server_event("audio_level", source=source, level=clamped),
        )

    async def _ensure_tts_speaking_state(self) -> None:
        if self._tts_playing:
            return
        self._tts_playing = True
        await self.send_json(server_event("state", state="speaking"))

    async def _wait_playback_done(self) -> None:
        if not self._playback:
            return
        quiet_ticks = 0
        while self._running:
            pending = self._playback.pending_samples()
            level = self._playback.output_level()
            if pending > 0 or level > 0.035:
                quiet_ticks = 0
                await self._maybe_emit_audio_level("tts", level)
                await asyncio.sleep(0.04)
            else:
                quiet_ticks += 1
                if quiet_ticks >= 4:
                    break
                await asyncio.sleep(0.04)

    async def send_json(self, obj: dict[str, Any]) -> None:
        try:
            await self.ws.send(json.dumps(obj))
        except Exception as exc:  # noqa: BLE001
            logger.debug("send_json failed: %s", exc)

    async def handle_client_msg(self, data: dict[str, Any]) -> None:
        mtype = data.get("type")
        if not isinstance(mtype, str):
            await self.send_json(
                server_event("notice", message="Ignored message: missing type field."),
            )
            return
        if mtype not in CLIENT_MSG_TYPES:
            await self.send_json(
                server_event("notice", message=f"Unknown message type: {mtype}"),
            )
            return
        if mtype == "config":
            for key in (
                "llm_provider",
                "lm_base_url",
                "model",
                "api_key",
                "max_context_tokens",
                "push_to_talk",
                "input_gain",
                "vad_sensitivity",
                "system_prompt",
                "piper_model",
                "whisper_model",
                "vad_barge_in",
                "supertonic_voice",
                "supertonic_lang",
                "supertonic_model",
                "models_root",
                "attachments_dir",
                "knowledge_mode",
                "knowledge_selection",
                "knowledge_catalog",
                "knowledge_revision",
                "knowledge_dir",
                "knowledge_index_dir",
                "chat_system_prompt",
            ):
                if key in data:
                    self.config[key] = data[key]
            self._sync_knowledge_env_from_config()
            if "chat_history" in data:
                self._apply_chat_history(data["chat_history"])
            rev = data.get("knowledge_revision")
            if isinstance(rev, int):
                self._knowledge_revision_seen = rev
            catalog = self.config.get("knowledge_catalog")
            if isinstance(catalog, list):
                fp = library_fingerprint(catalog)
                if not self._knowledge_library_fingerprint:
                    self._knowledge_library_fingerprint = (
                        self._knowledge._read_persisted_fingerprint()
                    )
                if fp and fp != self._knowledge_library_fingerprint:
                    mode = str(self.config.get("knowledge_mode") or "off")
                    if mode == "off" or all_enabled_already_indexed(catalog):
                        self._knowledge._persist_fingerprint(fp)
                        self._knowledge_library_fingerprint = fp
                        logger.info(
                            "Knowledge fingerprint synced (mode=%s), no rebuild",
                            mode,
                        )
                    else:
                        self._knowledge_library_fingerprint = fp
                        asyncio.create_task(
                            self._rebuild_knowledge_index(catalog),
                        )
            self._log_config_update()
            logger.info(
                "Config applied (TTS voice=%r lang=%r); send a message to reach the LLM",
                str(self.config.get("supertonic_voice") or ""),
                str(self.config.get("supertonic_lang") or "en"),
            )
            asyncio.create_task(self._warm_knowledge_cache())
            if self._models_ready:
                from live_voice.models_paths import (
                    resolve_models_root,
                    supertonic_model_dir,
                )

                if self._tts is not None:
                    self._tts.close()
                mroot = resolve_models_root(str(self.config.get("models_root") or ""))
                st_dir = supertonic_model_dir(
                    mroot,
                    str(self.config.get("supertonic_model") or "supertonic-3"),
                )
                self._tts = TTSEngine(
                    str(self.config.get("piper_model") or ""),
                    supertonic_voice=str(self.config.get("supertonic_voice") or ""),
                    supertonic_lang=str(self.config.get("supertonic_lang") or "en"),
                    supertonic_model=str(self.config.get("supertonic_model") or "supertonic-3"),
                    supertonic_model_dir=st_dir,
                )
                logger.info("Pipeline | TTS=%s", self._tts.backend_label)
            return
        if mtype == "start":
            await self.start()
            return
        if mtype == "stop":
            await self.stop()
            return
        if mtype == "interrupt":
            await self.interrupt()
            return
        if mtype == "user_text":
            raw = data.get("text")
            if isinstance(raw, str) and raw.strip():
                logger.info("WebSocket | user_text (%d chars)", len(raw.strip()))
                asyncio.create_task(self._enqueue_user_message(raw.strip(), []))
            return
        if mtype == "knowledge_reindex":
            catalog = self.config.get("knowledge_catalog")
            if isinstance(catalog, list):
                asyncio.create_task(self._rebuild_knowledge_index(catalog, force=True))
            else:
                await self.send_json(
                    server_event("notice", message="No knowledge catalog in config yet."),
                )
            return
        if mtype == "user_message":
            raw_text = data.get("text")
            text = raw_text.strip() if isinstance(raw_text, str) else ""
            attachments = self._parse_attachments(data.get("attachments"))
            if text or attachments:
                logger.info(
                    "WebSocket | user_message text=%d chars attachments=%d",
                    len(text),
                    len(attachments),
                )
                asyncio.create_task(self._enqueue_user_message(text, attachments))
            return
        if mtype == "ptt_down":
            self._ptt_active = True
            self._ptt_buffer.clear()
            await self.send_json(server_event("state", state="listening"))
            return
        if mtype == "ptt_up":
            self._ptt_active = False
            buf = self._ptt_buffer
            self._ptt_buffer = []
            if buf:
                audio = np.concatenate(buf)
                asyncio.create_task(self._enqueue_utterance(audio))
            return

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self.cancel_turn.clear()
        logger.info("Voice session start (main loop spawning)")
        self._main_task = asyncio.create_task(self._main_loop(), name="voice-main")

    async def stop(self) -> None:
        self._running = False
        self.cancel_turn.set()
        if self._main_task:
            self._main_task.cancel()
            try:
                await self._main_task
            except asyncio.CancelledError:
                pass
            self._main_task = None
        if self._mic:
            self._mic.stop()
        if self._playback:
            self._playback.stop()
        self._models_ready = False
        self._pending_user_messages.clear()
        if self._tts is not None:
            self._tts.close()
        self._vad = self._stt = self._mic = self._playback = self._tts = None
        logger.info("Voice session stop")
        await self.send_json(server_event("state", state="idle"))

    async def _cancel_active_turn(self) -> None:
        self.cancel_turn.set()
        if self._playback:
            self._playback.clear()
        task = self._active_turn_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._active_turn_task = None

    async def interrupt(self) -> None:
        await self._cancel_active_turn()
        if self._vad:
            self._vad.reset()
        self._assistant_talking = False
        self._tts_playing = False
        logger.info("Interrupt: cancelled turn, cleared playback")
        await self.send_json(server_event("interrupt_ack"))
        await self.send_json(server_event("state", state="listening"))

    async def shutdown(self) -> None:
        await self.stop()

    async def _ensure_models(self) -> None:
        if self._models_ready:
            return

        sens = float(self.config.get("vad_sensitivity", 0.5))
        thr = 0.85 - sens * 0.55
        thr = max(0.25, min(0.85, thr))
        self._vad_threshold_used = thr
        # Longer silence before end-of-utterance (avoids cutting off mid-sentence pauses).
        min_silence_ms = int(750 + (1.0 - sens) * 950)
        min_silence_ms = max(700, min(1800, min_silence_ms))

        # Whisper → numba → numpy C extensions: first import must run on the main
        # thread on Windows; importing from asyncio.to_thread breaks with
        # "numpy._core.multiarray failed to import" / "cannot load module more than once".
        import whisper  # noqa: PLC0415

        from live_voice.models_paths import (
            apply_models_env,
            resolve_models_root,
            supertonic_model_dir,
            whisper_download_root,
        )

        models_root = resolve_models_root(str(self.config.get("models_root") or ""))

        def _load() -> tuple[SileroStreamVAD, STTEngine]:
            apply_models_env(models_root)
            vad = SileroStreamVAD(
                threshold=thr,
                min_silence_duration_ms=min_silence_ms,
                speech_pad_ms=100,
            )
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_size = str(self.config.get("whisper_model", "small"))
            stt = STTEngine(
                model_size=model_size,
                device=device,
                download_root=whisper_download_root(models_root),
            )
            return vad, stt

        self._vad, self._stt = await asyncio.to_thread(_load)
        st_dir = supertonic_model_dir(
            models_root,
            str(self.config.get("supertonic_model") or "supertonic-3"),
        )
        self._tts = TTSEngine(
            str(self.config.get("piper_model") or ""),
            supertonic_voice=str(self.config.get("supertonic_voice") or ""),
            supertonic_lang=str(self.config.get("supertonic_lang") or "en"),
            supertonic_model=str(self.config.get("supertonic_model") or "supertonic-3"),
            supertonic_model_dir=st_dir,
        )
        self._models_ready = True
        self._log_pipeline_loaded()

    async def _main_loop(self) -> None:
        try:
            await self._ensure_models()
            assert self._vad is not None and self._stt is not None and self._tts is not None
            ws = self._vad.window_samples
            self._mic = MicStream(
                sample_rate=16_000,
                block_frames=ws,
                gain=float(self.config.get("input_gain", 1.0)),
            )
            self._playback = PlaybackStream(22_050)
            self._mic.start()
            self._playback.start()
            await self._flush_pending_user_messages()
            await self.send_json(server_event("state", state="listening"))

            in_speech = False
            speech_buffer: list[np.ndarray] = []

            while self._running:
                chunk = await asyncio.to_thread(self._mic.get_block, 0.25)
                if chunk is None or chunk.size == 0:
                    continue
                if chunk.size < ws:
                    chunk = np.pad(chunk, (0, ws - chunk.size))
                elif chunk.size > ws:
                    chunk = chunk[:ws]

                sd = self._vad.process(chunk)

                if not self._assistant_talking or in_speech:
                    rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))
                    mic_level = min(1.0, rms * 10.0)
                    if mic_level > 0.03 or in_speech or self._ptt_active:
                        await self._maybe_emit_audio_level("mic", mic_level)

                if (
                    self.config.get("vad_barge_in")
                    and self._assistant_talking
                    and sd is not None
                    and "start" in sd
                ):
                    await self.interrupt()
                    in_speech = True
                    speech_buffer = [chunk.copy()]
                    continue

                # Ignore VAD while assistant is playing (echo causes false end/start).
                if self._assistant_talking and not in_speech:
                    continue

                if self.config.get("push_to_talk"):
                    if self._ptt_active:
                        self._ptt_buffer.append(chunk.copy())
                    continue

                if sd is not None and "start" in sd:
                    in_speech = True
                    speech_buffer = [chunk.copy()]
                    await self.send_json(server_event("state", state="listening"))
                elif in_speech:
                    speech_buffer.append(chunk.copy())
                    if sd is not None and "end" in sd:
                        in_speech = False
                        audio = (
                            np.concatenate(speech_buffer)
                            if speech_buffer
                            else np.array([], dtype=np.float32)
                        )
                        speech_buffer.clear()
                        min_samples = int(16_000 * 0.28)
                        if audio.size >= min_samples:
                            asyncio.create_task(self._enqueue_utterance(audio))
                        elif audio.size > 0:
                            logger.debug(
                                "Dropped short utterance (%.0f ms)",
                                1000.0 * audio.size / 16_000.0,
                            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("main loop error")
            code = "mic_unavailable" if "PortAudio" in str(exc) or "device" in str(exc).lower() else "pipeline_failed"
            await self.send_json(error_event(str(exc), code=code))
        finally:
            if self._mic:
                self._mic.stop()
            if self._playback:
                self._playback.stop()

    async def _enqueue_utterance(self, audio: np.ndarray) -> None:
        if not self._running:
            return
        await self._cancel_active_turn()
        self.gen_id += 1
        turn = self.gen_id
        self.cancel_turn.clear()

        async def _run() -> None:
            try:
                await self._process_utterance(audio, turn)
            except asyncio.CancelledError:
                logger.info("Turn %s utterance cancelled", turn)
                raise

        self._active_turn_task = asyncio.create_task(_run())

    @staticmethod
    def _parse_attachments(raw: Any) -> list[AttachmentDict]:
        if not isinstance(raw, list):
            return []
        out: list[AttachmentDict] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            path = item.get("path")
            kind = item.get("kind")
            if isinstance(path, str) and path.strip() and isinstance(kind, str):
                out.append(
                    {
                        "id": str(item.get("id") or ""),
                        "kind": kind.strip().lower(),
                        "mime": str(item.get("mime") or ""),
                        "path": path.strip(),
                        "filename": str(item.get("filename") or ""),
                    },
                )
        return out

    async def _flush_pending_user_messages(self) -> None:
        if not self._pending_user_messages or not self._playback or not self._tts:
            return
        batch = self._pending_user_messages[:]
        self._pending_user_messages.clear()
        logger.info("Flushing %d queued user_message(s)", len(batch))
        for text, attachments in batch:
            await self._enqueue_user_message(text, attachments, _from_queue=True)

    async def _enqueue_user_message(
        self,
        text: str,
        attachments: list[AttachmentDict],
        *,
        _from_queue: bool = False,
    ) -> None:
        if not self._playback or not self._tts:
            if not _from_queue:
                self._pending_user_messages.append((text, attachments))
                logger.info(
                    "Queued user_message until pipeline ready (pending=%d)",
                    len(self._pending_user_messages),
                )
                await self.send_json(
                    server_event(
                        "notice",
                        message="Session still starting—your message is queued.",
                    ),
                )
            return
        if not self._running:
            return
        await self._cancel_active_turn()
        self.gen_id += 1
        turn = self.gen_id
        self.cancel_turn.clear()

        async def _run() -> None:
            try:
                await self._process_user_message(text, attachments, turn)
            except asyncio.CancelledError:
                logger.info("Turn %s user_message cancelled", turn)
                raise

        self._active_turn_task = asyncio.create_task(_run())

    async def _rebuild_knowledge_index(
        self,
        catalog: list[Any],
        *,
        force: bool = False,
    ) -> None:
        async def _notice(msg: str) -> None:
            await self.send_json(server_event("notice", message=msg))

        result = await self._knowledge.rebuild(
            catalog,
            send_notice=_notice,
            force=force,
        )
        if result.get("ok"):
            if result.get("skipped"):
                return
            await self.send_json(
                server_event(
                    "notice",
                    message=f"knowledge_index_ready:{result.get('doc_count', 0)}",
                ),
            )

    async def _emit_context_usage(self, usage: dict[str, int]) -> None:
        max_ctx = int(self.config.get("max_context_tokens") or 128_000)
        total = int(usage.get("total_tokens") or 0)
        pct = round((total / max_ctx) * 100.0, 2) if max_ctx > 0 else 0.0
        await self.send_json(
            server_event(
                "context_usage",
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                total_tokens=total,
                max_context_tokens=max_ctx,
                percent=pct,
            ),
        )

    def _knowledge_root_dir(self) -> str:
        cfg = str(self.config.get("knowledge_dir") or "").strip()
        if cfg:
            return cfg
        return os.environ.get("LIVE_VOICE_KNOWLEDGE_DIR", "").strip()

    def _knowledge_index_dir(self) -> str:
        cfg = str(self.config.get("knowledge_index_dir") or "").strip()
        if cfg:
            return cfg
        return os.environ.get("LIVE_VOICE_KNOWLEDGE_INDEX_DIR", "").strip()

    def _sync_knowledge_env_from_config(self) -> None:
        """Keep KnowledgeManager env in sync when sidecar was started without Tauri env."""
        root = self._knowledge_root_dir()
        index = self._knowledge_index_dir()
        if root:
            os.environ["LIVE_VOICE_KNOWLEDGE_DIR"] = root
        if index:
            os.environ["LIVE_VOICE_KNOWLEDGE_INDEX_DIR"] = index

    def _knowledge_paths(self) -> tuple[str, dict[str, Any], list[Any]]:
        selection = self.config.get("knowledge_selection")
        if not isinstance(selection, dict):
            selection = {}
        catalog = self.config.get("knowledge_catalog")
        if not isinstance(catalog, list):
            catalog = []
        return self._knowledge_root_dir(), selection, catalog

    def _build_reference_knowledge_sync(self, query: str) -> str:
        from pathlib import Path

        root_raw, selection, catalog = self._knowledge_paths()
        mode = str(self.config.get("knowledge_mode") or "off")
        if not root_raw:
            logger.warning(
                "Knowledge dir not set (config knowledge_dir and LIVE_VOICE_KNOWLEDGE_DIR both empty)"
            )
            return ""
        return build_reference_context(
            query,
            mode=mode,
            selection=selection,
            catalog=catalog,
            knowledge_dir=Path(root_raw),
            manager=self._knowledge,
            text_cache=self._knowledge_text_cache,
            prefer_fast=True,
        )

    async def _build_reference_knowledge(self, query: str) -> str:
        return await asyncio.to_thread(self._build_reference_knowledge_sync, query)

    def _compose_system_prompt(self, reference: str) -> str:
        """Global system_prompt + per-chat addon + reply language + reference knowledge."""
        parts: list[str] = []
        base = str(self.config.get("system_prompt") or "").strip()
        if base:
            parts.append(base)
        addon = str(self.config.get("chat_system_prompt") or "").strip()
        if addon:
            parts.append(addon)
        lang = str(self.config.get("supertonic_lang") or "en").strip().lower() or "en"
        if lang != "en":
            parts.append(
                f"Reply to the user primarily in language code {lang!r} "
                "(match their language when possible). Keep answers short for voice.",
            )
        ref = (reference or "").strip()
        if ref:
            parts.append(ref)
        return "\n\n".join(parts)

    async def _warm_knowledge_cache(self) -> None:
        from pathlib import Path

        root_raw, selection, catalog = self._knowledge_paths()
        mode = str(self.config.get("knowledge_mode") or "off")
        if mode == "off" or not root_raw or not catalog:
            return
        file_ids = resolve_active_file_ids(mode, selection, catalog)
        if not file_ids:
            return
        by_id = {str(e["id"]): e for e in catalog if e.get("id")}

        def _load_one(fid: str) -> tuple[str, str]:
            entry = by_id.get(fid)
            if not entry:
                return fid, ""
            from live_voice.knowledge.context import _read_full_text

            text = _read_full_text(
                Path(root_raw),
                entry,
                text_cache=self._knowledge_text_cache,
                prefer_fast=True,
            )
            return fid, text

        results = await asyncio.gather(
            *[asyncio.to_thread(_load_one, fid) for fid in file_ids],
            return_exceptions=True,
        )
        loaded = 0
        for item in results:
            if isinstance(item, tuple) and item[1].strip():
                loaded += 1
        logger.info(
            "Knowledge cache warm | mode=%s files=%d loaded=%d",
            mode,
            len(file_ids),
            loaded,
        )
        if loaded == 0:
            await self.send_json(
                server_event(
                    "notice",
                    message=(
                        "Reference knowledge is on but no text could be read from the selected "
                        "file(s). Rebuild index on the Knowledge page or re-import the PDF."
                    ),
                ),
            )

    async def _respond_to_user_turn(
        self,
        text: str,
        attachments: list[AttachmentDict],
        turn: int,
        *,
        from_stt: bool = False,
    ) -> None:
        assert self._tts is not None and self._playback is not None
        display = user_display_text(text, attachments)
        await self.send_json(server_event("stt_final", text=display))
        await self.send_json(server_event("state", state="thinking"))

        provider = str(self.config.get("llm_provider") or "lm_studio")
        params = resolve_llm_params(
            provider,
            str(self.config.get("model") or "local-model"),
            str(self.config.get("lm_base_url") or "http://127.0.0.1:1234"),
            str(self.config.get("api_key") or ""),
        )

        attach_root = attachments_root(str(self.config.get("attachments_dir") or ""))
        try:
            check_multimodal_support(params.model, attachments)
            user_content = build_user_content(text, attachments, root=attach_root)
        except MultimodalError as exc:
            logger.warning("Multimodal error: %s (attachments_dir=%r)", exc, self.config.get("attachments_dir"))
            await self.send_json(error_event(str(exc), code=exc.code))
            return

        reference = await self._build_reference_knowledge(text or display)
        is_first_turn = len(self._messages) == 0
        system_prompt = self._compose_system_prompt(reference)
        if is_first_turn:
            system_prompt = f"{system_prompt}\n\n{FIRST_TURN_TITLE_INSTRUCTION}".strip()
        if reference:
            logger.info(
                "Turn %s | Injected reference knowledge (%d chars, mode=%s)",
                turn,
                len(reference),
                self.config.get("knowledge_mode"),
            )
        elif str(self.config.get("knowledge_mode") or "off") != "off":
            logger.warning(
                "Turn %s | knowledge_mode=%s but reference block empty (check selection and files on disk)",
                turn,
                self.config.get("knowledge_mode"),
            )
            await self.send_json(
                server_event(
                    "notice",
                    message=(
                        "Could not load reference knowledge for this turn. "
                        "Check the file exists, then Rebuild index on the Knowledge page."
                    ),
                ),
            )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]
        messages.extend(self._messages)
        messages.append({"role": "user", "content": user_content})

        self._assistant_talking = True
        self._tts_playing = False

        full_reply = ""
        reasoning_accum = ""
        tts_buffer = ""
        tts_started = False
        tts_first_token_ts: float | None = None
        title_parser = FirstTurnTitleParser() if is_first_turn else None
        max_tokens = int(self.config.get("max_context_tokens") or 128_000)
        logger.info(
            "Turn %s | LLM stream provider=%s model=%r history=%d attachments=%d stt=%s",
            turn,
            provider,
            self.config.get("model"),
            len(self._messages),
            len(attachments),
            from_stt,
        )
        usage_out: dict[str, int] | None = None
        try:
            async for chunk in stream_chat_completions(
                provider,
                str(self.config.get("model") or "local-model"),
                str(self.config.get("lm_base_url") or "http://127.0.0.1:1234"),
                str(self.config.get("api_key") or ""),
                messages,
                self.cancel_turn,
                max_tokens=max_tokens,
            ):
                if self.cancel_turn.is_set() or turn != self.gen_id:
                    break
                if isinstance(chunk, StreamChunk):
                    if chunk.reasoning:
                        reasoning_accum += chunk.reasoning
                        await self.send_json(
                            server_event("llm_reasoning_token", text=chunk.reasoning),
                        )
                    if chunk.text:
                        emit_text = chunk.text
                        if title_parser is not None:
                            emit_text = title_parser.feed(chunk.text)
                        if not emit_text:
                            continue
                        if tts_first_token_ts is None:
                            tts_first_token_ts = time.monotonic()
                        full_reply += emit_text
                        await self.send_json(server_event("llm_token", text=emit_text))
                        tts_buffer += emit_text
                        elapsed_s = (
                            0.0
                            if tts_first_token_ts is None
                            else max(0.0, time.monotonic() - tts_first_token_ts)
                        )
                        if not tts_started:
                            tts_started = should_start_tts(tts_buffer, elapsed_s)
                        if not tts_started:
                            continue
                        await self._ensure_tts_speaking_state()
                        chunks, tts_buffer = flush_tts_chunks(tts_buffer)
                        for c in chunks:
                            if self.cancel_turn.is_set() or turn != self.gen_id:
                                break
                            await self._speak_chunk(c, turn)
                    if chunk.usage:
                        usage_out = chunk.usage
        except Exception as exc:  # noqa: BLE001
            logger.exception("LLM request failed")
            await self.send_json(error_event(str(exc), code="lm_unreachable"))
            return

        if title_parser is not None:
            tail = title_parser.flush()
            if tail:
                full_reply += tail
                await self.send_json(server_event("llm_token", text=tail))
                tts_buffer += tail

        reply = full_reply.strip()
        chat_title = title_parser.title if title_parser else None
        if not reply and reasoning_accum.strip():
            fallback = reasoning_fallback_reply(reasoning_accum)
            if fallback:
                reply = fallback
                logger.info(
                    "Turn %s | Using reasoning fallback reply (%d chars)",
                    turn,
                    len(reply),
                )

        if not self.cancel_turn.is_set() and turn == self.gen_id and tts_buffer.strip():
            await self._ensure_tts_speaking_state()
            await self._speak_chunk(tts_buffer.strip(), turn)
        elif (
            not self.cancel_turn.is_set()
            and turn == self.gen_id
            and reply
            and not full_reply.strip()
        ):
            await self._ensure_tts_speaking_state()
            await self._speak_chunk(reply, turn)

        if reply and not self.cancel_turn.is_set() and turn == self.gen_id:
            self._messages.append({"role": "user", "content": user_content})
            self._messages.append({"role": "assistant", "content": reply})
            assistant_fields: dict[str, Any] = {
                "text": reply,
                "user_display": display,
            }
            if chat_title:
                assistant_fields["chat_title"] = chat_title
            await self.send_json(
                server_event("assistant_text", **assistant_fields),
            )
            if chat_title:
                logger.info("Turn %s | Chat title from first reply: %r", turn, chat_title)
            logger.info("Turn %s | Assistant reply length=%d chars", turn, len(reply))
            if usage_out:
                await self._emit_context_usage(usage_out)

    async def _process_user_message(
        self,
        text: str,
        attachments: list[AttachmentDict],
        turn: int,
    ) -> None:
        assert self._tts is not None and self._playback is not None
        if not text.strip() and not attachments:
            return
        try:
            logger.info(
                "Turn %s | User message text=%d chars attachments=%d",
                turn,
                len(text.strip()),
                len(attachments),
            )
            await self._respond_to_user_turn(text, attachments, turn, from_stt=False)
        finally:
            if turn == self.gen_id and not self.cancel_turn.is_set():
                await self._wait_playback_done()
                self._assistant_talking = False
                self._tts_playing = False
                if self._running:
                    await self.send_json(server_event("state", state="listening"))
            elif turn == self.gen_id:
                self._assistant_talking = False
                self._tts_playing = False

    async def _process_utterance(self, audio: np.ndarray, turn: int) -> None:
        assert self._stt is not None and self._tts is not None and self._playback is not None
        try:
            dur_s = float(audio.size) / 16_000.0
            logger.info("Turn %s | STT: openai-whisper on %.2fs of audio", turn, dur_s)
            try:
                text = await asyncio.to_thread(self._stt.transcribe, audio, 16_000)
            except Exception as exc:  # noqa: BLE001
                logger.exception("STT failed")
                await self.send_json(error_event(str(exc), code="stt_failed"))
                return
            if self.cancel_turn.is_set() or turn != self.gen_id:
                return
            if not text:
                return
            await self._respond_to_user_turn(text, [], turn, from_stt=True)
        finally:
            if turn == self.gen_id and not self.cancel_turn.is_set():
                await self._wait_playback_done()
                self._assistant_talking = False
                self._tts_playing = False
                if self._running:
                    await self.send_json(server_event("state", state="listening"))
            elif turn == self.gen_id:
                self._assistant_talking = False
                self._tts_playing = False

    async def _speak_chunk(self, chunk_text: str, turn: int) -> None:
        assert self._tts is not None and self._playback is not None
        try:
            async for pcm, sr in self._tts.speak_text_stream(chunk_text):
                if self.cancel_turn.is_set() or turn != self.gen_id:
                    return
                out = _resample_linear(pcm, sr, 22_050)
                if out.ndim == 2:
                    out = out.mean(axis=1)
                gain = float(self.config.get("playback_gain", 1.5))
                if gain != 1.0 and out.size:
                    out = np.clip(out.astype(np.float32) * gain, -1.0, 1.0)
                peak = float(np.max(np.abs(out))) if out.size else 0.0
                rms = (
                    float(np.sqrt(np.mean(out.astype(np.float64) ** 2)))
                    if out.size
                    else 0.0
                )
                tts_level = min(1.0, rms * 4.5 + peak * 0.65)
                logger.info(
                    "TTS playback | samples=%d peak=%.4f rms=%.4f gain=%.2f",
                    int(out.size),
                    peak,
                    rms,
                    gain,
                )
                await asyncio.to_thread(self._playback.enqueue, out)
                await self._maybe_emit_audio_level("tts", tts_level)
        except Exception as exc:  # noqa: BLE001
            logger.exception("TTS failed")
            await self.send_json(error_event(f"TTS: {exc}", code="tts_failed"))
