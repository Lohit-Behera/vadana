"""Silero VAD streaming (512-sample chunks @ 16 kHz)."""

from __future__ import annotations

import logging

import numpy as np
import torch

_WINDOW_16K = 512
_log = logging.getLogger(__name__)


class SileroStreamVAD:
    def __init__(
        self,
        sample_rate: int = 16_000,
        threshold: float = 0.5,
        min_silence_duration_ms: int = 400,
        speech_pad_ms: int = 40,
    ) -> None:
        if sample_rate != 16_000:
            raise ValueError("SileroStreamVAD currently supports 16 kHz only.")
        model, utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            onnx=False,
            trust_repo=True,
        )
        _get_ts, _save, _read, VADIterator, _collect = utils
        self._iterator = VADIterator(
            model,
            threshold=threshold,
            sampling_rate=sample_rate,
            min_silence_duration_ms=min_silence_duration_ms,
            speech_pad_ms=speech_pad_ms,
        )
        _log.info(
            "Loaded Silero VAD (torch.hub snakers4/silero-vad) threshold=%s min_silence_ms=%s pad_ms=%s",
            threshold,
            min_silence_duration_ms,
            speech_pad_ms,
        )

    @property
    def window_samples(self) -> int:
        return _WINDOW_16K

    def reset(self) -> None:
        self._iterator.reset_states()

    def process(self, chunk_mono_float32: np.ndarray) -> dict | None:
        """Feed exactly `window_samples` float32 mono frames. Returns Silero dict or None."""
        x = np.asarray(chunk_mono_float32, dtype=np.float32)
        if x.size != _WINDOW_16K:
            raise ValueError(f"Expected {_WINDOW_16K} samples, got {x.size}")
        tensor = torch.from_numpy(x)
        return self._iterator(tensor, return_seconds=False)
