"""Tests for knowledge document loaders."""

from pathlib import Path
from unittest.mock import patch

from live_voice.knowledge.loaders import load_file_text


def test_docling_empty_falls_back_to_legacy(tmp_path: Path):
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 minimal")

    with (
        patch(
            "live_voice.knowledge.loaders._load_with_docling",
            return_value="",
        ),
        patch(
            "live_voice.knowledge.loaders._load_legacy",
            return_value="Lohit Sekhar Behera",
        ) as legacy,
    ):
        text = load_file_text(pdf)

    assert text == "Lohit Sekhar Behera"
    legacy.assert_called_once()


def test_prefer_fast_skips_docling(tmp_path: Path):
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 minimal")

    with (
        patch(
            "live_voice.knowledge.loaders._load_legacy",
            return_value="fast text",
        ) as legacy,
        patch("live_voice.knowledge.loaders._load_with_docling") as docling,
    ):
        text = load_file_text(pdf, prefer_fast=True)

    assert text == "fast text"
    legacy.assert_called_once()
    docling.assert_not_called()
