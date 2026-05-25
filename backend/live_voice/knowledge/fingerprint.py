"""Stable fingerprint of indexed library content (ignores per-chat selection)."""

from __future__ import annotations

import hashlib
from typing import Any


def _entry_index_state(entry: dict[str, Any]) -> str:
    return (
        f"{entry.get('id', '')}:"
        f"{int(entry.get('char_count') or 0)}:"
        f"{int(entry.get('indexed_at') or 0)}:"
        f"{int(entry.get('size_bytes') or 0)}:"
        f"{1 if entry.get('enabled') else 0}:"
        f"{1 if entry.get('folder_enabled') else 0}"
    )


def library_fingerprint(catalog: list[dict[str, Any]]) -> str:
    """Hash of enabled library files' index metadata. Selection changes do not affect this."""
    enabled = [e for e in catalog if e.get("enabled") and e.get("folder_enabled")]
    if not enabled:
        return ""
    parts = sorted(_entry_index_state(e) for e in enabled)
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:24]


def entry_already_indexed(entry: dict[str, Any]) -> bool:
    """True when rebuild has already parsed this file (char_count + indexed_at set)."""
    return int(entry.get("char_count") or 0) > 0 and int(entry.get("indexed_at") or 0) > 0


def all_enabled_already_indexed(catalog: list[dict[str, Any]]) -> bool:
    enabled = [e for e in catalog if e.get("enabled") and e.get("folder_enabled")]
    return bool(enabled) and all(entry_already_indexed(e) for e in enabled)
