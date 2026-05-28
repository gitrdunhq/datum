"""Local LLM inference via MLX for cost-free pipeline tasks.

Beta feature — opt-in via config.toml:
  [local_llm]
  enabled = true
  model = "mlx-community/gemma-4-26b-a4b-it-4bit"
  max_tokens = 4096

Falls back silently to Claude tiers when MLX or the model aren't available.
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
    "max_tokens": 8192,
    "temperature": 0.3,
    "phases": ["triage", "act_skeleton", "validate", "sidecar_docs"],
}


def is_available() -> bool:
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


def generate(
    prompt: str,
    model_id: str = DEFAULTS["model"],
    max_tokens: int = DEFAULTS["max_tokens"],
    temperature: float = DEFAULTS["temperature"],
) -> dict:
    """Generate text using the local MLX model.

    Returns {"text": str, "tokens": int, "time_s": float, "model": str}.
    """
    from mlx_lm import generate as mlx_generate

    model, tokenizer = load_model(model_id)

    start = time.monotonic()
    result = mlx_generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
    )
    elapsed = time.monotonic() - start

    output = {
        "text": result,
        "tokens": len(tokenizer.encode(result)),
        "time_s": round(elapsed, 2),
        "model": model_id,
    }
    _log_metric(output)
    return output


def chat(
    messages: list[dict],
    model_id: str = DEFAULTS["model"],
    max_tokens: int = DEFAULTS["max_tokens"],
    temperature: float = DEFAULTS["temperature"],
) -> dict:
    """Chat-style inference using the local MLX model.

    messages: [{"role": "user"|"assistant"|"system", "content": str}, ...]
    Returns {"text": str, "tokens": int, "time_s": float, "model": str}.
    """

    model, tokenizer = load_model(model_id)

    if hasattr(tokenizer, "apply_chat_template"):
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    else:
        prompt = "\n".join(f"{m['role']}: {m['content']}" for m in messages)

    return generate(prompt, model_id, max_tokens, temperature)


METRICS_PATH = Path(".datum/local-llm-metrics.jsonl")


def _log_metric(result: dict) -> None:
    """Append inference metrics to the JSONL log."""
    import datetime

    entry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "model": result["model"],
        "tokens": result["tokens"],
        "time_s": result["time_s"],
        "tokens_per_sec": (
            round(result["tokens"] / result["time_s"], 1) if result["time_s"] > 0 else 0
        ),
    }
    try:
        METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with METRICS_PATH.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def get_metrics_summary() -> dict:
    """Aggregate metrics from the JSONL log."""
    if not METRICS_PATH.exists():
        return {"total_calls": 0, "total_tokens": 0, "total_time_s": 0}

    calls = []
    for line in METRICS_PATH.read_text().splitlines():
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

    sonnet_cost_per_mtok = 3.0
    estimated_savings = round(total_tokens * sonnet_cost_per_mtok / 1_000_000, 4)

    return {
        "total_calls": len(calls),
        "total_tokens": total_tokens,
        "total_time_s": round(total_time, 1),
        "avg_tokens_per_sec": avg_tps,
        "estimated_savings_usd": estimated_savings,
        "first_call": calls[0].get("timestamp", ""),
        "last_call": calls[-1].get("timestamp", ""),
    }


def load_config() -> dict:
    """Load local_llm config from .datum/config.toml or default."""
    for config_path in [Path(".datum/config.toml"), Path("assets/config.toml.default")]:
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
    """Check if a phase should use local LLM instead of Claude."""
    if not is_available():
        return False
    config = load_config()
    if not config.get("enabled", False):
        return False
    return phase in config.get("phases", [])


def main() -> None:
    """CLI test: datum local-llm "prompt here" """
    if len(sys.argv) < 2:
        config = load_config()
        print(
            json.dumps(
                {
                    "available": is_available(),
                    "config": config,
                },
                indent=2,
            )
        )
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
        max_tokens=config.get("max_tokens", 4096),
        temperature=config.get("temperature", 0.3),
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
