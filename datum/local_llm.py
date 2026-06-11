"""Local LLM inference via MLX for cost-free pipeline tasks.

Gemma-first flow: attempt local inference, escalate to Claude on failure.
Includes context monitoring, repetition detection, and streaming abort.

Opt-in via config.toml:
  [local_llm]
  enabled = true
  model = "mlx-community/gemma-4-26b-a4b-it-4bit"
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request  # noqa: F401 — used in oMLX backend helpers below
from collections.abc import Callable
from pathlib import Path

_model_cache: dict = {}

DEFAULTS = {
    "enabled": False,
    "model": "mlx-community/gemma-4-26b-a4b-it-4bit",
    # fast_model is used for low-complexity phases (triage, validate).
    # Defaults to the same as model if not set.
    "fast_model": None,
    "fast_phases": ["triage", "validate"],
    "max_tokens": 8192,
    "temperature": 0.3,
    "context_window": 131072,
    # KV cache: kv_bits=8 halves cache memory vs float16; None disables quantization.
    # max_kv_size caps the rolling KV buffer (tokens); None = unlimited.
    "kv_bits": 8,
    "kv_group_size": 64,
    "max_kv_size": 32768,
    "request_timeout_s": 300,
    "repetition_ngram_size": 6,
    "repetition_max_count": 3,
    "phases": [
        "triage",
        "act_skeleton",
        "act_red",
        "act_green",
        "act_refactor",
        "validate",
        "sidecar_docs",
        "sidecar_security",
        "closeout_collectors",
    ],
}

MULTI_TURN_DEFAULTS = {
    "enabled": False,
    "max_turns": 5,
    "timeout_s": 300,
    "turn_timeout_s": 90,
    "confidence_threshold": 0.8,
    "temperature_schedule": "fixed",
    "temperature_min": 0.2,
    "temperature_max": 0.7,
    "context_reserve_pct": 20,
    "retry_on_low_confidence": True,
    "max_retries_per_turn": 2,
    "planning_turn": True,
    "verification_turn": True,
    "two_pass": True,
    "consistency_samples": 1,
    "few_shot": True,
    "phases": [],
    "quality_gates": {
        "char_flood_pct": 0.3,
        "ngram_size": 3,
        "max_count": 4,
        "diversity_ratio": 0.25,
    },
}

STEP_FEW_SHOT = {
    "step_index": 1,
    "action": "analyze",
    "finding": "Token expiry not checked, stale tokens pass auth",
    "evidence": "auth.py line 42: if token: passes expired tokens",
    "recommendation": "proceed",
    "confidence": 0.9,
    "needs_more_turns": False,
    "escalate": False,
}

PLAN_FEW_SHOT = {
    "steps": [
        {
            "action": "analyze",
            "description": "Check scope and blast radius of the change",
        },
        {"action": "verify", "description": "Assess test coverage for affected paths"},
    ],
    "rationale": "Small change but touches auth — verify test coverage first",
}

ESCALATE = "ESCALATE"


def is_available() -> bool:
    import platform

    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return False
    try:
        import mlx_lm  # noqa: F401

        return True
    except ImportError:
        return False


def _cache_offset(cache: list) -> int:
    """Return tokens already processed in this cache, or 0 if unavailable."""
    try:
        return int(cache[0].offset) if cache else 0
    except (AttributeError, IndexError):
        return 0


def load_model(model_id: str = DEFAULTS["model"]):
    if model_id in _model_cache:
        return _model_cache[model_id]

    import os

    from mlx_lm import load

    config = load_config()
    hf_cache = config.get("hf_cache_dir")
    if hf_cache and not os.environ.get("HF_HUB_CACHE"):
        os.environ["HF_HUB_CACHE"] = str(hf_cache)

    model, tokenizer = load(model_id)
    _model_cache[model_id] = (model, tokenizer)
    return model, tokenizer


# ── Context monitoring ──────────────────────────────────────────────────────


def count_tokens(text: str, model_id: str = DEFAULTS["model"]) -> int:
    _, tokenizer = load_model(model_id)
    return len(tokenizer.encode(text))


def check_context_budget(
    prompt: str,
    max_output: int,
    model_id: str = DEFAULTS["model"],
) -> dict:
    """Check if prompt + expected output fits in context window."""
    config = load_config()
    window = config.get("context_window", DEFAULTS["context_window"])
    prompt_tokens = count_tokens(prompt, model_id)
    total = prompt_tokens + max_output
    fits = total <= window
    return {
        "fits": fits,
        "prompt_tokens": prompt_tokens,
        "max_output": max_output,
        "total": total,
        "window": window,
        "headroom": window - total,
        "utilization_pct": round(prompt_tokens / window * 100, 1),
    }


# ── Repetition detection ────────────────────────────────────────────────────


def _detect_repetition(
    text: str,
    ngram_size: int = DEFAULTS["repetition_ngram_size"],
    max_count: int = DEFAULTS["repetition_max_count"],
) -> bool:
    """Detect if the output has degenerate repetition loops."""
    words = text.split()
    if len(words) < ngram_size * max_count:
        return False

    tail = words[-ngram_size * max_count * 2 :]
    ngrams: dict[tuple, int] = {}
    for i in range(len(tail) - ngram_size + 1):
        gram = tuple(tail[i : i + ngram_size])
        ngrams[gram] = ngrams.get(gram, 0) + 1
        if ngrams[gram] >= max_count:
            return True
    return False


# ── Streaming generation with abort ─────────────────────────────────────────


def generate(
    prompt: str,
    model_id: str = DEFAULTS["model"],
    max_tokens: int = DEFAULTS["max_tokens"],
    temperature: float = DEFAULTS["temperature"],
    system: str | None = None,
    sampling: dict | None = None,
    max_time_s: float | None = None,
) -> dict:
    """Generate text with repetition detection and context monitoring.

    Routes to oMLX/LM Studio (if omlx_url configured and reachable),
    falls back to direct mlx_lm. A stable `system` prompt improves rule
    adherence and lets the server's prefix cache reuse the static prefix.
    `sampling` carries extra OpenAI-compatible params (top_p, top_k,
    presence_penalty, min_p) — the server does NOT read the model's
    generation_config.json, so card-recommended values must be sent
    per-request. Only honored on the oMLX path.
    `max_time_s` caps the request's wall-clock budget (socket timeout and
    retry backoff) below the configured request_timeout_s, so a caller with
    its own deadline (the agent loop, #61) is never blocked longer than its
    remaining budget. Like `sampling`, only honored on the oMLX path.
    Returns {"text": str, "tokens": int, "time_s": float, "model": str,
             "escalated": bool, "abort_reason": str|None, "context": dict}.
    """
    if _omlx_available():
        config = load_config()
        return _omlx_generate(
            prompt,
            model_id,
            max_tokens,
            temperature,
            config.get("omlx_url"),
            system,
            sampling,
            timeout_s=config.get("request_timeout_s", 300),
            max_time_s=max_time_s,
        )

    from mlx_lm import stream_generate

    model, tokenizer = load_model(model_id)

    if system:
        prompt = f"{system}\n\n{prompt}"

    budget = check_context_budget(prompt, max_tokens, model_id)
    if not budget["fits"]:
        return {
            "text": "",
            "tokens": 0,
            "time_s": 0,
            "model": model_id,
            "escalated": True,
            "abort_reason": f"prompt ({budget['prompt_tokens']} tokens) + max_output ({max_tokens}) exceeds context window ({budget['window']})",
            "context": budget,
        }

    config = load_config()
    ngram_size = config.get("repetition_ngram_size", DEFAULTS["repetition_ngram_size"])
    max_count = config.get("repetition_max_count", DEFAULTS["repetition_max_count"])
    kv_bits = config.get("kv_bits", DEFAULTS["kv_bits"])
    kv_group_size = config.get("kv_group_size", DEFAULTS["kv_group_size"])
    max_kv_size = config.get("max_kv_size", DEFAULTS["max_kv_size"])

    kv_kwargs: dict = {}
    if kv_bits is not None:
        kv_kwargs["kv_bits"] = kv_bits
        kv_kwargs["kv_group_size"] = kv_group_size
    if max_kv_size is not None:
        kv_kwargs["max_kv_size"] = max_kv_size

    start = time.monotonic()
    text = ""
    token_count = 0
    abort_reason = None

    for response in stream_generate(
        model, tokenizer, prompt, max_tokens=max_tokens, **kv_kwargs
    ):
        text += response.text
        token_count += 1

        if token_count % 50 == 0 and _detect_repetition(text, ngram_size, max_count):
            abort_reason = "repetition_detected"
            break

        if ESCALATE in text:
            abort_reason = "model_requested_escalation"
            break

    elapsed = time.monotonic() - start

    if abort_reason == "repetition_detected":
        last_good = text[: len(text) // 2]
        text = last_good

    output = {
        "text": text,
        "tokens": token_count,
        "time_s": round(elapsed, 2),
        "model": model_id,
        "escalated": abort_reason is not None,
        "abort_reason": abort_reason,
        "context": budget,
    }
    _log_metric(output)
    return output


# ── Structured generation ────────────────────────────────────────────────────


def _check_output_quality(text: str) -> dict:
    """Post-generation quality check for any text output."""
    import re

    config = load_config()
    mt_config = config.get("multi_turn", {})
    qg = mt_config.get("quality_gates", MULTI_TURN_DEFAULTS.get("quality_gates", {}))

    if len(text) > 30:
        tail_len = max(100, len(text) // 2)
        chars = list(text[-tail_len:])
        char_counts: dict[str, int] = {}
        for c in chars:
            char_counts[c] = char_counts.get(c, 0) + 1
        most_common_pct = max(char_counts.values()) / len(chars) if chars else 0
        if most_common_pct > qg.get("char_flood_pct", 0.3) and len(chars) > 20:
            dominant = max(char_counts, key=char_counts.get)  # type: ignore[arg-type]
            return {
                "ok": False,
                "reason": f"char_flood_{repr(dominant)}_{most_common_pct:.0%}",
            }

    tokens = re.split(r"[\s.,;:!?]+", text)
    tokens = [t for t in tokens if t]
    if len(tokens) < 6:
        return {"ok": True, "reason": None}

    if _detect_repetition(
        text, ngram_size=qg.get("ngram_size", 3), max_count=qg.get("max_count", 4)
    ):
        return {"ok": False, "reason": "repetition_in_output"}

    if _detect_repetition(" ".join(tokens), ngram_size=1, max_count=6):
        return {"ok": False, "reason": "single_token_repetition"}

    unique = set(t.lower() for t in tokens)
    ratio = len(unique) / len(tokens)
    if len(tokens) > 15 and ratio < qg.get("diversity_ratio", 0.25):
        return {"ok": False, "reason": f"low_lexical_diversity_{ratio:.2f}"}

    return {"ok": True, "reason": None}


def structured(
    prompt: str,
    schema,
    model_id: str = DEFAULTS["model"],
    max_tokens: int = 500,
    **kwargs,
) -> dict:
    """Grammar-constrained generation via oMLX (preferred) or outlines + MLX.

    Routes to oMLX JSON schema response_format if server is available,
    falls back to outlines grammar-constrained generation otherwise.
    `max_time_s` (kwarg) caps the request's wall-clock budget below the
    configured request_timeout_s — only honored on the oMLX path (#61).
    Returns {"data": dict, "raw": str, "tokens": int, "time_s": float,
             "model": str, "quality": dict}.
    """
    if _omlx_available():
        omlx_config = load_config()
        return _omlx_structured(
            prompt,
            schema,
            model_id,
            max_tokens,
            omlx_config.get("omlx_url"),
            temperature=kwargs.get("temperature"),
            timeout_s=omlx_config.get("request_timeout_s", 300),
            max_time_s=kwargs.get("max_time_s"),
        )

    try:
        import outlines
    except ImportError:
        raise RuntimeError("Grammar support requires: pip install outlines")

    config = load_config()
    kv_bits = config.get("kv_bits", DEFAULTS["kv_bits"])
    kv_group_size = config.get("kv_group_size", DEFAULTS["kv_group_size"])
    max_kv_size = config.get("max_kv_size", DEFAULTS["max_kv_size"])

    kv_kwargs: dict = {}
    if kv_bits is not None:
        kv_kwargs["kv_bits"] = kv_bits
        kv_kwargs["kv_group_size"] = kv_group_size
    if max_kv_size is not None:
        kv_kwargs["max_kv_size"] = max_kv_size
    if "prompt_cache" in kwargs:
        kv_kwargs["prompt_cache"] = kwargs["prompt_cache"]

    model, tokenizer = load_model(model_id)
    mlx_model = outlines.from_mlxlm(model, tokenizer)
    try:
        gen = outlines.Generator(mlx_model, schema, whitespace_pattern=r"[ ]?")
    except TypeError:
        gen = outlines.Generator(mlx_model, schema)

    start = time.monotonic()
    raw = gen(prompt, max_tokens=max_tokens, **kv_kwargs)
    elapsed = time.monotonic() - start

    data = json.loads(raw) if isinstance(raw, str) else raw
    raw_str = raw if isinstance(raw, str) else json.dumps(raw)

    quality = _check_structured_quality(data)

    output = {
        "data": data,
        "raw": raw_str,
        "tokens": len(tokenizer.encode(raw_str)),
        "time_s": round(elapsed, 2),
        "model": model_id,
        "quality": quality,
    }
    _log_metric(output)
    return output


def _check_structured_quality(data) -> dict:
    if not isinstance(data, dict):
        return {"ok": True, "reason": None}
    for k, v in data.items():
        if isinstance(v, str) and len(v) > 15:
            q = _check_output_quality(v)
            if not q["ok"]:
                return {"ok": False, "reason": f"{k}: {q['reason']}"}
    return {"ok": True, "reason": None}


# ── Two-pass DCCD generation ──────────────────────────────────────────────


def two_pass_structured(
    prompt: str,
    schema,
    model_id: str = DEFAULTS["model"],
    max_tokens: int = 500,
    draft_max_tokens: int = 300,
    **kwargs,
) -> dict:
    """DCCD-style: freeform draft first, then grammar-constrained extraction.

    Step 1: chat() generates unconstrained reasoning
    Step 2: structured() extracts schema-compliant data using draft as context
    """
    messages = [{"role": "user", "content": prompt}]
    draft = chat(messages, model_id, draft_max_tokens)

    draft_text = draft.get("text", "")
    if draft.get("escalated") or not draft_text.strip():
        return structured(prompt, schema, model_id, max_tokens, **kwargs)

    extraction_prompt = (
        f"Based on this analysis:\n{draft_text[:500]}\n\n"
        f"Extract the answer as JSON matching the schema. "
        f"Be concise — one sentence per field."
    )
    result = structured(extraction_prompt, schema, model_id, max_tokens, **kwargs)
    result["draft"] = draft_text[:500]
    result["tokens"] = result.get("tokens", 0) + draft.get("tokens", 0)
    result["time_s"] = round(result.get("time_s", 0) + draft.get("time_s", 0), 2)
    return result


# ── Self-consistency voting ────────────────────────────────────────────────


def vote_structured(
    prompt: str,
    schema,
    model_id: str = DEFAULTS["model"],
    max_tokens: int = 500,
    n: int = 3,
    use_two_pass: bool = False,
    **kwargs,
) -> dict:
    """Generate N samples, filter for quality, vote on Literal fields.

    Returns the consensus result with agreement_score replacing self-reported
    confidence. Escalates if no quality samples survive.
    """
    gen_fn = two_pass_structured if use_two_pass else structured
    samples = []
    total_tokens = 0
    total_time = 0.0

    for _ in range(n):
        result = gen_fn(prompt, schema, model_id, max_tokens, **kwargs)
        total_tokens += result.get("tokens", 0)
        total_time += result.get("time_s", 0)
        quality = result.get("quality", {})
        if quality.get("ok", True):
            samples.append(result)

    if not samples:
        return {
            "data": None,
            "raw": "",
            "tokens": total_tokens,
            "time_s": round(total_time, 2),
            "model": model_id,
            "quality": {"ok": False, "reason": f"all_{n}_samples_failed_quality"},
            "agreement_score": 0.0,
            "samples_generated": n,
            "samples_valid": 0,
        }

    literal_fields = _find_literal_fields(schema)
    if literal_fields and len(samples) > 1:
        best, agreement = _majority_vote(samples, literal_fields)
    else:
        best = samples[0].get("data", {})
        agreement = 1.0 if len(samples) == 1 else 0.5

    if isinstance(best, dict) and "confidence" in best:
        best["confidence"] = round(agreement, 2)

    return {
        "data": best,
        "raw": json.dumps(best),
        "tokens": total_tokens,
        "time_s": round(total_time, 2),
        "model": model_id,
        "quality": {"ok": True, "reason": None},
        "agreement_score": round(agreement, 2),
        "samples_generated": n,
        "samples_valid": len(samples),
    }


def _find_literal_fields(schema) -> list[str]:
    """Extract field names that have Literal type annotations."""
    import typing

    fields = []
    for name, field_info in schema.model_fields.items():
        origin = typing.get_origin(field_info.annotation)
        if origin is typing.Literal:
            fields.append(name)
    return fields


def _majority_vote(
    samples: list[dict], literal_fields: list[str]
) -> tuple[dict, float]:
    """Vote on Literal fields across samples. Returns (best_data, agreement)."""
    votes: dict[str, dict[str, int]] = {f: {} for f in literal_fields}

    for sample in samples:
        data = sample.get("data", {})
        if not isinstance(data, dict):
            continue
        for field in literal_fields:
            val = data.get(field)
            if val is not None:
                val_str = str(val)
                votes[field][val_str] = votes[field].get(val_str, 0) + 1

    consensus: dict[str, str] = {}
    total_agreement = 0.0
    for field in literal_fields:
        if not votes[field]:
            continue
        winner = max(votes[field], key=votes[field].get)  # type: ignore[arg-type]
        winner_count = votes[field][winner]
        consensus[field] = winner
        total_agreement += winner_count / len(samples)

    avg_agreement = total_agreement / len(literal_fields) if literal_fields else 0.5

    best_data = samples[0].get("data", {})
    if isinstance(best_data, dict):
        best_data = {**best_data, **consensus}

    return best_data, avg_agreement


# ── Chat interface ───────────────────────────────────────────────────────────


def chat(
    messages: list[dict],
    model_id: str = DEFAULTS["model"],
    max_tokens: int = DEFAULTS["max_tokens"],
    temperature: float = DEFAULTS["temperature"],
) -> dict:
    """Chat-style inference with context monitoring.

    messages: [{"role": "user"|"assistant"|"system", "content": str}, ...]
    Returns generate() result dict with escalation info.
    """
    model, tokenizer = load_model(model_id)

    if hasattr(tokenizer, "apply_chat_template"):
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    else:
        prompt = "\n".join(f"{m['role']}: {m['content']}" for m in messages)

    return generate(prompt, model_id, max_tokens, temperature)


# ── Pipeline integration ─────────────────────────────────────────────────────


def run_phase(
    phase: str,
    prompt: str,
    schema=None,
    max_tokens: int = DEFAULTS["max_tokens"],
    mt_overrides: dict | None = None,
) -> dict:
    """Run a pipeline phase locally if available, with escalation signal.

    Auto-routes to multi_turn_phase() when multi-turn is enabled for this phase.
    Returns {"result": dict, "escalated": bool, "phase": str}.
    If escalated=True, the caller should retry with Claude.
    """
    if not should_use_local(phase):
        return {
            "result": None,
            "escalated": True,
            "phase": phase,
            "reason": "phase_not_local",
        }

    mt_config = _load_multi_turn_config(phase)
    if mt_overrides:
        mt_config.update(mt_overrides)
    if mt_config.get("enabled") and phase in mt_config.get("phases", []):
        return multi_turn_phase(phase, prompt, schema, max_tokens, mt_overrides)

    model_id = get_model_for_phase(phase)

    try:
        if schema:
            result = structured(prompt, schema, model_id, max_tokens=max_tokens)
            return {"result": result, "escalated": False, "phase": phase}
        else:
            messages = [{"role": "user", "content": prompt}]
            result = chat(messages, model_id, max_tokens)

            if result.get("escalated"):
                return {
                    "result": result,
                    "escalated": True,
                    "phase": phase,
                    "reason": result.get("abort_reason"),
                }
            return {"result": result, "escalated": False, "phase": phase}
    except Exception as e:
        return {
            "result": {"error": str(e)},
            "escalated": True,
            "phase": phase,
            "reason": f"exception: {e}",
        }


# ── Multi-turn orchestration ────────────────────────────────────────────────


def _resolve_temperature(
    turn: int,
    max_turns: int,
    schedule: str,
    base: float,
    t_min: float,
    t_max: float,
) -> float:
    if schedule == "fixed":
        return base
    progress = turn / max(max_turns - 1, 1)
    if schedule == "rising":
        return t_min + (t_max - t_min) * progress
    if schedule == "falling":
        return t_max - (t_max - t_min) * progress
    if schedule == "u_curve":
        mid = max_turns / 2
        dist = abs(turn - mid) / mid
        return t_min + (t_max - t_min) * dist
    return base


def _build_turn_prompt(
    phase: str,
    original_prompt: str,
    history: list[dict],
    turn: int,
    plan: dict | None,
    mt_config: dict,
) -> str:
    parts = []

    use_few_shot = mt_config.get("few_shot", True)

    tools_enabled = mt_config.get("enable_tool_execution", False)
    action_enum = "analyze, decompose, execute, verify, synthesize"
    if tools_enabled:
        action_enum += ", tool_execution"

    if turn == 0 and mt_config.get("planning_turn", True):
        parts.append(
            "You are in PLANNING mode. Produce a short step-by-step plan.\n"
            "Output JSON: {steps: [{action, description}], rationale}.\n"
            f"Actions: {action_enum}.\n"
            "Max 4 steps. Each description under 80 chars. Rationale under 80 chars.\n"
        )
        if tools_enabled:
            allowed = mt_config.get("allowed_tools", [])
            parts.append(
                f"Available tools: {', '.join(allowed)}\n"
                "Use tool_execution steps to call tools. Each step can call one tool.\n"
            )
        if use_few_shot:
            parts.append(f"Example output:\n{json.dumps(PLAN_FEW_SHOT)}\n")
        parts.append(f"Phase: {phase}\n")
        parts.append(f"Problem:\n{original_prompt}")
        return "\n".join(parts)

    if plan and turn <= len(plan.get("steps", [])):
        step_idx = turn - 1 if mt_config.get("planning_turn", True) else turn
        steps = plan.get("steps", [])
        if step_idx < len(steps):
            step = steps[step_idx]
            parts.append(
                f"Execute step {step_idx + 1}/{len(steps)}: "
                f"{step['action'].upper()} — {step['description']}\n"
            )

    if history:
        parts.append("Context from previous turns:")
        for h in history[-3:]:
            content = h.get("content", "")
            if len(content) > 300:
                content = content[:300] + "..."
            parts.append(f"  {content}")
        parts.append("")

    parts.append(f"Phase: {phase}")
    parts.append(f"Problem:\n{original_prompt}")

    if tools_enabled:
        allowed = mt_config.get("allowed_tools", [])
        parts.append(
            f"\nAvailable tools: {', '.join(allowed)}"
            '\nTo call a tool, set action to "tool_execution" and include a tool_call field:'
            '\n  "action": "tool_execution",'
            '\n  "tool_call": {"tool_name": "<name>", "tool_args": {"arg1": "val1"}}'
            "\nThe tool result will be returned to you for the next turn."
            "\nWhen you are done (no more tools needed), use a non-tool action"
            " with needs_more_turns: false."
        )

    if use_few_shot:
        if tools_enabled:
            tool_few_shot = {
                "step_index": 1,
                "action": "tool_execution",
                "finding": "Need to read file before modifying",
                "evidence": "Must understand current code structure",
                "recommendation": "proceed",
                "confidence": 0.8,
                "needs_more_turns": True,
                "escalate": False,
                "tool_call": {
                    "tool_name": "read_file",
                    "tool_args": {"path": "example.py"},
                },
            }
            parts.append(f"\nExample tool call:\n{json.dumps(tool_few_shot)}")
            parts.append(
                f"\nExample final turn (no tool):\n{json.dumps(STEP_FEW_SHOT)}"
            )
        else:
            parts.append(f"\nExample output:\n{json.dumps(STEP_FEW_SHOT)}")
        parts.append(
            "\nNow produce YOUR answer as JSON with the same fields."
            "\nBe specific. One sentence per field."
        )
    else:
        parts.append(
            "\nOutput JSON with these exact fields:"
            f"\n  step_index: int, action: one of {action_enum},"
            "\n  finding: str (max 80 chars), evidence: str (max 80 chars),"
            "\n  recommendation: one of deepen/properties/escalate/proceed/block/retest,"
            "\n  confidence: float 0-1, needs_more_turns: bool, escalate: bool"
            "\nBe specific. One sentence per field."
        )
        if tools_enabled:
            parts.append(
                '\nFor tool calls, add: "tool_call": {"tool_name": "...", "tool_args": {...}}'
            )
    return "\n".join(parts)


def _is_final_turn(
    turn: int,
    step_result: dict | None,
    plan: dict | None,
    mt_config: dict,
) -> bool:
    if step_result and step_result.get("escalate"):
        return True
    if step_result and not step_result.get("needs_more_turns"):
        return True
    if step_result:
        confidence = step_result.get("confidence", 0)
        if confidence >= mt_config.get("confidence_threshold", 0.8):
            if not step_result.get("needs_more_turns"):
                return True
    if plan:
        total_steps = len(plan.get("steps", []))
        offset = 1 if mt_config.get("planning_turn", True) else 0
        if turn >= total_steps + offset:
            return True
    return False


def _truncate_tool_output(output: str, max_chars: int = 4000) -> tuple[str, bool]:
    if len(output) <= max_chars:
        return output, False
    half = max_chars // 2
    truncated = (
        output[:half]
        + f"\n\n... [Output truncated: {len(output) - max_chars} chars removed for Progressive Disclosure] ...\n\n"
        + output[-half:]
    )
    return truncated, True


READ_ONLY_TOOLS = frozenset(
    {
        "read_file",
        "read_file_range",
        "list_dir",
        "grep_search",
        "run_command",
        "read_todos",
    }
)
WRITE_TOOLS = frozenset(
    {
        "write_to_file",
        "replace_file_content",
        "multi_replace_file_content",
        "write_todos",
    }
)
# Write tools that persist to a FIXED loop-owned path under .datum/ and take
# no 'path' arg (#70: write_todos -> .datum/todos.json). They are write-gated
# like every WRITE_TOOL (enable_write_tools, sandbox), but the agent loop's
# path-centric guards (path-arg requirement, read-before-write) and the #67
# done-verification arming do not apply — bookkeeping never mutates source.
PATHLESS_WRITE_TOOLS = frozenset({"write_todos"})
BLOCKED_COMMANDS = frozenset(
    {
        "rm",
        "rm -rf",
        "git push",
        "git reset",
        "chmod",
        "chown",
        "curl",
        "wget",
        "ssh",
        "scp",
        "eval",
        "exec",
    }
)


def _execute_tool(tool_call: dict, mt_config: dict) -> tuple[str, bool]:
    import subprocess

    tool_name = tool_call.get("tool_name", "")
    tool_args = tool_call.get("tool_args", {})

    allowed = mt_config.get("allowed_tools", list(READ_ONLY_TOOLS))
    if tool_name not in allowed:
        return f"Error: Tool '{tool_name}' is not in allowed_tools list.", False

    if tool_name in WRITE_TOOLS and not mt_config.get("enable_write_tools", False):
        return (
            f"Error: Write tool '{tool_name}' blocked. "
            f"Set enable_write_tools = true in [multi_turn] to allow."
        ), False

    if tool_name in WRITE_TOOLS:
        repo_root = Path.cwd().resolve()
        allowed_dirs = [repo_root]
        for extra in mt_config.get("allowed_write_dirs", []):
            allowed_dirs.append(Path(extra).resolve())

        for arg_key, arg_val in tool_args.items():
            if not isinstance(arg_val, str):
                continue
            if "/" in arg_val or arg_val.endswith(
                (".py", ".md", ".toml", ".json", ".txt", ".yaml", ".yml")
            ):
                try:
                    resolved_path = Path(arg_val).resolve()
                    if not any(resolved_path.is_relative_to(d) for d in allowed_dirs):
                        return (
                            f"Error: Sandbox violation. Arg '{arg_key}' path "
                            f"'{arg_val}' escapes allowed roots.",
                            False,
                        )
                except Exception as e:
                    return f"Error resolving path in '{arg_key}': {e}", False

    if tool_name == "run_command" and "command" in tool_args:
        cmd_str = str(tool_args["command"]).strip()
        cmd_base = cmd_str.split()[0] if cmd_str else ""
        if cmd_base in BLOCKED_COMMANDS or cmd_str in BLOCKED_COMMANDS:
            return f"Error: Command '{cmd_base}' is blocked for safety.", False
        if any(c in cmd_str for c in ["|", ";", "&&", "$(", "`"]):
            return (
                "Error: Shell operators (pipes, chains, subshells) are blocked.",
                False,
            )
        if not cmd_str.startswith("rtk "):
            tool_args["command"] = f"rtk proxy {cmd_str}"

    if not isinstance(tool_args, dict):
        return "Error: tool_args must be a dict.", False

    cmd = [
        sys.executable,
        "-m",
        "datum.lane_tools_runner",
        tool_name,
        json.dumps(tool_args),
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            cwd=Path(".").resolve(),
        )
        out = proc.stdout
        if proc.stderr:
            out += "\nSTDERR:\n" + proc.stderr
        if not out.strip():
            out = f"Tool exited with code {proc.returncode} (no output)"
        return _truncate_tool_output(out)
    except subprocess.TimeoutExpired:
        return "Error: Tool execution timed out (60s limit).", False
    except Exception as e:
        return f"Error executing tool: {e}", False


def multi_turn_phase(
    phase: str,
    prompt: str,
    schema=None,
    max_tokens: int = DEFAULTS["max_tokens"],
    mt_overrides: dict | None = None,
) -> dict:
    """Multi-turn local inference with planning, execution, and verification.

    Returns {"result": dict, "escalated": bool, "phase": str, "turns": list,
             "total_tokens": int, "total_time_s": float}.
    """
    if not should_use_local(phase):
        return {
            "result": None,
            "escalated": True,
            "phase": phase,
            "reason": "phase_not_local",
            "turns": [],
        }

    mt_config = _load_multi_turn_config(phase)
    if mt_overrides:
        mt_config.update(mt_overrides)

    if not mt_config.get("enabled", False):
        return run_phase(phase, prompt, schema, max_tokens)

    config = load_config()
    model_id = get_model_for_phase(phase)
    max_turns = (
        mt_config.get("max_tool_turns", 10)
        if mt_config.get("enable_tool_execution", False)
        else mt_config.get("max_turns", 5)
    )
    total_timeout = mt_config.get("timeout_s", 300)
    turn_timeout = mt_config.get("turn_timeout_s", 90)

    window = config.get("context_window", DEFAULTS["context_window"])
    reserve = mt_config.get("context_reserve_pct", 20) / 100
    usable_window = int(window * (1 - reserve))

    history: list[dict] = []
    turns_log: list[dict] = []
    plan: dict | None = None
    total_tokens = 0
    total_start = time.monotonic()

    _mt_cache = None
    try:
        from mlx_lm.models.cache import make_prompt_cache as _make_cache

        model, tokenizer = load_model(model_id)
        _mt_cache = _make_cache(model, max_kv_size=config.get("max_kv_size"))
    except Exception:
        pass

    for turn in range(max_turns):
        elapsed_total = time.monotonic() - total_start
        if elapsed_total >= total_timeout:
            turns_log.append({"turn": turn, "abort": "total_timeout"})
            return _mt_escalate(
                phase, turns_log, total_tokens, elapsed_total, "total_timeout_exceeded"
            )

        temperature = _resolve_temperature(
            turn,
            max_turns,
            mt_config.get("temperature_schedule", "fixed"),
            config.get("temperature", DEFAULTS["temperature"]),
            mt_config.get("temperature_min", 0.2),
            mt_config.get("temperature_max", 0.7),
        )

        turn_prompt = _build_turn_prompt(phase, prompt, history, turn, plan, mt_config)

        prompt_tokens = count_tokens(turn_prompt, model_id)
        if prompt_tokens > usable_window:
            turns_log.append({"turn": turn, "abort": "context_exhausted"})
            return _mt_escalate(
                phase,
                turns_log,
                total_tokens,
                time.monotonic() - total_start,
                "context_exhausted",
            )

        turn_max_tokens = min(
            max_tokens,
            usable_window - prompt_tokens,
            int(turn_timeout * 65),
        )

        turn_start = time.monotonic()
        use_two_pass = mt_config.get("two_pass", True)
        n_samples = mt_config.get("consistency_samples", 3)

        offset = _cache_offset(_mt_cache)
        turn_prompt_to_pass = turn_prompt

        if offset > 0:
            model, tokenizer = load_model(model_id)
            tokens = tokenizer.encode(turn_prompt)
            if offset < len(tokens):
                turn_prompt_to_pass = tokenizer.decode(tokens[offset:])

        try:
            if turn == 0 and mt_config.get("planning_turn", True):
                from datum.schemas import StepPlan

                if use_two_pass:
                    result = two_pass_structured(
                        turn_prompt_to_pass,
                        StepPlan,
                        model_id,
                        max_tokens=turn_max_tokens,
                        **(
                            {"prompt_cache": _mt_cache} if _mt_cache is not None else {}
                        ),
                    )
                else:
                    result = structured(
                        turn_prompt_to_pass,
                        StepPlan,
                        model_id,
                        max_tokens=turn_max_tokens,
                        **(
                            {"prompt_cache": _mt_cache} if _mt_cache is not None else {}
                        ),
                    )
                quality = result.get("quality", {})
                if not quality.get("ok", True):
                    turns_log.append(
                        {"turn": turn, "abort": f"quality_fail: {quality['reason']}"}
                    )
                    return _mt_escalate(
                        phase,
                        turns_log,
                        total_tokens,
                        time.monotonic() - total_start,
                        f"plan_quality_fail: {quality['reason']}",
                    )
                plan = result.get("data", {})
                turn_data = {
                    "turn": turn,
                    "type": "plan",
                    "data": plan,
                    "tokens": result.get("tokens", 0),
                    "time_s": result.get("time_s", 0),
                    "temperature": temperature,
                }
            else:
                from datum.schemas import StepResult as StepResultSchema

                result = vote_structured(
                    turn_prompt_to_pass,
                    StepResultSchema,
                    model_id,
                    max_tokens=turn_max_tokens,
                    n=n_samples,
                    use_two_pass=use_two_pass,
                    **({"prompt_cache": _mt_cache} if _mt_cache is not None else {}),
                )

                if result.get("data") is None:
                    quality = result.get("quality", {})
                    turns_log.append(
                        {
                            "turn": turn,
                            "abort": f"vote_failed: {quality.get('reason', 'no_valid_samples')}",
                        }
                    )
                    return _mt_escalate(
                        phase,
                        turns_log,
                        total_tokens,
                        time.monotonic() - total_start,
                        f"vote_failed_{result.get('samples_valid', 0)}_of_{n_samples}",
                    )

                turn_data = {
                    "turn": turn,
                    "type": "step",
                    "data": result["data"],
                    "tokens": result.get("tokens", 0),
                    "time_s": result.get("time_s", 0),
                    "agreement": result.get("agreement_score", 0),
                    "samples": f"{result.get('samples_valid', 0)}/{n_samples}",
                    "temperature": temperature,
                }

        except Exception as e:
            turns_log.append({"turn": turn, "abort": f"exception: {e}"})
            return _mt_escalate(
                phase,
                turns_log,
                total_tokens,
                time.monotonic() - total_start,
                f"exception: {e}",
            )

        turn_elapsed = time.monotonic() - turn_start
        if turn_elapsed >= turn_timeout and turn < max_turns - 1:
            turn_data["warning"] = "turn_timeout_hit"

        if mt_config.get("enable_tool_execution", False):
            turn_data_dict = turn_data.get("data", {})
            if (
                isinstance(turn_data_dict, dict)
                and turn_data_dict.get("action") == "tool_execution"
            ):
                tool_call = turn_data_dict.get("tool_call")
                if tool_call:
                    tool_start_time = time.monotonic()
                    tool_output, was_truncated = _execute_tool(tool_call, mt_config)
                    tool_time_s = time.monotonic() - tool_start_time
                    tool_name = tool_call.get("tool_name", "unknown")

                    history.append(
                        {"role": "assistant", "content": json.dumps(turn_data_dict)}
                    )

                    user_content = f"Tool execution result:\n<untrusted>\n{tool_output}\n</untrusted>\nAnalyze the result and decide next action."
                    if was_truncated:
                        user_content += "\n\nSystem Note: The tool output was extremely long and has been truncated. If you need the missing lines, use a more precise tool (like 'read_file_range' or 'grep_search')."

                    history.append(
                        {
                            "role": "user",
                            "content": user_content,
                        }
                    )
                    turns_log.append(turn_data)
                    turns_log.append(
                        {
                            "turn": turn,
                            "type": "tool_output",
                            "tool_name": tool_name,
                            "time_s": round(tool_time_s, 2),
                            "length": len(tool_output),
                        }
                    )
                    total_tokens += turn_data.get("tokens", 0)
                    continue

        total_tokens += turn_data.get("tokens", 0)
        turns_log.append(turn_data)
        history.append(
            {"role": "assistant", "content": json.dumps(turn_data.get("data", {}))}
        )

        if turn > 0 and _is_final_turn(turn, turn_data.get("data"), plan, mt_config):
            if turn_data.get("data", {}).get("escalate"):
                reason = turn_data["data"].get("escalate_reason", "model_requested")
                return _mt_escalate(
                    phase,
                    turns_log,
                    total_tokens,
                    time.monotonic() - total_start,
                    reason,
                )
            break

    total_elapsed = time.monotonic() - total_start

    if mt_config.get("verification_turn", True) and schema:
        synthesis_prompt = _build_synthesis_prompt(phase, prompt, turns_log, schema)
        try:
            final = structured(
                synthesis_prompt, schema, model_id, max_tokens=max_tokens
            )
            total_tokens += final.get("tokens", 0)
            turns_log.append(
                {
                    "turn": len(turns_log),
                    "type": "synthesis",
                    "tokens": final.get("tokens", 0),
                    "time_s": final.get("time_s", 0),
                }
            )
            result_data = final
        except Exception as e:
            return _mt_escalate(
                phase,
                turns_log,
                total_tokens,
                time.monotonic() - total_start,
                f"synthesis_failed: {e}",
            )
    else:
        last_step = next(
            (t for t in reversed(turns_log) if t.get("type") == "step"),
            turns_log[-1] if turns_log else {},
        )
        result_data = {
            "data": last_step.get("data", {}),
            "raw": json.dumps(last_step.get("data", {})),
        }

    output = {
        "result": result_data,
        "escalated": False,
        "phase": phase,
        "turns": turns_log,
        "total_tokens": total_tokens,
        "total_time_s": round(total_elapsed, 2),
    }
    _log_multi_turn_metric(output)
    return output


def _mt_escalate(
    phase: str,
    turns: list[dict],
    total_tokens: int,
    elapsed: float,
    reason: str,
) -> dict:
    output = {
        "result": None,
        "escalated": True,
        "phase": phase,
        "reason": reason,
        "turns": turns,
        "total_tokens": total_tokens,
        "total_time_s": round(elapsed, 2),
    }
    _log_multi_turn_metric(output)
    return output


def _build_synthesis_prompt(
    phase: str,
    original_prompt: str,
    turns: list[dict],
    schema,
) -> str:
    parts = [
        f"Phase: {phase}",
        f"Original problem:\n{original_prompt}\n",
        "You completed a multi-step analysis. Here are your findings:\n",
    ]
    for t in turns:
        if t.get("type") == "plan":
            parts.append(f"Plan: {json.dumps(t.get('data', {}))}")
        elif t.get("type") == "step":
            parts.append(f"Step {t.get('turn', '?')}: {json.dumps(t.get('data', {}))}")
    parts.append(
        "\nSynthesize all findings into one final answer. "
        f"Output JSON matching the {schema.__name__} schema."
    )
    return "\n".join(parts)


def _load_multi_turn_config(phase: str) -> dict:
    mt = {}
    mt.update(MULTI_TURN_DEFAULTS)

    raw_config = _load_raw_config()
    if "multi_turn" in raw_config:
        mt.update(raw_config["multi_turn"])
    phase_key = f"multi_turn.{phase}"
    if phase_key in raw_config:
        mt.update(raw_config[phase_key])
    elif "multi_turn" in raw_config and "phase_overrides" in raw_config["multi_turn"]:
        overrides = raw_config["multi_turn"]["phase_overrides"]
        if phase in overrides:
            mt.update(overrides[phase])

    return mt


def _load_raw_config() -> dict:
    import os

    project_dir = os.environ.get("DATUM_PROJECT_DIR", ".")
    for config_path in [
        Path(project_dir) / ".datum/config.toml",
        Path(".datum/config.toml"),
        Path("assets/config.toml.default"),
    ]:
        if not config_path.exists():
            continue
        try:
            import tomllib
        except ImportError:
            try:
                import tomli as tomllib
            except ImportError:
                return {}
        with config_path.open("rb") as f:
            return tomllib.load(f)
    return {}


def _log_multi_turn_metric(result: dict) -> None:
    import datetime

    entry = {
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
        "type": "multi_turn",
        "phase": result.get("phase", "unknown"),
        "turns": len(result.get("turns", [])),
        "total_tokens": result.get("total_tokens", 0),
        "total_time_s": result.get("total_time_s", 0),
        "escalated": result.get("escalated", False),
        "reason": result.get("reason"),
    }
    try:
        mp = _metrics_path()
        mp.parent.mkdir(parents=True, exist_ok=True)
        with mp.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


# ── Metrics ──────────────────────────────────────────────────────────────────


def _metrics_path() -> Path:
    from datum.path_utils import datum_dir

    return datum_dir() / "local-llm-metrics.jsonl"


def _log_metric(result: dict) -> None:
    import datetime

    entry = {
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
        "model": result.get("model", "unknown"),
        "tokens": result.get("tokens", 0),
        "time_s": result.get("time_s", 0),
        "tokens_per_sec": (
            round(result["tokens"] / result["time_s"], 1)
            if result.get("time_s", 0) > 0
            else 0
        ),
        "escalated": result.get("escalated", False),
        "abort_reason": result.get("abort_reason"),
    }
    try:
        mp = _metrics_path()
        mp.parent.mkdir(parents=True, exist_ok=True)
        with mp.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def get_metrics_summary() -> dict:
    mp = _metrics_path()
    if not mp.exists():
        return {"total_calls": 0, "total_tokens": 0, "total_time_s": 0}

    calls = []
    for line in mp.read_text().splitlines():
        if line.strip():
            try:
                calls.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not calls:
        return {"total_calls": 0, "total_tokens": 0, "total_time_s": 0}

    total_tokens = sum(c.get("tokens", 0) for c in calls)
    total_time = sum(c.get("time_s", 0) for c in calls)
    avg_tps = round(total_tokens / total_time, 1) if total_time > 0 else 0
    escalated = sum(1 for c in calls if c.get("escalated"))

    sonnet_cost_per_mtok = 3.0
    estimated_savings = round(total_tokens * sonnet_cost_per_mtok / 1_000_000, 4)

    return {
        "total_calls": len(calls),
        "total_tokens": total_tokens,
        "total_time_s": round(total_time, 1),
        "avg_tokens_per_sec": avg_tps,
        "estimated_savings_usd": estimated_savings,
        "escalated": escalated,
        "success_rate_pct": (
            round((len(calls) - escalated) / len(calls) * 100, 1) if calls else 0
        ),
        "first_call": calls[0].get("timestamp", ""),
        "last_call": calls[-1].get("timestamp", ""),
    }


# ── Config ───────────────────────────────────────────────────────────────────


def load_config() -> dict:
    import os

    project_dir = os.environ.get("DATUM_PROJECT_DIR", ".")
    for config_path in [
        Path(project_dir) / ".datum/config.toml",
        Path(".datum/config.toml"),
        Path("assets/config.toml.default"),
    ]:
        if not config_path.exists():
            continue
        try:
            import tomllib
        except ImportError:
            try:
                import tomli as tomllib
            except ImportError:
                return DEFAULTS.copy()
        with config_path.open("rb") as f:
            config = tomllib.load(f)
        local = config.get("local_llm", {})
        return {**DEFAULTS, **local}

    return DEFAULTS.copy()


def should_use_local(phase: str) -> bool:
    if not is_available():
        return False
    config = load_config()
    if not config.get("enabled", False):
        return False
    return phase in config.get("phases", [])


def get_model_for_phase(phase: str) -> str:
    """Return fast_model for low-complexity phases, model otherwise.

    Falls back to model if fast_model is not configured.
    """
    config = load_config()
    main_model = config.get("model", DEFAULTS["model"])
    fast_model = config.get("fast_model") or main_model
    fast_phases = config.get("fast_phases", DEFAULTS["fast_phases"])
    return fast_model if phase in fast_phases else main_model


# ── oMLX backend ─────────────────────────────────────────────────────────────


def _omlx_url() -> str | None:
    """Return configured oMLX base URL, or None if not set."""
    return load_config().get("omlx_url")


def _omlx_available() -> bool:
    """Return True if an OpenAI-compatible inference server is reachable.

    Tries /health first (oMLX), falls back to /v1/models (LM Studio, Ollama).
    """
    url = _omlx_url()
    if not url:
        return False
    for path in ("/health", "/v1/models"):
        try:
            resp = urllib.request.urlopen(  # nosemgrep: ssrf-prevention, dynamic-urllib-use-detected -- local-only oMLX endpoint from config, no user input
                f"{url}{path}", timeout=1
            )
            if resp.status == 200:
                return True
        except Exception:
            continue
    return False


# Sampling knobs a caller may tune per-request. Protected request fields
# (model, messages, temperature, stream, ...) must come from the explicit
# parameters — a sampling dict can never override them.
_SAMPLING_KEYS = frozenset(
    {
        "top_p",
        "top_k",
        "min_p",
        "presence_penalty",
        "frequency_penalty",
        "repetition_penalty",
    }
)


def _sampling_params(sampling: dict | None) -> dict:
    """Filter a sampling dict down to the allowlisted tuning knobs."""
    if not sampling:
        return {}
    return {k: v for k, v in sampling.items() if k in _SAMPLING_KEYS}


_RETRYABLE_HTTP_CODES = frozenset({429, 503})
_OMLX_MAX_ATTEMPTS = 4


def _omlx_urlopen_with_retry(
    req: urllib.request.Request,
    timeout: int | float,
    max_attempts: int = _OMLX_MAX_ATTEMPTS,
    sleep_fn: Callable[[float], None] = time.sleep,
    deadline: float | None = None,
) -> object:
    """urlopen with jittered exponential backoff on 429/503/ConnectionRefused.

    Honors ``Retry-After`` response header when present.
    Non-retryable HTTP errors (400, 401, 500, ...) raise immediately.
    After *max_attempts* exhausted, re-raises the original error.
    *sleep_fn* is the backoff sleep (injectable for tests).
    ``deadline`` (time.monotonic() value) caps the whole call including
    retries (#61): each attempt's socket timeout shrinks to the remaining
    budget, and a backoff sleep that would land past the deadline re-raises
    the pending error instead.
    """
    import random as _random

    def _sleep_or_raise(delay: float, exc: Exception) -> None:
        if deadline is not None and time.monotonic() + delay >= deadline:
            raise exc
        sleep_fn(delay)

    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        attempt_timeout = timeout
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if last_exc is not None:
                    raise last_exc
                raise TimeoutError(
                    "request budget exhausted before issuing the request"
                )
            attempt_timeout = min(attempt_timeout, remaining)
        try:
            return urllib.request.urlopen(  # nosemgrep: ssrf-prevention, dynamic-urllib-use-detected -- local-only oMLX endpoint from config, no user input
                req, timeout=attempt_timeout
            )
        except urllib.error.HTTPError as exc:
            if exc.code not in _RETRYABLE_HTTP_CODES:
                raise
            last_exc = exc
            if attempt == max_attempts - 1:
                raise
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            if retry_after is not None:
                try:
                    delay = float(retry_after)
                except (ValueError, TypeError):
                    delay = 2**attempt
            else:
                delay = 2**attempt
            delay += _random.uniform(0, 1)
            _sleep_or_raise(delay, exc)
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, ConnectionRefusedError):
                last_exc = exc
                if attempt == max_attempts - 1:
                    raise
                delay = 2**attempt + _random.uniform(0, 1)
                _sleep_or_raise(delay, exc)
            else:
                raise
    # Unreachable, but satisfies the type checker.
    raise last_exc  # type: ignore[misc]


def _omlx_call(
    body: dict,
    url: str,
    timeout_s: int | float,
    deadline: float | None = None,
) -> tuple[dict, float]:
    """POST a chat-completions body to oMLX; return (response_data, elapsed_s).

    Shared by _omlx_generate and _omlx_structured: builds the request,
    applies the retry wrapper, measures wall-clock time, parses the JSON
    response, and validates its shape at the boundary (DPS-102).

    ``deadline`` (time.monotonic() value) is threaded through to the retry
    wrapper so the whole call — retries and backoff included — never runs
    past the caller's wall-clock budget (#61).

    A 200 response whose message content is missing/None/empty-string is
    RETRYABLE (Defect-3): the model occasionally emits only tokens the
    server's reasoning parser strips, yielding empty content.  Retries up
    to ``_OMLX_MAX_ATTEMPTS`` with exponential backoff before raising.

    Raises ValueError naming the model and URL when the response has a
    missing/empty "choices" list or no message content after retries.
    """
    import random as _random

    endpoint = f"{url}/v1/chat/completions"
    model_id = body.get("model", "<unknown>")

    for attempt in range(_OMLX_MAX_ATTEMPTS):
        payload = json.dumps(body).encode()
        req = urllib.request.Request(
            endpoint,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        t0 = time.monotonic()
        with _omlx_urlopen_with_retry(
            req, timeout=timeout_s, deadline=deadline
        ) as resp:
            data = json.loads(resp.read())
        elapsed = time.monotonic() - t0

        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            raise ValueError(
                f"oMLX response has missing or empty 'choices' "
                f"(model={model_id}, url={endpoint})"
            )
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message")
        content = message.get("content") if isinstance(message, dict) else None

        # Defect-3: treat missing/None/empty-string content as retryable.
        if content is not None and content != "":
            return data, elapsed

        # Empty content — retry with backoff unless exhausted.
        if attempt < _OMLX_MAX_ATTEMPTS - 1:
            delay = 2**attempt + _random.uniform(0, 1)
            if deadline is not None and time.monotonic() + delay >= deadline:
                break  # budget exhausted, fall through to raise
            time.sleep(delay)

    raise ValueError(
        f"oMLX response message has no content " f"(model={model_id}, url={endpoint})"
    )


def _omlx_generate(
    prompt: str,
    model_id: str,
    max_tokens: int,
    temperature: float,
    url: str,
    system: str | None = None,
    sampling: dict | None = None,
    timeout_s: int | float | None = None,
    max_time_s: float | None = None,
) -> dict:
    """Generate unstructured text via oMLX /v1/chat/completions.

    ``max_time_s`` caps the wall-clock budget for the request including
    retries: the socket timeout becomes min(request_timeout_s, max_time_s)
    and backoff never sleeps past the deadline (#61).
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    body = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
        **_sampling_params(sampling),
    }
    if timeout_s is None:
        timeout_s = load_config().get("request_timeout_s", 300)
    deadline = None
    if max_time_s is not None:
        timeout_s = min(timeout_s, max_time_s)
        deadline = time.monotonic() + max_time_s
    data, elapsed = _omlx_call(body, url, timeout_s, deadline=deadline)
    text = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    tokens = usage.get("completion_tokens", 0)
    escalated = ESCALATE in text
    return {
        "text": text,
        "tokens": tokens,
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "time_s": elapsed,
        "model": model_id,
        "escalated": escalated,
        "abort_reason": "model_requested_escalation" if escalated else None,
        "context": {},
    }


def _omlx_structured(
    prompt: str,
    schema,
    model_id: str,
    max_tokens: int,
    url: str,
    temperature: float | None = None,
    timeout_s: int | float | None = None,
    max_time_s: float | None = None,
) -> dict:
    """Grammar-constrained generation via oMLX JSON schema response_format.

    ``max_time_s`` caps the wall-clock budget exactly as in _omlx_generate.
    """
    json_schema = schema.model_json_schema()
    body: dict = {
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": schema.__name__,
                "schema": json_schema,
                "strict": True,
            },
        },
        "stream": False,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if timeout_s is None:
        timeout_s = load_config().get("request_timeout_s", 300)
    deadline = None
    if max_time_s is not None:
        timeout_s = min(timeout_s, max_time_s)
        deadline = time.monotonic() + max_time_s
    data, elapsed = _omlx_call(body, url, timeout_s, deadline=deadline)
    raw = data["choices"][0]["message"]["content"]
    parsed = json.loads(raw)
    # Fail fast at the boundary on schema mismatch (DPS-102). The return
    # type is unchanged: callers still receive the plain parsed dict.
    schema.model_validate(parsed)
    return {
        "data": parsed,
        "raw": raw,
        "tokens": data.get("usage", {}).get("completion_tokens", 0),
        "time_s": elapsed,
        "model": model_id,
        "quality": {"ok": True, "reason": None},
    }


def main() -> None:
    if len(sys.argv) < 2:
        config = load_config()
        print(json.dumps({"available": is_available(), "config": config}, indent=2))
        return

    prompt = " ".join(sys.argv[1:])
    if not is_available():
        print(json.dumps({"error": "MLX not available"}))
        sys.exit(1)

    config = load_config()
    try:
        print(f"Loading {config['model']}...", file=sys.stderr)
        result = generate(
            prompt,
            model_id=config["model"],
            max_tokens=config.get("max_tokens", DEFAULTS["max_tokens"]),
            temperature=config.get("temperature", DEFAULTS["temperature"]),
        )
        print(json.dumps(result, indent=2))
    except Exception as e:
        import traceback

        from datum.report_bug import _sanitize

        trace_str = _sanitize(traceback.format_exc())
        hint = (
            "\n[Agent Hint] If you are an AI, file a bug report for this using:\n"
            f'datum bugfile datum.local_llm "{type(e).__name__} in local_llm" --trace "<traceback>"\n'
        )
        print(
            f"DATUM encountered an unexpected error: {e}\n{trace_str}{hint}",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
