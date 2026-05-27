"""Prefetch Supertonic ONNX weights; JSON status for the Tauri UI."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from supertonic.config import DEFAULT_MODEL_REVISION, get_model_repo
from supertonic.loader import has_all_onnx_modules

from live_voice.models_paths import resolve_models_root, supertonic_model_dir

# Use standard HTTP downloads. Xet needs a working hf_xet wheel; a broken/partial
# install makes huggingface_hub think Xet is available and then fail mid-download.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")


def _emit(obj: dict[str, Any]) -> None:
    print(json.dumps(obj), flush=True)


def check_model(model: str, models_root: str | None = None) -> dict[str, Any]:
    model = model.strip() or "supertonic-3"
    root = resolve_models_root(models_root)
    cache = supertonic_model_dir(root, model)
    present = has_all_onnx_modules(cache)
    return {
        "present": present,
        "model": model,
        "cacheDir": str(cache),
        "message": "Model already present on disk"
        if present
        else "Not downloaded — use Download weights",
    }


def _json_tqdm_factory():
    """Build a tqdm class that emits progress JSON lines to stdout."""
    from tqdm.auto import tqdm

    class JsonTqdm(tqdm):  # type: ignore[misc]
        def update(self, n: float = 1) -> bool | None:
            result = super().update(n)
            total = float(self.total or 0)
            if total > 0:
                pct = int(min(100, max(0, round(100 * self.n / total))))
            else:
                pct = 0
            _emit(
                {
                    "type": "progress",
                    "percent": pct,
                    "message": str(self.desc or "Downloading"),
                }
            )
            return result

    return JsonTqdm


def download_model_with_progress(model: str, models_root: str | None = None) -> int:
    model = model.strip() or "supertonic-3"
    root = resolve_models_root(models_root)
    cache = supertonic_model_dir(root, model)

    if has_all_onnx_modules(cache):
        _emit(
            {
                "type": "done",
                "percent": 100,
                "present": True,
                "alreadyPresent": True,
                "message": "Model already present — nothing to download",
                "cacheDir": str(cache),
            }
        )
        return 0

    repo_id = get_model_repo(model)
    temp_dir = cache.parent / f".{cache.name}.tmp"

    try:
        from huggingface_hub import snapshot_download

        _emit({"type": "progress", "percent": 0, "message": f"Downloading {repo_id}…"})

        snapshot_download(
            repo_id=repo_id,
            local_dir=str(temp_dir),
            revision=DEFAULT_MODEL_REVISION,
            tqdm_class=_json_tqdm_factory(),
        )

        if cache.exists():
            shutil.rmtree(cache)
        shutil.move(str(temp_dir), str(cache))

        if not has_all_onnx_modules(cache):
            _emit(
                {
                    "type": "error",
                    "message": "Download finished but ONNX files are still missing",
                }
            )
            return 1

        _emit(
            {
                "type": "done",
                "percent": 100,
                "present": True,
                "alreadyPresent": False,
                "message": "Download complete",
                "cacheDir": str(cache),
            }
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        if temp_dir.exists():
            try:
                shutil.rmtree(temp_dir)
            except OSError:
                pass
        _emit({"type": "error", "message": str(exc)})
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Supertonic model check / download")
    parser.add_argument(
        "--model",
        default="supertonic-3",
        help='Model id, e.g. "supertonic-3"',
    )
    parser.add_argument(
        "--models-root",
        default="",
        help="Vadana models root (default: ~/vadana/models)",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="Print JSON status and exit")
    group.add_argument("--download", action="store_true", help="Download with progress JSONL")
    args = parser.parse_args()
    root_arg = args.models_root.strip() or None

    if args.check:
        _emit({"type": "status", **check_model(args.model, root_arg)})
        return 0

    if args.download:
        return download_model_with_progress(args.model, root_arg)

    return 1


if __name__ == "__main__":
    sys.exit(main())
