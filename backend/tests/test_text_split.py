from live_voice.text_split import (
    best_sentence_delim_index,
    flush_tts_chunks,
    should_start_tts,
    word_count,
)


def test_semicolon_is_sentence_delimiter() -> None:
    assert best_sentence_delim_index("Wait; go") == 4


def test_version_decimal_skips_inner_period() -> None:
    idx = best_sentence_delim_index("Use v2.0 today.")
    assert idx == len("Use v2.0 today.") - 1


def test_no_delimiter_returns_minus_one() -> None:
    assert best_sentence_delim_index("hello world") == -1


def test_flush_empty_buffer() -> None:
    chunks, rest = flush_tts_chunks("")
    assert chunks == []
    assert rest == ""


def test_flush_keeps_remainder_without_delimiter() -> None:
    chunks, rest = flush_tts_chunks("incomplete", max_chars=200)
    assert chunks == []
    assert rest == "incomplete"


def test_word_count_counts_simple_words() -> None:
    assert word_count("hello world from vadana") == 4


def test_should_start_tts_when_min_words_reached() -> None:
    assert should_start_tts("one two three four five six", 0.5, min_words=6, max_wait_s=2.8)


def test_should_start_tts_when_max_wait_elapsed() -> None:
    assert should_start_tts("short reply", 3.1, min_words=12, max_wait_s=2.8)


def test_should_not_start_tts_before_gate() -> None:
    assert not should_start_tts("short reply", 0.8, min_words=12, max_wait_s=2.8)
