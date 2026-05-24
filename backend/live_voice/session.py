"""Orchestrates mic, VAD, STT, streaming LLM, TTS, playback, and barge-in."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import numpy as np
import torch

from live_voice.audio_io import MicStream, PlaybackStream
from live_voice.errors import error_event
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
from live_voice.protocol import server_event
from live_voice.stt import STTEngine
from live_voice.text_split import flush_tts_chunks
from live_voice.tts_engine import TTSEngine
from live_voice.vad import SileroStreamVAD

logger = logging.getLogger(__name__)


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
        self._models_ready = False
        self._vad: SileroStreamVAD | None = None
        self._stt: STTEngine | None = None
        self._mic: MicStream | None = None
        self._playback: PlaybackStream | None = None
        self._tts: TTSEngine | None = None
        self._turn_lock = asyncio.Lock()
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
            "system_prompt": (
                "You are a helpful English assistant. The user may speak (message is speech-to-text) "
                "or type. When input is STT, interpret charitably (accent, noise, filler, informal phrasing). "
                "When typed, follow their wording more literally unless obviously mistaken.\n\n"
                "Always answer what they asked and stay on topic. Do not change the subject or add unrelated tangents.\n\n"
                "Replies are read aloud by TTS: usually one to three short sentences, plain language. "
                "No markdown, bullet lists, or long monologues unless they clearly ask for detail.\n\n"
                "If you truly cannot infer what they want, ask one brief clarifying question. Do not refuse with vague "
                "non-answers when a reasonable reply is still possible.\n\n"
                "Do not mention Whisper, transcription, or that you are an AI unless they ask.\n\n"
                "If they ask which model you are, answer briefly in neutral terms; do not recite marketing "
                "blurbs or long vendor descriptions unless they explicitly ask for details."
            ),
            "piper_model": "",
            "supertonic_voice": "",
            "supertonic_lang": "en",
            "supertonic_model": "supertonic-3",
            "whisper_model": "small",
            # When True, mic VAD can interrupt the assistant (needs headphones to avoid echo).
            "vad_barge_in": False,
            # Boost TTS before enqueue (1.0 = unchanged). Helps quiet pyttsx3 WAVs.
            "playback_gain": 1.5,
        }
        self._ptt_active = False
        self._ptt_buffer: list[np.ndarray] = []
        self._vad_threshold_used = 0.5

    def _log_config_update(self) -> None:
        sp = str(self.config.get("system_prompt", ""))
        preview = (sp[:80] + "…") if len(sp) > 80 else sp
        logger.info(
            "Config | provider=%s LLM base=%s chat_model=%r | history_turns=%d | whisper_model=%r | "
            "push_to_talk=%s vad_barge_in=%s input_gain=%.2f vad_sensitivity=%.2f | "
            "piper_model=%r | supertonic voice=%r lang=%r model=%r | system_prompt[%d chars]=%s",
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
            "Pipeline | VAD=Silero (torch.hub snakers4/silero-vad) threshold=%.3f frame=%d samples @ 16 kHz",
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
                "attachments_dir",
            ):
                if key in data:
                    self.config[key] = data[key]
            if "chat_history" in data:
                self._apply_chat_history(data["chat_history"])
            self._log_config_update()
            if self._models_ready:
                if self._tts is not None:
                    self._tts.close()
                self._tts = TTSEngine(
                    str(self.config.get("piper_model") or ""),
                    supertonic_voice=str(self.config.get("supertonic_voice") or ""),
                    supertonic_lang=str(self.config.get("supertonic_lang") or "en"),
                    supertonic_model=str(self.config.get("supertonic_model") or "supertonic-3"),
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
        if self._tts is not None:
            self._tts.close()
        self._vad = self._stt = self._mic = self._playback = self._tts = None
        logger.info("Voice session stop")
        await self.send_json(server_event("state", state="idle"))

    async def interrupt(self) -> None:
        self.cancel_turn.set()
        if self._playback:
            self._playback.clear()
        if self._vad:
            self._vad.reset()
        self._assistant_talking = False
        logger.info("Interrupt: cancelled turn, cleared playback")
        await self.send_json(server_event("interrupt_ack"))
        await self.send_json(server_event("state", state="listening"))

    async def shutdown(self) -> None:
        await self.stop()

    async def _ensure_models(self) -> None:
        if self._models_ready:
            return

        thr = 0.85 - float(self.config.get("vad_sensitivity", 0.5)) * 0.55
        thr = max(0.25, min(0.85, thr))
        self._vad_threshold_used = thr

        # Whisper → numba → numpy C extensions: first import must run on the main
        # thread on Windows; importing from asyncio.to_thread breaks with
        # "numpy._core.multiarray failed to import" / "cannot load module more than once".
        import whisper  # noqa: PLC0415

        def _load() -> tuple[SileroStreamVAD, STTEngine]:
            vad = SileroStreamVAD(threshold=thr)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_size = str(self.config.get("whisper_model", "small"))
            stt = STTEngine(model_size=model_size, device=device)
            return vad, stt

        self._vad, self._stt = await asyncio.to_thread(_load)
        self._tts = TTSEngine(
            str(self.config.get("piper_model") or ""),
            supertonic_voice=str(self.config.get("supertonic_voice") or ""),
            supertonic_lang=str(self.config.get("supertonic_lang") or "en"),
            supertonic_model=str(self.config.get("supertonic_model") or "supertonic-3"),
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

                if (
                    self.config.get("vad_barge_in")
                    and self._assistant_talking
                    and sd is not None
                    and "start" in sd
                ):
                    await self.interrupt()
                    in_speech = False
                    speech_buffer.clear()
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
                        audio = np.concatenate(speech_buffer) if speech_buffer else np.array([], dtype=np.float32)
                        speech_buffer.clear()
                        if audio.size > 0:
                            asyncio.create_task(self._enqueue_utterance(audio))
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
        async with self._turn_lock:
            if not self._running:
                return
            self.gen_id += 1
            turn = self.gen_id
            self.cancel_turn.clear()
            await self._process_utterance(audio, turn)

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

    async def _enqueue_user_message(
        self,
        text: str,
        attachments: list[AttachmentDict],
    ) -> None:
        if not self._playback or not self._tts:
            logger.warning("user_message ignored: session pipeline not ready yet")
            await self.send_json(
                server_event("notice", message="Session still starting—wait until listening, then try again."),
            )
            return
        async with self._turn_lock:
            if not self._running:
                return
            self.gen_id += 1
            turn = self.gen_id
            self.cancel_turn.clear()
            await self._process_user_message(text, attachments, turn)

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

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": str(self.config.get("system_prompt", ""))},
            *self._messages,
            {"role": "user", "content": user_content},
        ]

        self._assistant_talking = True
        await self.send_json(server_event("state", state="speaking"))

        full_reply = ""
        reasoning_accum = ""
        tts_buffer = ""
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
                        full_reply += chunk.text
                        await self.send_json(server_event("llm_token", text=chunk.text))
                        tts_buffer += chunk.text
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

        reply = full_reply.strip()
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
            await self._speak_chunk(tts_buffer.strip(), turn)
        elif (
            not self.cancel_turn.is_set()
            and turn == self.gen_id
            and reply
            and not full_reply.strip()
        ):
            await self._speak_chunk(reply, turn)

        if reply and not self.cancel_turn.is_set() and turn == self.gen_id:
            self._messages.append({"role": "user", "content": user_content})
            self._messages.append({"role": "assistant", "content": reply})
            await self.send_json(
                server_event(
                    "assistant_text",
                    text=reply,
                    user_display=display,
                ),
            )
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
            self._assistant_talking = False
            if self._running:
                await self.send_json(server_event("state", state="listening"))

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
            self._assistant_talking = False
            if self._running:
                await self.send_json(server_event("state", state="listening"))

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
                logger.info(
                    "TTS playback | samples=%d peak=%.4f gain=%.2f",
                    int(out.size),
                    peak,
                    gain,
                )
                await asyncio.to_thread(self._playback.enqueue, out)
        except Exception as exc:  # noqa: BLE001
            logger.exception("TTS failed")
            await self.send_json(error_event(f"TTS: {exc}", code="tts_failed"))
