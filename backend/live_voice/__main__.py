"""WebSocket entrypoint for the local voice sidecar."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

# Avoid broken/partial hf_xet wheels breaking Hugging Face downloads (falls back to HTTP).
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
from typing import Any

import websockets

from live_voice.errors import error_event
from live_voice.protocol import PROTOCOL_VERSION, server_event
from live_voice.session import VoiceSession

logger = logging.getLogger(__name__)

PORT = int(os.environ.get("LIVE_VOICE_PORT", "8765"))
MAX_CLIENT_JSON_BYTES = 64 * 1024


def _setup_logging() -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    log_path = os.environ.get("LIVE_VOICE_LOG", "").strip()
    if not log_path:
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            log_path = str(Path(local) / "vadana" / "logs" / "session.log")
    if log_path:
        path = Path(log_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(path, encoding="utf-8"))

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )
    if log_path:
        logging.getLogger(__name__).info("File logging enabled: %s", log_path)


async def _handler(websocket: Any) -> None:
    peer = getattr(websocket, "remote_address", None)
    logger.info("WebSocket client connected %s", peer or "(unknown)")
    session = VoiceSession(websocket)
    await session.send_json(
        server_event("ready", port=PORT, protocol_version=PROTOCOL_VERSION),
    )
    try:
        async for raw in websocket:
            if isinstance(raw, bytes):
                continue
            if isinstance(raw, str) and len(raw.encode("utf-8")) > MAX_CLIENT_JSON_BYTES:
                await session.send_json(
                    error_event("Message too large", code="unknown"),
                )
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await session.send_json(
                    server_event("notice", message="Invalid JSON ignored."),
                )
                continue
            if not isinstance(data, dict):
                continue
            await session.handle_client_msg(data)
    except websockets.exceptions.ConnectionClosed:
        logger.info("client disconnected")
    finally:
        await session.shutdown()


def main() -> None:
    _setup_logging()

    async def _serve() -> None:
        async with websockets.serve(_handler, "127.0.0.1", PORT, max_size=None):
            print(f"LIVE_VOICE_READY port={PORT}", flush=True)
            await asyncio.Future()

    asyncio.run(_serve())


if __name__ == "__main__":
    main()
