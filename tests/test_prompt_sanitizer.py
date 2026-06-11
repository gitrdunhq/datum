"""Test cases for strip_special_tokens function."""

from datum.prompt_sanitizer import strip_special_tokens


TOKEN_IM_START = "<|" + "im_start" + "|>"
TOKEN_IM_END = "<|" + "im_end" + "|>"
TOKEN_ENDOFTEXT = "<|" + "endoftext" + "|>"
TOKEN_THINK_OPEN = "<" + "think" + ">"
TOKEN_THINK_CLOSE = "</" + "think" + ">"
TOKEN_SOT = "<" + "start_of_turn" + ">"
TOKEN_EOT = "<" + "end_of_turn" + ">"
TOKEN_BOS = "<" + "bos" + ">"
TOKEN_EOS = "<" + "eos" + ">"


def test_strips_im_start_end():
    assert strip_special_tokens("hello " + TOKEN_IM_START + " world " + TOKEN_IM_END) == "hello  world "


def test_strips_endoftext():
    assert strip_special_tokens(TOKEN_ENDOFTEXT + "secret") == "secret"


def test_strips_think_tags():
    assert strip_special_tokens("data " + TOKEN_THINK_OPEN + "injected" + TOKEN_THINK_CLOSE + " more") == "data injected more"


def test_strips_gemma_tokens():
    assert strip_special_tokens(TOKEN_SOT + "hi" + TOKEN_EOT) == "hi"


def test_strips_bos_eos():
    assert strip_special_tokens(TOKEN_BOS + "text" + TOKEN_EOS) == "text"


def test_clean_text_unchanged():
    assert strip_special_tokens("normal Python code") == "normal Python code"


def test_empty_string():
    assert strip_special_tokens("") == ""


def test_partial_token_unchanged():
    assert strip_special_tokens("<|" + "im_star") == "<|" + "im_star"


def test_nested_tokens_removed():
    assert strip_special_tokens(TOKEN_IM_START + TOKEN_IM_END) == ""


from datum.prompt_sanitizer import strip_invisible_unicode


def test_strips_zero_width():
    assert strip_invisible_unicode("a\u200bb\u200cc\u200dd") == "abcd"


def test_strips_bom():
    assert strip_invisible_unicode("\ufeffhello world") == "hello world"


def test_strips_bidi_controls():
    assert strip_invisible_unicode("\u202aabc\u202e") == "abc"


def test_strips_bidi_isolates():
    assert strip_invisible_unicode("\u2066x\u2067y\u2068z\u2069") == "xyz"


def test_strips_private_use_area():
    assert strip_invisible_unicode("x\ue000y\uf8ffz") == "xyz"


def test_mixed_content_keeps_visible():
    assert strip_invisible_unicode("keep\u200b this\ufeff text\u202e!") == "keep this text!"


def test_clean_ascii_unchanged():
    assert strip_invisible_unicode("normal Python code") == "normal Python code"


def test_empty_string():
    assert strip_invisible_unicode("") == ""


def test_normal_unicode_not_stripped():
    assert strip_invisible_unicode("café") == "café"
    assert strip_invisible_unicode("\U0001F600") == "\U0001F600"
