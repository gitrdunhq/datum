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
    assert (
        strip_special_tokens("hello " + TOKEN_IM_START + " world " + TOKEN_IM_END)
        == "hello  world "
    )


def test_strips_endoftext():
    assert strip_special_tokens(TOKEN_ENDOFTEXT + "secret") == "secret"


def test_strips_think_tags():
    assert (
        strip_special_tokens(
            "data " + TOKEN_THINK_OPEN + "injected" + TOKEN_THINK_CLOSE + " more"
        )
        == "data injected more"
    )


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
    assert (
        strip_invisible_unicode("keep\u200b this\ufeff text\u202e!")
        == "keep this text!"
    )


def test_clean_ascii_unchanged():
    assert strip_invisible_unicode("normal Python code") == "normal Python code"


def test_empty_string():
    assert strip_invisible_unicode("") == ""


def test_normal_unicode_not_stripped():
    assert strip_invisible_unicode("café") == "café"
    assert strip_invisible_unicode("\U0001f600") == "\U0001f600"


import json
from pathlib import Path

import pytest

from datum.prompt_sanitizer import hash_pin_rules


def test_first_call_pins_and_returns_true(tmp_path):
    store = tmp_path / "rules_hash.json"
    result, pinned = hash_pin_rules("rules v1", store)
    assert result == "rules v1"
    assert pinned is True
    assert store.exists()


def test_second_identical_call_returns_false(tmp_path):
    store = tmp_path / "rules_hash.json"
    hash_pin_rules("rules v1", store)
    result, pinned = hash_pin_rules("rules v1", store)
    assert result == "rules v1"
    assert pinned is False


def test_modified_text_raises_value_error_naming_path(tmp_path):
    store = tmp_path / "rules_hash.json"
    hash_pin_rules("rules v1", store)
    with pytest.raises(ValueError) as exc_info:
        hash_pin_rules("rules v2", store)
    assert str(store) in str(exc_info.value)


def test_store_file_is_valid_json_with_sha256_hex(tmp_path):
    store = tmp_path / "rules_hash.json"
    hash_pin_rules("rules v1", store)
    data = json.loads(store.read_text())
    digest = data["sha256"]
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)


# ── strip_secrets (#95) ──────────────────────────────────────────────────
# All credentials below are FAKE, realistic-shaped only.

from datum.prompt_sanitizer import strip_secrets

FAKE_ANTHROPIC = "sk-ant-api03-" + "FAKE" * 6 + "-" + "a" * 16 + "AA"
FAKE_OPENAI = "sk-" + "FAKE0" * 8  # 40 chars after sk-, no ant- prefix
FAKE_AWS = "AKIAIOSFODNN7EXAMPLE"  # AWS's canonical documentation example
FAKE_GHP = "ghp_" + "F" * 36
FAKE_GHO = "gho_" + "F" * 36
FAKE_GH_PAT = "github_pat_" + "F" * 22 + "_" + "a" * 30
FAKE_STRIPE_SK_LIVE = "sk_live_" + "FAKE" * 6
FAKE_STRIPE_SK_TEST = "sk_test_" + "FAKE" * 6
FAKE_STRIPE_PK_LIVE = "pk_live_" + "FAKE" * 6
# concatenated so the source blob never contains a contiguous token shape
# (GitHub push protection flags it otherwise)
FAKE_SLACK = "xoxb-" + "1234567890-1234567890123-FAKEfakeFAKEfakeFAKEfake"
FAKE_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiJmYWtlLXVzZXIifQ"
    ".FAKEsignature-1234567890_abc"
)
FAKE_GOOGLE = "AIza" + "Sy" + "F" * 33  # AIza + 35 chars
FAKE_PEM = (
    "-----BEGIN RSA PRIVATE KEY-----\n"
    "MIIEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE\n"
    "FAKEsecondLINEofKEYmaterial000000000\n"
    "-----END RSA PRIVATE KEY-----"
)


def test_redacts_anthropic_key():
    out = strip_secrets("key: " + FAKE_ANTHROPIC + " end")
    assert FAKE_ANTHROPIC not in out
    assert "[REDACTED:anthropic]" in out


def test_anthropic_ordering_beats_generic_openai():
    # sk-ant- must be classified as anthropic, never as generic sk- (openai)
    out = strip_secrets(FAKE_ANTHROPIC)
    assert out == "[REDACTED:anthropic]"
    assert "openai" not in out


def test_redacts_openai_key():
    out = strip_secrets("OPENAI_API_KEY value " + FAKE_OPENAI)
    assert FAKE_OPENAI not in out
    assert "[REDACTED:openai]" in out


def test_redacts_aws_access_key():
    out = strip_secrets("aws cred " + FAKE_AWS + " here")
    assert FAKE_AWS not in out
    assert "[REDACTED:aws-access-key]" in out


def test_redacts_github_tokens():
    for tok in (FAKE_GHP, FAKE_GHO, FAKE_GH_PAT):
        out = strip_secrets("token " + tok)
        assert tok not in out
        assert "[REDACTED:github]" in out


def test_redacts_stripe_keys():
    for tok in (FAKE_STRIPE_SK_LIVE, FAKE_STRIPE_SK_TEST, FAKE_STRIPE_PK_LIVE):
        out = strip_secrets("stripe " + tok)
        assert tok not in out
        assert "[REDACTED:stripe]" in out


def test_redacts_slack_token():
    out = strip_secrets("slack " + FAKE_SLACK)
    assert FAKE_SLACK not in out
    assert "[REDACTED:slack]" in out


def test_redacts_jwt():
    out = strip_secrets("auth with " + FAKE_JWT + " done")
    assert FAKE_JWT not in out
    assert "[REDACTED:jwt]" in out


def test_redacts_google_api_key():
    out = strip_secrets("g key " + FAKE_GOOGLE)
    assert FAKE_GOOGLE not in out
    assert "[REDACTED:google-api-key]" in out


def test_redacts_bearer_header():
    out = strip_secrets("Authorization: Bearer FAKEtoken1234567890abcdef")
    assert "FAKEtoken" not in out
    assert "[REDACTED:bearer]" in out


def test_redacts_multiline_pem_block():
    out = strip_secrets("before\n" + FAKE_PEM + "\nafter")
    assert "FAKEsecondLINE" not in out
    assert "BEGIN RSA PRIVATE KEY" not in out
    assert "[REDACTED:pem-private-key]" in out
    assert "before" in out and "after" in out


def test_redacts_db_connection_credentials():
    schemes = [
        "postgres://admin:hunter2@db.example.com:5432/prod",
        "postgresql://admin:hunter2@db.example.com/prod",
        "mysql://root:hunter2@10.0.0.1/app",
        "mongodb://svc:hunter2@mongo.internal:27017",
        "mongodb+srv://svc:hunter2@cluster0.example.net",
        "redis://default:hunter2@cache.example.com:6379",
        "amqp://guest:hunter2@rabbit.example.com:5672",
    ]
    for url in schemes:
        out = strip_secrets("dsn = " + url)
        assert "hunter2" not in out
        assert "[REDACTED:db-credentials]" in out
    # host stays readable
    out = strip_secrets("postgres://admin:hunter2@db.example.com:5432/prod")
    assert "db.example.com" in out


def test_sensitive_assignment_preserves_key_name():
    out = strip_secrets("api_key=supersecretvalue123")
    assert out == "api_key=[REDACTED:sensitive-assignment]"
    out = strip_secrets('password = "hunter2secret"')
    assert out == 'password = "[REDACTED:sensitive-assignment]"'
    out = strip_secrets("MY_SECRET: deadbeefcafe")
    assert "MY_SECRET" in out
    assert "deadbeefcafe" not in out
    out = strip_secrets("auth_token=abc123def456")
    assert out == "auth_token=[REDACTED:sensitive-assignment]"


def test_specific_kind_wins_over_assignment_catchall():
    out = strip_secrets("api_key=" + FAKE_OPENAI)
    assert out == "api_key=[REDACTED:openai]"


def test_clean_text_unchanged_by_strip_secrets():
    clean = (
        "def handler(request):\n"
        "    max_tokens=4096\n"
        "    return run(request)  # normal Python code\n"
    )
    assert strip_secrets(clean) == clean


def test_strip_secrets_empty_string():
    assert strip_secrets("") == ""


def test_observe_boundary_wiring_redacts_secrets():
    from datum.agent_loop import _sanitize_observation

    obs = "command output: ANTHROPIC_API_KEY found -> " + FAKE_ANTHROPIC
    out = _sanitize_observation(obs)
    assert FAKE_ANTHROPIC not in out
    assert "[REDACTED:anthropic]" in out
