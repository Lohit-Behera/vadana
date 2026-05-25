"""Hugging Face Hub settings shared by the sidecar and CLI tools."""

from __future__ import annotations

import os


def configure_hf_hub() -> None:
    """Avoid broken hf_xet wheels; use standard HTTP downloads."""
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
