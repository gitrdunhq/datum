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
from pathlib import Path

_model_cache: dict = {}

DEFAULTS = {
    "enabled": False,
    "model": "mlx-community/gemma-4-26b-a4b-it-4bit",
    "max_tokens": 131072,
    "temperature": 0.3,
    "context_window": 131072,
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


def load_model(model_id: str = DEFAULTS["model"]):
    if model_id in _model_cache:
        return _model_cache[model_id]

    from mlx_lm import load

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
) -> dict:
    """Generate text with repetition detection and context monitoring.

    Returns {"text": str, "tokens": int, "time_s": float, "model": str,
             "escalated": bool, "abort_reason": str|None, "context": dict}.
    """
    from mlx_lm import stream_generate

    model, tokenizer = load_model(model_id)

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

    start = time.monotonic()
    text = ""
    token_count = 0
    abort_reason = None

    for response in stream_generate(model, tokenizer, prompt, max_tokens=max_tokens):
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


def structured(
    prompt: str,
    schema,
    model_id: str = DEFAULTS["model"],
    max_tokens: int = 500,
) -> dict:
    """Grammar-constrained generation using outlines + MLX.

    schema: a Pydantic BaseModel class. Output is guaranteed to match it.
    Returns {"data": dict, "raw": str, "tokens": int, "time_s": float, "model": str}.
    """
    try:
        import outlines
    except ImportError:
        raise RuntimeError("Grammar support requires: pip install outlines")

    model, tokenizer = load_model(model_id)
    mlx_model = outlines.from_mlxlm(model, tokenizer)
    gen = outlines.Generator(mlx_model, schema)

    start = time.monotonic()
    raw = gen(prompt, max_tokens=max_tokens)
    elapsed = time.monotonic() - start

    data = json.loads(raw) if isinstance(raw, str) else raw
    output = {
        "data": data,
        "raw": raw if isinstance(raw, str) else json.dumps(raw),
        "tokens": len(
            tokenizer.encode(raw if isinstance(raw, str) else json.dumps(raw))
        ),
        "time_s": round(elapsed, 2),
        "model": model_id,
    }
    _log_metric(output)
    return output


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
) -> dict:
    """Run a pipeline phase locally if available, with escalation signal.

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

    config = load_config()
    model_id = config.get("model", DEFAULTS["model"])

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


# ── Metrics ──────────────────────────────────────────────────────────────────


def _metrics_path() -> Path:
    from datum.path_utils import datum_dir

    return datum_dir() / "local-llm-metrics.jsonl"


def _log_metric(result: dict) -> None:
    import datetime

    entry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
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
    print(f"Loading {config['model']}...", file=sys.stderr)
    result = generate(
        prompt,
        model_id=config["model"],
        max_tokens=config.get("max_tokens", DEFAULTS["max_tokens"]),
        temperature=config.get("temperature", DEFAULTS["temperature"]),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
