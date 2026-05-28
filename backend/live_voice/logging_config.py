"""Lightweight logging setup (no heavy backend imports)."""

from __future__ import annotations

import logging
import os
from pathlib import Path


def resolve_log_path() -> str:
    log_path = os.environ.get("LIVE_VOICE_LOG", "").strip()
    if log_path:
        return log_path
    appdata = os.environ.get("APPDATA", "")
    local = os.environ.get("LOCALAPPDATA", "")
    if appdata:
        return str(Path(appdata) / "com.lohit.vadana" / "logs" / "session.log")
    if local:
        return str(Path(local) / "com.lohit.vadana" / "logs" / "session.log")
    return ""


def setup_logging() -> str:
    """Configure console + file logging. Returns the log file path if any."""
    log_path = resolve_log_path()
    handlers: list[logging.Handler] = [logging.StreamHandler()]
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
    return log_path
