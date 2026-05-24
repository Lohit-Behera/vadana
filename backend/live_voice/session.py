"""Orchestrates mic, VAD, STT, streaming LLM, TTS, playback, and barge-in."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
import numpy as np
import torch

from live_voice.audio_io import MicStream, PlaybackStream
from live_voice.errors import error_event
from live_voice.llm_client import stream_chat_completions
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
    {"config", "start", "stop", "interrupt", "ptt_down", "ptt_up", "user_text"}
)

class VoiceSession:
    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self._running = False
        self._main_task: asyncio.Task[None] | None = None
        self._http: httpx.AsyncClient | None = None
        self.gen_id = 0
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
            "lm_base_url": "http://127.0.0.1:1234",
            "model": "local-model",
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
            "Config | LLM base=%s chat_model=%r | whisper_model=%r | "
            "push_to_talk=%s vad_barge_in=%s input_gain=%.2f vad_sensitivity=%.2f | "
            "piper_model=%r | supertonic voice=%r lang=%r model=%r | system_prompt[%d chars]=%s",
            self.config.get("lm_base_url"),
            self.config.get("model"),
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
            "Pipeline | LLM=%s + /v1/chat/completions model_id=%r",
            str(self.config.get("lm_base_url", "")).rstrip("/"),
            self.config.get("model"),
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
                "lm_base_url",
                "model",
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
            ):
                if key in data:
                    self.config[key] = data[key]
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
                asyncio.create_task(self._enqueue_typed_message(raw))
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
        self._http = httpx.AsyncClient()
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
        if self._http:
            await self._http.aclose()
            self._http = None
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

    async def _enqueue_typed_message(self, raw: str) -> None:
        if not self._playback or not self._tts or not self._http:
            logger.warning("user_text ignored: session pipeline not ready yet")
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
            await self._process_typed_message(raw, turn)

    async def _respond_to_user_text(self, text: str, turn: int) -> None:
        assert self._http is not None and self._tts is not None and self._playback is not None
        await self.send_json(server_event("stt_final", text=text))
        await self.send_json(server_event("state", state="thinking"))

        messages = [
            {"role": "system", "content": str(self.config.get("system_prompt", ""))},
            {"role": "user", "content": text},
        ]

        self._assistant_talking = True
        await self.send_json(server_event("state", state="speaking"))

        full_reply = ""
        tts_buffer = ""
        base = str(self.config["lm_base_url"]).rstrip("/")
        mid = str(self.config["model"])
        logger.info(
            "Turn %s | LLM stream: POST %s/v1/chat/completions model=%r",
            turn,
            base,
            mid,
        )
        try:
            async for token in stream_chat_completions(
                self._http,
                str(self.config["lm_base_url"]),
                str(self.config["model"]),
                messages,
                self.cancel_turn,
            ):
                if self.cancel_turn.is_set() or turn != self.gen_id:
                    break
                full_reply += token
                await self.send_json(server_event("llm_token", text=token))
                tts_buffer += token
                chunks, tts_buffer = flush_tts_chunks(tts_buffer)
                for c in chunks:
                    if self.cancel_turn.is_set() or turn != self.gen_id:
                        break
                    await self._speak_chunk(c, turn)
        except httpx.HTTPError as exc:
            logger.exception("LLM request failed")
            await self.send_json(error_event(str(exc), code="lm_unreachable"))
            return

        if not self.cancel_turn.is_set() and turn == self.gen_id and tts_buffer.strip():
            await self._speak_chunk(tts_buffer.strip(), turn)

        if full_reply.strip():
            await self.send_json(server_event("assistant_text", text=full_reply.strip()))
            logger.info(
                "Turn %s | Assistant reply length=%d chars",
                turn,
                len(full_reply.strip()),
            )

    async def _process_typed_message(self, raw: str, turn: int) -> None:
        assert self._http is not None and self._tts is not None and self._playback is not None
        text = raw.strip()
        if not text:
            return
        try:
            logger.info("Turn %s | User message (typed), %d chars", turn, len(text))
            await self._respond_to_user_text(text, turn)
        finally:
            self._assistant_talking = False
            if self._running:
                await self.send_json(server_event("state", state="listening"))

    async def _process_utterance(self, audio: np.ndarray, turn: int) -> None:
        assert self._stt is not None and self._http is not None and self._tts is not None and self._playback is not None
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
            await self._respond_to_user_text(text, turn)
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
