"""Load CPU PyTorch on Windows before the WebSocket server starts.

When the desktop app spawns the sidecar (no console, different DLL search path),
`import torch` can fail with WinError 1114 on c10.dll. PowerShell and `tauri dev`
often work; the installed NSIS build does not unless we preload native libs first.

See: https://github.com/pytorch/pytorch/issues/166628
"""

from __future__ import annotations

import logging
import os
import sys
from importlib.util import find_spec
from pathlib import Path

logger = logging.getLogger(__name__)


def _torch_lib_dirs() -> list[Path]:
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
    spec = find_spec("torch")
    if spec and spec.origin:
        origin_lib = Path(spec.origin).resolve().parent / "lib"
        if origin_lib.is_dir() and origin_lib not in roots:
            roots.append(origin_lib)
    return roots


def _prepend_path_dirs(dirs: list[Path]) -> None:
    if not dirs:
        return
    parts = [str(d.resolve()) for d in dirs]
    existing = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join(parts + ([existing] if existing else []))


def prepare_torch_dll_path() -> None:
    if sys.platform != "win32":
        return
    lib_dirs = _torch_lib_dirs()
    _prepend_path_dirs(lib_dirs)

    add_dll = getattr(os, "add_dll_directory", None)
    if add_dll is not None:
        for lib_dir in lib_dirs:
            try:
                add_dll(str(lib_dir.resolve()))
            except OSError as exc:
                logger.warning("Could not add DLL directory %s: %s", lib_dir, exc)

    # Pre-load c10.dll before `import torch` (avoids WinError 1114 under GUI parents).
    try:
        import ctypes

        for lib_dir in lib_dirs:
            c10 = lib_dir / "c10.dll"
            if c10.is_file():
                ctypes.CDLL(os.path.normpath(str(c10)))
                logger.debug("Preloaded %s", c10)
                break
    except OSError as exc:
        logger.warning("Could not preload c10.dll: %s", exc)


def warmup_torch() -> str:
    prepare_torch_dll_path()
    import torch

    version = str(getattr(torch, "__version__", "unknown"))
    cuda = bool(torch.cuda.is_available())
    logger.info("PyTorch %s (cuda=%s)", version, cuda)
    return version
