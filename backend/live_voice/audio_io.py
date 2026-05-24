"""Capture and playback using sounddevice ring buffers."""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from collections import deque

import numpy as np
import sounddevice as sd

_log = logging.getLogger(__name__)


class MicStream:
    """Threaded mic capture at sample_rate Hz, mono float32 [-1, 1]."""

    def __init__(
        self,
        sample_rate: int = 16_000,
        block_frames: int = 512,
        gain: float = 1.0,
    ) -> None:
        self.sample_rate = sample_rate
        self.block_frames = block_frames
        self.gain = gain
        self._q: queue.Queue[np.ndarray] = queue.Queue(maxsize=256)
        self._stream: sd.InputStream | None = None
        self._stop = threading.Event()

    def _callback(self, indata, frames, time, status) -> None:  # type: ignore[no-untyped-def]
        if status:
            pass
        mono = np.asarray(indata, dtype=np.float32).mean(axis=1) * np.float32(self.gain)
        try:
            self._q.put_nowait(mono.copy())
        except queue.Full:
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            try:
                self._q.put_nowait(mono.copy())
            except queue.Full:
                pass

    def start(self) -> None:
        self._stop.clear()
        self._stream = sd.InputStream(
            channels=1,
            samplerate=self.sample_rate,
            blocksize=self.block_frames,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> None:
        self._stop.set()
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        while not self._q.empty():
            try:
                self._q.get_nowait()
            except queue.Empty:
                break

    def get_block(self, timeout: float = 0.5) -> np.ndarray | None:
        try:
            return self._q.get(timeout=timeout)
        except queue.Empty:
            return None


class PlaybackStream:
    """Non-blocking playback: enqueue float32 mono PCM chunks."""

    def __init__(self, sample_rate: int = 22_050) -> None:
        self.sample_rate = sample_rate
        self._buf = deque[np.ndarray]()
        self._lock = threading.Lock()
        self._stream: sd.OutputStream | None = None
        self._stop = threading.Event()

    def _callback(self, outdata, frames, time, status) -> None:  # type: ignore[no-untyped-def]
        if status:
            pass
        need = frames
        out = np.zeros((need, 1), dtype=np.float32)
        filled = 0
        with self._lock:
            while filled < need and self._buf:
                chunk = self._buf[0]
                take = min(len(chunk), need - filled)
                out[filled : filled + take, 0] = chunk[:take]
                filled += take
                if take >= len(chunk):
                    self._buf.popleft()
                else:
                    self._buf[0] = chunk[take:]
        outdata[:] = out

    def start(self) -> None:
        self._stop.clear()
        try:
            _in_idx, out_idx = sd.default.device
            if out_idx is not None and int(out_idx) >= 0:
                dev = sd.query_devices(int(out_idx))
                _log.info(
                    "Playback | device idx=%s name=%r sample_rate=%s",
                    out_idx,
                    dev.get("name"),
                    self.sample_rate,
                )
        except Exception:  # noqa: BLE001
            _log.warning("Playback | could not query default output device", exc_info=True)
        self._stream = sd.OutputStream(
            channels=1,
            samplerate=self.sample_rate,
            blocksize=1024,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> None:
        self._stop.set()
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        with self._lock:
            self._buf.clear()

    def enqueue(self, pcm: np.ndarray) -> None:
        if pcm.dtype != np.float32:
            pcm = pcm.astype(np.float32, copy=False)
        if pcm.ndim == 1:
            pcm = pcm.reshape(-1, 1)
        mono = pcm.mean(axis=1)
        with self._lock:
            self._buf.append(mono.copy())

    def clear(self) -> None:
        with self._lock:
            self._buf.clear()


def threadsafe_put_audio(loop: asyncio.AbstractEventLoop, q: asyncio.Queue, chunk: np.ndarray) -> None:
    def _put() -> None:
        try:
            q.put_nowait(chunk)
        except asyncio.QueueFull:
            pass

    loop.call_soon_threadsafe(_put)
