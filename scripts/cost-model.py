#!/usr/bin/env python3
"""datum pipeline cost model — per-agent-type breakdown."""

# Claude API pricing (per million tokens, June 2026)
PRICING = {
    "haiku": {"input": 1.00, "output": 5.00},
    "sonnet": {"input": 3.00, "output": 15.00},
    "opus": {"input": 15.00, "output": 75.00},
}

# Estimated tokens per agent call (input + output)
# Based on typical prompt sizes + tool use patterns
TOKEN_ESTIMATES = {
    # Fast (haiku) agents — short prompts, minimal output
    "read-config": {"input": 2000, "output": 500},
    "read-context": {"input": 3000, "output": 2000},
    "read-plan": {"input": 3000, "output": 5000},
    "detect-branch": {"input": 1500, "output": 300},
    "classify": {"input": 3000, "output": 800},
    "gate": {"input": 2000, "output": 1000},
    "build-lane-plan": {"input": 2000, "output": 500},
    "triage-decision": {"input": 2000, "output": 500},
    "preflight": {"input": 3000, "output": 2000},
    "test-count-check": {"input": 2000, "output": 200},
    "assert-check": {"input": 3000, "output": 500},
    "test-count": {"input": 2500, "output": 500},
    "reflect": {"input": 5000, "output": 1500},
    "refactor-check": {"input": 3000, "output": 500},
    "ownership-check": {"input": 2000, "output": 500},
    "revert-refactor": {"input": 2000, "output": 500},
    "setup-worktree": {"input": 2000, "output": 300},
    "merge": {"input": 2000, "output": 500},
    "cleanup": {"input": 1500, "output": 300},
    "docs-check": {"input": 3000, "output": 500},
    "commit-report": {"input": 2000, "output": 500},
    "file-issue": {"input": 2000, "output": 800},
    "check-artifacts": {"input": 2000, "output": 500},
    "check-git": {"input": 2000, "output": 500},
    "log-decision": {"input": 2000, "output": 300},
    "perf-review": {"input": 8000, "output": 3000},
    "arch-review": {"input": 8000, "output": 3000},
    "skeptic-edge": {"input": 5000, "output": 2000},
    "skeptic-error": {"input": 5000, "output": 2000},
    # Balanced (sonnet) agents — substantive work
    "scan-codebase": {"input": 8000, "output": 5000},
    "write-spec": {"input": 10000, "output": 8000},
    "propose-approaches": {"input": 8000, "output": 4000},
    "impact-analysis": {"input": 8000, "output": 5000},
    "decompose-tasks": {"input": 12000, "output": 8000},
    "derive-properties": {"input": 8000, "output": 5000},
    "red": {"input": 15000, "output": 10000},
    "red-retry": {"input": 18000, "output": 10000},
    "green": {"input": 15000, "output": 12000},
    "refactor": {"input": 12000, "output": 8000},
    "validate-check": {"input": 8000, "output": 5000},
    "sec-review": {"input": 10000, "output": 5000},
    "corr-review": {"input": 10000, "output": 5000},
    "docs-sync": {"input": 8000, "output": 5000},
    "synthesize": {"input": 8000, "output": 5000},
    "triage-analyze": {"input": 8000, "output": 4000},
    "route-classify": {"input": 5000, "output": 1500},
    "skeptic-contract": {"input": 8000, "output": 3000},
    "deepen-research": {"input": 10000, "output": 6000},
    "triage-addenda": {"input": 8000, "output": 4000},
    "distill-preamble": {"input": 6000, "output": 3000},
    "scan-repo": {"input": 6000, "output": 4000},
    # Deep (opus) agents — complex decomposition
    "decompose-complex": {"input": 15000, "output": 12000},
    "green-retry": {"input": 20000, "output": 15000},
}

# Full feature pipeline agent composition (datum-go, 5 lanes, no retries)
FULL_PIPELINE = {
    "route": [
        ("haiku", "check-artifacts"),
        ("haiku", "check-git"),
        ("sonnet", "route-classify"),
        ("haiku", "log-decision"),
    ],
    "refine": [
        ("haiku", "read-context"),
        ("haiku", "classify"),
        ("sonnet", "scan-codebase"),
        ("sonnet", "write-spec"),
        ("haiku", "gate"),
    ],
    "plan": [
        ("sonnet", "read-context"),
        ("haiku", "read-config"),
        ("sonnet", "propose-approaches"),
        ("sonnet", "impact-analysis"),
        ("sonnet", "decompose-tasks"),  # balanced for normal, deep for complex
        ("haiku", "build-lane-plan"),
        ("haiku", "triage-decision"),
        ("haiku", "gate"),
    ],
    "properties": [
        ("haiku", "read-context"),
        ("sonnet", "derive-properties"),
        ("haiku", "gate"),
    ],
    "act-overhead": [
        ("haiku", "read-config"),
        ("haiku", "detect-branch"),
        ("haiku", "read-plan"),
    ],
    "act-setup": [
        ("haiku", "setup-worktree"),  # root
        ("haiku", "setup-worktree"),  # per-lane (×5 collapsed)
        ("haiku", "setup-worktree"),
        ("haiku", "setup-worktree"),
    ],
    "act-per-lane (×5)": [
        ("haiku", "preflight"),
        ("sonnet", "red"),
        ("haiku", "test-count-check"),
        ("haiku", "assert-check"),
        ("haiku", "test-count"),
        ("haiku", "reflect"),
        ("sonnet", "green"),
        ("haiku", "ownership-check"),
        ("haiku", "ownership-check"),
        ("haiku", "refactor-check"),
        ("sonnet", "refactor"),
        ("haiku", "skeptic-edge"),
        ("haiku", "skeptic-error"),
        ("sonnet", "skeptic-contract"),
    ],
    "act-merge": [
        ("haiku", "merge"),
        ("haiku", "cleanup"),
    ],
    "act-docs": [
        ("haiku", "docs-check"),
        ("sonnet", "docs-sync"),
    ],
    "validate": [
        ("haiku", "read-config"),
        ("sonnet", "validate-check"),
        ("haiku", "gate"),
    ],
    "review": [
        ("sonnet", "sec-review"),
        ("haiku", "perf-review"),
        ("haiku", "arch-review"),
        ("sonnet", "corr-review"),
        ("haiku", "commit-report"),
    ],
    "closeout": [
        ("haiku", "read-context"),
        ("sonnet", "synthesize"),
    ],
}


def cost(model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICING[model]
    return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


def main():
    print("=" * 70)
    print("DATUM PIPELINE COST MODEL — Full Feature Run (5 lanes)")
    print("=" * 70)
    print()

    totals = {
        "haiku": {"input": 0, "output": 0, "cost": 0, "count": 0},
        "sonnet": {"input": 0, "output": 0, "cost": 0, "count": 0},
        "opus": {"input": 0, "output": 0, "cost": 0, "count": 0},
    }
    grand_total = 0
    total_agents = 0

    for phase, agents in FULL_PIPELINE.items():
        multiplier = 5 if "×5" in phase else 1
        phase_cost = 0
        phase_agents = 0

        for model, agent_name in agents:
            est = TOKEN_ESTIMATES.get(agent_name, {"input": 5000, "output": 2000})
            c = cost(model, est["input"], est["output"]) * multiplier
            totals[model]["input"] += est["input"] * multiplier
            totals[model]["output"] += est["output"] * multiplier
            totals[model]["cost"] += c
            totals[model]["count"] += multiplier
            phase_cost += c
            phase_agents += multiplier

        total_agents += phase_agents
        grand_total += phase_cost
        print(f"  {phase:<25s}  {phase_agents:>3d} agents  ${phase_cost:.4f}")

    print()
    print("-" * 70)
    print(f"{'TOTAL':<25s}  {total_agents:>3d} agents  ${grand_total:.4f}")
    print("-" * 70)
    print()

    print("PER-MODEL BREAKDOWN")
    print(
        f"{'Model':<10s} {'Agents':>7s} {'Input':>10s} {'Output':>10s} {'Cost':>10s} {'% of total':>10s}"
    )
    print("-" * 60)
    for model in ["haiku", "sonnet", "opus"]:
        t = totals[model]
        pct = (t["cost"] / grand_total * 100) if grand_total else 0
        print(
            f"{model:<10s} {t['count']:>7d} {t['input']:>10,d} {t['output']:>10,d} ${t['cost']:>9.4f} {pct:>9.1f}%"
        )

    print()
    print("COST PER AGENT (average)")
    print(f"{'Model':<10s} {'Avg cost':>10s} {'Avg tokens':>12s}")
    print("-" * 35)
    for model in ["haiku", "sonnet", "opus"]:
        t = totals[model]
        if t["count"] > 0:
            avg_cost = t["cost"] / t["count"]
            avg_tok = (t["input"] + t["output"]) / t["count"]
            print(f"{model:<10s} ${avg_cost:>9.5f} {avg_tok:>11,.0f}")

    print()
    print("WHAT-IF: SWAP ALL SONNET → HAIKU")
    swap_savings = 0
    for model in ["sonnet"]:
        t = totals[model]
        current = t["cost"]
        swapped = cost("haiku", t["input"], t["output"])
        swap_savings += current - swapped
    print(f"  Current sonnet cost:  ${totals['sonnet']['cost']:.4f}")
    print(
        f"  If haiku instead:     ${cost('haiku', totals['sonnet']['input'], totals['sonnet']['output']):.4f}"
    )
    print(
        f"  Savings:              ${swap_savings:.4f} ({swap_savings/grand_total*100:.0f}% of total)"
    )

    print()
    print("WHAT-IF: SWAP ALL HAIKU → SONNET")
    t = totals["haiku"]
    current_h = t["cost"]
    swapped_h = cost("sonnet", t["input"], t["output"])
    penalty = swapped_h - current_h
    print(f"  Current haiku cost:   ${current_h:.4f}")
    print(f"  If sonnet instead:    ${swapped_h:.4f}")
    print(
        f"  Extra cost:           ${penalty:.4f} ({penalty/grand_total*100:.0f}% increase)"
    )

    print()
    actual_run_tokens = 1_162_775
    actual_run_agents = 42
    print(
        f"ACTUAL RUN (bug-squash, {actual_run_agents} agents, {actual_run_tokens:,} tokens)"
    )
    # Estimate 60% fast, 35% balanced, 5% deep for our actual run
    est_haiku_tokens = int(actual_run_tokens * 0.25)  # haiku does less per call
    est_sonnet_tokens = int(actual_run_tokens * 0.70)
    est_opus_tokens = int(actual_run_tokens * 0.05)
    # Assume 30% input, 70% output
    actual_cost = (
        cost("haiku", int(est_haiku_tokens * 0.3), int(est_haiku_tokens * 0.7))
        + cost("sonnet", int(est_sonnet_tokens * 0.3), int(est_sonnet_tokens * 0.7))
        + cost("opus", int(est_opus_tokens * 0.3), int(est_opus_tokens * 0.7))
    )
    print(f"  Estimated cost:       ${actual_cost:.4f}")
    print(f"  Cost per agent:       ${actual_cost/actual_run_agents:.5f}")


if __name__ == "__main__":
    main()
