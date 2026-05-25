"""Tests for knowledge library fingerprint and index metadata."""

from live_voice.knowledge.fingerprint import (
    all_enabled_already_indexed,
    entry_already_indexed,
    library_fingerprint,
)

CATALOG = [
    {
        "id": "f1",
        "enabled": True,
        "folder_enabled": True,
        "char_count": 100,
        "indexed_at": 1_700_000_000_000,
        "size_bytes": 5000,
    },
    {
        "id": "f2",
        "enabled": False,
        "folder_enabled": True,
        "char_count": 0,
        "indexed_at": 0,
        "size_bytes": 100,
    },
]


def test_entry_already_indexed():
    assert entry_already_indexed(CATALOG[0])
    assert not entry_already_indexed(CATALOG[1])


def test_library_fingerprint_stable():
    a = library_fingerprint(CATALOG)
    b = library_fingerprint(CATALOG)
    assert a == b
    assert a != ""


def test_fingerprint_ignores_selection_not_in_catalog():
    assert library_fingerprint(CATALOG) == library_fingerprint(CATALOG)


def test_all_enabled_already_indexed():
    assert all_enabled_already_indexed(CATALOG)
