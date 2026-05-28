"""Load CPU PyTorch on Windows before the WebSocket server starts.

When the desktop app spawns the sidecar (no console, different DLL search path),
`import torch` can fail with WinError 1114 on c10.dll unless torch\\lib is on the
DLL search path. PowerShell/`uv run` often works without this — which is why local
dev and manual tests look fine while the installed app fails.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _torch_lib_dirs() -> list[Path]:
    """Locate torch native libs without importing torch first."""
    if sys.platform != "win32":
        return []
    roots: list[Path] = []
    prefix = Path(sys.prefix)
    for base in (
        prefix / "Lib" / "site-packages" / "torch" / "lib",
        prefix / "Library" / "lib" / "torch" / "lib",
    ):
        if base.is_dir():
            roots.append(base)
    return roots


def prepare_torch_dll_path() -> None:
    if sys.platform != "win32":
        return
    add_dll = getattr(os, "add_dll_directory", None)
    if add_dll is None:
        return
    for lib_dir in _torch_lib_dirs():
        try:
            add_dll(str(lib_dir))
            logger.debug("Added DLL directory: %s", lib_dir)
        except OSError as exc:
            logger.warning("Could not add DLL directory %s: %s", lib_dir, exc)


def warmup_torch() -> str:
    """Register torch DLL paths and import torch once at process startup."""
    prepare_torch_dll_path()
    import torch

    version = str(getattr(torch, "__version__", "unknown"))
    cuda = bool(torch.cuda.is_available())
    logger.info("PyTorch %s (cuda=%s)", version, cuda)
    if cuda and os.environ.get("VADANA_FORCE_CPU", "").strip() != "1":
        logger.info(
            "CUDA is available; Vadana uses CPU inference unless you configure otherwise."
        )
    return version
