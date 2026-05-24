from live_voice.text_split import best_sentence_delim_index, flush_tts_chunks


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
