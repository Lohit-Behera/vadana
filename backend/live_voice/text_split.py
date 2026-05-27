"""Sentence splitting for streaming TTS (testable without session imports)."""

from __future__ import annotations

import re


_WORD_RE = re.compile(r"\b[\w'-]+\b")


def word_count(text: str) -> int:
    """Rough spoken-word count used for initial TTS buffering."""
    return len(_WORD_RE.findall(text))


def should_start_tts(
    text_buffer: str,
    elapsed_s: float,
    *,
    min_words: int = 12,
    max_wait_s: float = 2.8,
) -> bool:
    """Start speaking when enough words arrive or a max wait is reached."""
    if not text_buffer.strip():
        return False
    if word_count(text_buffer) >= min_words:
        return True
    return elapsed_s >= max_wait_s

def best_sentence_delim_index(buf: str, delims: str = ".?!;:\n") -> int:
    """Earliest sentence delimiter in ``buf``, or -1.

    Periods between digits (e.g. ``3.5``, ``v2.0``) are ignored.
    """
    best_i = -1
    for d in delims:
        if d != ".":
            j = buf.find(d)
            if j != -1 and (best_i == -1 or j < best_i):
                best_i = j
            continue
        start = 0
        while True:
            j = buf.find(".", start)
            if j == -1:
                break
            if j > 0 and j + 1 < len(buf) and buf[j - 1].isdigit() and buf[j + 1].isdigit():
                start = j + 1
                continue
            if best_i == -1 or j < best_i:
                best_i = j
            break
    return best_i


def flush_tts_chunks(text_buffer: str, max_chars: int = 160) -> tuple[list[str], str]:
    """Split buffer into speakable chunks at punctuation or max length."""
    chunks: list[str] = []
    buf = text_buffer
    while buf:
        best_i = best_sentence_delim_index(buf)
        if best_i != -1:
            piece = buf[: best_i + 1].strip()
            buf = buf[best_i + 1 :]
            if piece:
                chunks.append(piece)
            continue
        if len(buf) >= max_chars:
            piece = buf[:max_chars].strip()
            buf = buf[max_chars:]
            if piece:
                chunks.append(piece)
            continue
        break
    return chunks, buf
