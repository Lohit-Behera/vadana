"""Local OpenAI Whisper (reference PyTorch implementation)."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

_log = logging.getLogger(__name__)


class STTEngine:
    """Uses the `openai-whisper` package (`import whisper`)."""

    def __init__(
        self,
        model_size: str,
        device: str | None,
        *,
        download_root: str | Path | None = None,
    ) -> None:
        import torch
        import whisper

        dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model_size = str(model_size)
        self.device = dev
        load_kwargs: dict[str, object] = {}
        if download_root:
            root = Path(download_root)
            root.mkdir(parents=True, exist_ok=True)
            load_kwargs["download_root"] = str(root)
        self._model = whisper.load_model(model_size, device=dev, **load_kwargs)
        self._fp16 = bool(dev == "cuda" and torch.cuda.is_available())
        _log.info(
            "Loaded openai-whisper model=%r device=%s fp16=%s",
            self.model_size,
            self.device,
            self._fp16,
        )

    def transcribe(self, audio_float32_mono: np.ndarray, sample_rate: int = 16_000) -> str:
        if audio_float32_mono.size == 0:
            return ""
        import torch
        import torchaudio.functional as F

        audio = np.clip(audio_float32_mono.astype(np.float32), -1.0, 1.0)
        if sample_rate != 16_000:
            t = torch.from_numpy(audio).unsqueeze(0)
            resampled = F.resample(t, sample_rate, 16_000)
            audio = resampled.squeeze(0).numpy().astype(np.float32)

        result = self._model.transcribe(
            audio,
            language="en",
            task="transcribe",
            fp16=self._fp16,
            verbose=False,
        )
        text = result.get("text") if isinstance(result, dict) else None
        return str(text or "").strip()
