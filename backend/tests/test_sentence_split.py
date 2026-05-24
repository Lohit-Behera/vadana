from live_voice.text_split import best_sentence_delim_index, flush_tts_chunks


def test_decimal_period_not_sentence_end() -> None:
    buf = "Version 3.5 is ready."
    idx = best_sentence_delim_index(buf)
    assert idx == len(buf) - 1
    assert buf[idx] == "."


def test_flush_on_question_mark() -> None:
    chunks, rest = flush_tts_chunks("Hello? World")
    assert chunks == ["Hello?"]
    assert rest == " World"


def test_flush_max_chars() -> None:
    long = "a" * 200
    chunks, rest = flush_tts_chunks(long, max_chars=80)
    assert len(chunks) >= 1
    assert len(chunks[0]) <= 80
    assert rest
