"""Resolve Vadana model storage under a user-chosen root (default: ~/vadana/models)."""

from __future__ import annotations

import os
from pathlib import Path


def default_models_root() -> Path:
    """``%USERPROFILE%\\vadana\\models`` (or ``~/vadana/models``)."""
    return (Path.home() / "vadana" / "models").resolve()


def resolve_models_root(value: str | None = None) -> Path:
    """Config / env override, else :func:`default_models_root`."""
    raw = (value or "").strip() or os.environ.get("VADANA_MODELS_DIR", "").strip()
    root = Path(raw).expanduser() if raw else default_models_root()
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def apply_models_env(root: Path) -> None:
    """Point sidecar libraries at subfolders under *root*."""
    os.environ["VADANA_MODELS_DIR"] = str(root)
    whisper_download_root(root).mkdir(parents=True, exist_ok=True)
    (root / "supertonic").mkdir(parents=True, exist_ok=True)
    torch_home = root / "torch"
    torch_home.mkdir(parents=True, exist_ok=True)
    os.environ["TORCH_HOME"] = str(torch_home)


def whisper_download_root(root: Path) -> Path:
    return root / "whisper"


def supertonic_model_dir(root: Path, model: str) -> Path:
    from supertonic.config import get_model_config

    name = (model or "supertonic-3").strip() or "supertonic-3"
    cfg = get_model_config(name)
    cache_name = str(cfg.get("cache_dir") or name)
    path = root / "supertonic" / cache_name
    path.mkdir(parents=True, exist_ok=True)
    return path
