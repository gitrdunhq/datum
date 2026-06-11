from datum.slug import make_unique, slugify
import pytest


def test_basic_lowercase_and_hyphen():
    assert slugify("Hello World") == "hello-world"


def test_punctuation_becomes_hyphen():
    assert slugify("Hello, World!") == "hello-world"


def test_accents_stripped_to_ascii():
    assert slugify("Crème brûlée!") == "creme-brulee"


def test_runs_of_separators_collapse():
    assert slugify("a -- b__c") == "a-b-c"


def test_leading_trailing_hyphens_trimmed():
    assert slugify("---hello---") == "hello"


def test_empty_string_returns_empty():
    assert slugify("") == ""


def test_only_punctuation_returns_empty():
    assert slugify("!!! ??? ...") == ""


def test_truncates_to_max_len():
    assert slugify("abcdef", max_len=3) == "abc"


def test_truncation_never_ends_on_hyphen():
    assert slugify("ab-cdef", max_len=3) == "ab"


def test_default_max_len_is_60():
    assert slugify("a" * 80) == "a" * 60


def test_non_str_raises_typeerror():
    with pytest.raises(TypeError):
        slugify(123)


def test_max_len_zero_raises_valueerror():
    with pytest.raises(ValueError):
        slugify("abc", max_len=0)


def test_make_unique_returns_slug_when_free():
    assert make_unique("post", set()) == "post"


def test_make_unique_appends_2_on_collision():
    assert make_unique("post", ["post"]) == "post-2"


def test_make_unique_skips_taken_suffixes():
    assert make_unique("post", {"post", "post-2", "post-3"}) == "post-4"
