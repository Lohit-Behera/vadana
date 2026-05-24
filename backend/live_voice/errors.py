"""Stable error codes for the WebSocket client."""

from __future__ import annotations

from typing import Any

from live_voice.protocol import server_event


def error_event(message: str, code: str = "unknown") -> dict[str, Any]:
    return server_event("error", message=message, code=code)
