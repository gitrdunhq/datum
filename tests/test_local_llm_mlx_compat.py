"""Regression test for the transformers>=5.13 / mlx-lm import compat shim.

See https://github.com/ml-explore/mlx-lm/issues/1458 — transformers 5.13
changed AutoTokenizer.register() to dereference config_class.__module__,
which crashes when mlx_lm registers "NewlineTokenizer" by name (a str).
datum.local_llm._patch_transformers_for_mlx_lm() works around this.
"""

import importlib.util

import pytest

# mlx_lm (MLX) installs only on Apple Silicon. These tests exercise the in-process
# MLX backend itself, so they run where it imports and are skipped, by name, elsewhere.
requires_mlx = pytest.mark.skipif(importlib.util.find_spec("mlx_lm") is None, reason="mlx_lm (Apple Silicon only) is not installed")

from datum.local_llm import _patch_transformers_for_mlx_lm


@requires_mlx
def test_patch_makes_string_registration_a_noop():
    from transformers.models.auto import tokenization_auto

    _patch_transformers_for_mlx_lm()

    # Would raise AttributeError pre-patch on transformers>=5.13.
    assert tokenization_auto.AutoTokenizer.register("NotARealConfigClass") is None


def test_patch_is_idempotent():
    _patch_transformers_for_mlx_lm()
    _patch_transformers_for_mlx_lm()


@requires_mlx
def test_mlx_lm_imports_cleanly_after_patch():
    _patch_transformers_for_mlx_lm()

    import mlx_lm  # noqa: F401
