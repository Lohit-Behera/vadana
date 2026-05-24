"""Pluggable local TTS: Supertonic (optional), Piper CLI, else pyttsx3 (Windows)."""

from __future__ import annotations

import asyncio
import concurrent.futures
import io
import logging
import shutil
import tempfile
import wave
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import numpy as np

_log = logging.getLogger(__name__)


def _supertonic_importable() -> bool:
    """True only if Supertone's ``supertonic`` package is installed and importable."""
    try:
        from supertonic import TTS  # noqa: F401
    except ImportError:
        return False
    return True


def _wav_bytes_to_float32_mono(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)
    if sw == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sw == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Unsupported WAV sample width: {sw}")
    if nch > 1:
        samples = samples.reshape(-1, nch).mean(axis=1)
    return samples.astype(np.float32), sr


class TTSEngine:
    """Synthesize sentence-sized text to float32 mono PCM chunks."""

    def __init__(
        self,
        piper_model: str | None = None,
        *,
        supertonic_voice: str | None = None,
        supertonic_lang: str = "en",
        supertonic_model: str = "supertonic-3",
    ) -> None:
        self.piper_model = piper_model or ""
        self._piper = shutil.which("piper")
        self.supertonic_voice = (supertonic_voice or "").strip()
        self.supertonic_lang = (supertonic_lang or "en").strip() or "en"
        self.supertonic_model = (supertonic_model or "supertonic-3").strip() or "supertonic-3"
        self._supertonic_tts: Any = None
        self._supertonic_style: Any = None

        self._use_supertonic = bool(self.supertonic_voice) and _supertonic_importable()
        if self.supertonic_voice and not self._use_supertonic:
            _log.warning(
                "Supertonic voice %r requested but `supertonic` failed to import (check `uv sync` / venv). "
                "Falling back to Piper or pyttsx3. See backend README.",
                self.supertonic_voice,
            )

        if self._use_supertonic:
            self.backend_label = (
                f"supertonic (model={self.supertonic_model!r}, voice={self.supertonic_voice!r}, "
                f"lang={self.supertonic_lang!r})"
            )
        elif self._piper and self.piper_model and Path(self.piper_model).is_file():
            self.backend_label = f"piper (exe={self._piper!r}, onnx={self.piper_model!r})"
        else:
            self.backend_label = "pyttsx3 (Windows SAPI)"
        _log.info("TTS: %s", self.backend_label)
        # One worker thread for pyttsx3 + COM + SAPI: default asyncio pool can hop threads and
        # break COM; reusing one Engine on SAPI often deadlocks on the second save_to_file while
        # the session holds the turn lock—so each utterance uses a fresh init() on this thread.
        self._pyttsx3_executor: concurrent.futures.ThreadPoolExecutor | None = None
        self._pyttsx3_com_initialized = False

    def _pyttsx3_worker(self) -> concurrent.futures.ThreadPoolExecutor:
        if self._pyttsx3_executor is None:
            self._pyttsx3_executor = concurrent.futures.ThreadPoolExecutor(
                max_workers=1,
                thread_name_prefix="pyttsx3-tts",
            )
        return self._pyttsx3_executor

    def close(self) -> None:
        """Release pyttsx3 worker thread (call when replacing or stopping the session)."""
        if self._pyttsx3_executor is not None:
            self._pyttsx3_executor.shutdown(wait=False, cancel_futures=False)
            self._pyttsx3_executor = None
        self._pyttsx3_com_initialized = False
        self._supertonic_tts = None
        self._supertonic_style = None

    def _ensure_supertonic(self) -> Any:
        if self._supertonic_tts is not None:
            return self._supertonic_tts
        from supertonic import TTS

        tts = TTS(model=self.supertonic_model, auto_download=True)
        self._supertonic_style = tts.get_voice_style(self.supertonic_voice)
        self._supertonic_tts = tts
        _log.info(
            "Supertonic loaded model=%r voice=%r sample_rate=%s",
            self.supertonic_model,
            self.supertonic_voice,
            getattr(tts, "sample_rate", "?"),
        )
        return tts

    async def speak_text_stream(self, text: str) -> AsyncIterator[tuple[np.ndarray, int]]:
        text = text.strip()
        if not text:
            return
        if self._use_supertonic:
            try:
                async for chunk in self._supertonic_synth(text):
                    yield chunk
                return
            except Exception as exc:  # noqa: BLE001
                _log.warning("Supertonic synthesis failed (%s); trying fallbacks", exc)
        if self._piper and self.piper_model and Path(self.piper_model).is_file():
            async for chunk in self._piper_synth(text):
                yield chunk
            return
        async for chunk in self._pyttsx3_synth(text):
            yield chunk

    async def _supertonic_synth(self, text: str) -> AsyncIterator[tuple[np.ndarray, int]]:
        def _run() -> tuple[np.ndarray, int]:
            tts = self._ensure_supertonic()
            wav, _dur = tts.synthesize(
                text,
                voice_style=self._supertonic_style,
                lang=self.supertonic_lang,
            )
            pcm = np.asarray(wav, dtype=np.float32).squeeze()
            if pcm.ndim > 1:
                pcm = pcm.mean(axis=0)
            sr = int(tts.sample_rate)
            return pcm.astype(np.float32, copy=False), sr

        pcm, sr = await asyncio.to_thread(_run)
        if pcm.size and float(np.max(np.abs(pcm))) < 1e-4:
            _log.warning("Supertonic output near-silence (peak=%.2e)", float(np.max(np.abs(pcm))))
        yield pcm, sr

    async def _piper_synth(self, text: str) -> AsyncIterator[tuple[np.ndarray, int]]:
        proc = await asyncio.create_subprocess_exec(
            self._piper,  # type: ignore[arg-type]
            "--model",
            self.piper_model,
            "--output_file",
            "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert proc.stdin and proc.stdout
        proc.stdin.write((text + "\n").encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()
        out = await proc.stdout.read()
        err = await proc.stderr.read()
        await proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(err.decode("utf-8", errors="replace") or "piper failed")
        pcm, sr = _wav_bytes_to_float32_mono(out)
        yield pcm, sr

    async def _pyttsx3_synth(self, text: str) -> AsyncIterator[tuple[np.ndarray, int]]:
        def _run() -> tuple[bytes, int]:
            import sys

            import pyttsx3

            if sys.platform == "win32":
                try:
                    import pythoncom

                    if not self._pyttsx3_com_initialized:
                        pythoncom.CoInitialize()
                        self._pyttsx3_com_initialized = True
                except ImportError:
                    _log.warning("pywin32 not available; pyttsx3 may fail or be silent from a worker thread")

            path = ""
            engine = pyttsx3.init()
            try:
                try:
                    engine.setProperty("volume", 1.0)
                    engine.setProperty("rate", 175)
                except Exception:  # noqa: BLE001
                    pass
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    path = tmp.name
                engine.save_to_file(text, path)
                engine.runAndWait()
                data = Path(path).read_bytes()
                if len(data) < 100:
                    _log.warning("pyttsx3 produced very small wav (%d bytes)", len(data))
                return data, 22_050
            finally:
                try:
                    engine.stop()
                except Exception:  # noqa: BLE001
                    pass
                if path:
                    try:
                        Path(path).unlink(missing_ok=True)
                    except OSError:
                        pass

        loop = asyncio.get_running_loop()
        wav_bytes, _guess_sr = await loop.run_in_executor(self._pyttsx3_worker(), _run)
        pcm, sr = _wav_bytes_to_float32_mono(wav_bytes)
        if pcm.size and float(np.max(np.abs(pcm))) < 1e-4:
            _log.warning("pyttsx3 wav decoded to near-silence (peak=%.2e)", float(np.max(np.abs(pcm))))
        yield pcm, sr
