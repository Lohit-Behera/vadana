"""Rebuild the global knowledge index (CLI for Tauri, no WebSocket session)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from live_voice.hf_env import configure_hf_hub

configure_hf_hub()


def _emit(obj: dict[str, Any]) -> None:
    print(json.dumps(obj), flush=True)


_emit({"type": "progress", "message": "Starting rebuild worker…", "phase": "start", "percent": 1})

from live_voice.knowledge.manager import KnowledgeManager  # noqa: E402


async def _run(catalog: list[dict[str, Any]]) -> dict[str, Any]:
    km = KnowledgeManager()

    async def notice(
        msg: str,
        *,
        phase: str | None = None,
        percent: int | None = None,
    ) -> None:
        payload: dict[str, Any] = {"type": "progress", "message": msg}
        if phase:
            payload["phase"] = phase
        if percent is not None:
            payload["percent"] = percent
        _emit(payload)

    return await km.rebuild(catalog, send_notice=notice)


def _load_catalog(args: argparse.Namespace) -> list[Any]:
    if args.catalog_file:
        from pathlib import Path

        raw = Path(args.catalog_file).read_text(encoding="utf-8")
        catalog = json.loads(raw)
    elif args.catalog:
        catalog = json.loads(args.catalog)
    else:
        raise ValueError("Pass --catalog-file or --catalog")
    if not isinstance(catalog, list):
        raise ValueError("Catalog must be a JSON array")
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild Vadana knowledge vector index")
    parser.add_argument(
        "--catalog",
        help="JSON array of knowledge file metadata (deprecated on Windows; use --catalog-file)",
    )
    parser.add_argument(
        "--catalog-file",
        help="Path to UTF-8 JSON file with the catalog array",
    )
    args = parser.parse_args()
    try:
        catalog = _load_catalog(args)
    except (json.JSONDecodeError, ValueError, OSError) as exc:
        _emit({"type": "error", "message": f"Invalid catalog: {exc}"})
        sys.exit(1)
    if not isinstance(catalog, list):
        _emit({"type": "error", "message": "Catalog must be a JSON array"})
        sys.exit(1)

    try:
        result = asyncio.run(_run(catalog))
        payload: dict[str, Any] = {"type": "done", **result}
        if result.get("char_updates"):
            payload["charUpdates"] = [
                {"id": fid, "charCount": count}
                for fid, count in result["char_updates"]
            ]
        _emit(payload)
        sys.exit(0 if result.get("ok") else 1)
    except Exception as exc:  # noqa: BLE001
        _emit({"type": "error", "message": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
