"""OpenAI-compatible streaming chat (LM Studio, Ollama openai shim, vLLM)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx


def _delta_text(obj: dict[str, Any]) -> str | None:
    choices = obj.get("choices") or []
    if not choices:
        return None
    c0 = choices[0]
    delta = c0.get("delta")
    if not isinstance(delta, dict):
        return None
    piece = delta.get("content")
    if isinstance(piece, str) and piece:
        return piece
    msg = delta.get("message")
    if isinstance(msg, dict):
        m = msg.get("content")
        if isinstance(m, str) and m:
            return m
    return None


async def stream_chat_completions(
    client: httpx.AsyncClient,
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    cancel_event: Any,
) -> AsyncIterator[str]:
    url = base_url.rstrip("/") + "/v1/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.7,
    }
    async with client.stream(
        "POST",
        url,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=httpx.Timeout(120.0, connect=10.0),
    ) as resp:
        resp.raise_for_status()
        buf = b""
        async for piece in resp.aiter_bytes():
            if cancel_event.is_set():
                await resp.aclose()
                break
            buf += piece
            while b"\n" in buf:
                raw_line, buf = buf.split(b"\n", 1)
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line.removeprefix("data:").strip()
                if data == "[DONE]":
                    return
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                text = _delta_text(obj)
                if text:
                    yield text
