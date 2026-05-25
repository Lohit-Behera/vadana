"""Tests for knowledge reference context assembly."""

from pathlib import Path

import pytest

from live_voice.knowledge.context import (
    REF_HEADER,
    build_reference_context,
    resolve_active_file_ids,
)


CATALOG = [
    {
        "id": "f1",
        "folder_id": "folder-a",
        "rel_path": "folders/folder-a/doc.md",
        "filename": "doc.md",
        "enabled": True,
        "folder_enabled": True,
        "char_count": 100,
    },
    {
        "id": "f2",
        "folder_id": "folder-a",
        "rel_path": "folders/folder-a/big.pdf",
        "filename": "big.pdf",
        "enabled": True,
        "folder_enabled": True,
        "char_count": 20_000,
    },
    {
        "id": "f3",
        "folder_id": "folder-b",
        "rel_path": "folders/folder-b/off.md",
        "filename": "off.md",
        "enabled": False,
        "folder_enabled": True,
        "char_count": 50,
    },
]


def test_resolve_off_mode():
    assert resolve_active_file_ids("off", {}, CATALOG) == []


def test_resolve_all_enabled():
    ids = resolve_active_file_ids("all_enabled", {}, CATALOG)
    assert set(ids) == {"f1", "f2", "f3"}


def test_resolve_selected_files():
    ids = resolve_active_file_ids(
        "selected",
        {"file_ids": ["f1"]},
        CATALOG,
    )
    assert ids == ["f1"]


def test_resolve_selected_folders():
    ids = resolve_active_file_ids(
        "selected",
        {"folder_ids": ["folder-a"]},
        CATALOG,
    )
    assert ids == ["f1", "f2"]


def test_resolve_selected_file_even_if_globally_disabled():
    """Per-chat file pick applies even when library toggles are off."""
    ids = resolve_active_file_ids(
        "selected",
        {"file_ids": ["f3"]},
        CATALOG,
    )
    assert ids == ["f3"]


def test_build_reference_small_file(tmp_path: Path):
    root = tmp_path / "knowledge"
    doc = root / "folders" / "folder-a" / "doc.md"
    doc.parent.mkdir(parents=True)
    doc.write_text("Hello knowledge base", encoding="utf-8")

    out = build_reference_context(
        "query",
        mode="all_enabled",
        selection={},
        catalog=CATALOG,
        knowledge_dir=root,
        manager=None,
    )
    assert out.startswith(REF_HEADER)
    assert "Hello knowledge base" in out
    assert "big.pdf" not in out or "excerpt" in out
