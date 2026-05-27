from live_voice.chat_title import FirstTurnTitleParser, sanitize_chat_title


def test_sanitize_chat_title() -> None:
    assert sanitize_chat_title('  "Hello World"  ') == "Hello World"
    assert sanitize_chat_title("new chat") is None
    assert sanitize_chat_title("") is None


def test_parser_strips_title_and_streams_body() -> None:
    p = FirstTurnTitleParser()
    assert p.feed("CHAT_TITLE: Weather chat\n\n") == ""
    assert p.title == "Weather chat"
    assert p.feed("Hello there") == "Hello there"
    assert p.flush() == ""


def test_parser_single_chunk() -> None:
    p = FirstTurnTitleParser()
    out = p.feed("CHAT_TITLE: Quick hello\n\nHi!")
    assert p.title == "Quick hello"
    assert out == "Hi!"


def test_parser_no_title_prefix_passes_through() -> None:
    p = FirstTurnTitleParser()
    assert p.feed("Hello") == ""
    out = p.flush()
    assert p.title is None
    assert out == "Hello"
