"""WebSocket smoke client (run via uv run python scripts/smoke_client.py)."""

from __future__ import annotations

import asyncio
import json
import os
import sys

import websockets


async def main() -> None:
    port = int(os.environ.get("LIVE_VOICE_PORT", "8765"))
    uri = f"ws://127.0.0.1:{port}"
    async with websockets.connect(uri) as ws:
        ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert ready.get("type") == "ready", ready
        assert ready.get("protocol_version") == 1, ready
        await ws.send(
            json.dumps(
                {
                    "type": "config",
                    "lm_base_url": "http://127.0.0.1:1234",
                    "model": "local-model",
                }
            )
        )
        await ws.send(json.dumps({"type": "start"}))
        await asyncio.sleep(2)
        if not os.environ.get("SKIP_LM"):
            await ws.send(
                json.dumps({"type": "user_text", "text": "Say hi in one word."})
            )
            saw = False
            for _ in range(120):
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
                if msg.get("type") in ("assistant_text", "error", "llm_token"):
                    saw = True
                    if msg.get("type") == "error":
                        print("error:", msg, file=sys.stderr)
                    break
            assert saw, "no LLM response within timeout"
        await ws.send(json.dumps({"type": "stop"}))
    print("smoke ok")


if __name__ == "__main__":
    asyncio.run(main())
