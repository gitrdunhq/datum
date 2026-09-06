"""Property tests over the pure gate checks (Hypothesis).

Every gate check is a partial function over a small input space with a few
named outcomes, and the week's gate defects were all example-blind spots:
'Q8 (partially)' rejected by an exact-match rule (elonchesd
wf_251cf8a3-363), a reworded finding losing its recorded decision. These
properties pin the invariants rather than examples.
"""

from __future__ import annotations

import re

from hypothesis import given, settings, strategies as st

from datum.gate import check_assumption_audit

q_ids = st.integers(min_value=1, max_value=30).map(lambda n: f"Q{n}")
prose = st.text(
    alphabet=st.characters(blacklist_characters="|\nQ", blacklist_categories=("Cs",)),
    max_size=20,
)
status = st.sampled_from(["guess", "confirmed", "decided"])


def _questions(answered: set[str], unanswered: set[str]) -> str:
    out = ["## Refine\n"]
    for q in sorted(answered | unanswered, key=lambda s: int(s[1:])):
        out.append(f"### {q}: [Scope] {q}?\n")
        out.append("[Answer]: yes.\n" if q in answered else "[Answer]:\n")
    return "\n".join(out)


def _spec(rows: list[tuple[str, str]]) -> str:
    head = (
        "## Assumption Audit\n\n"
        "| # | Assumption | Justification | Status | Resolves |\n"
        "|---|---|---|---|---|\n"
    )
    body = "".join(
        f"| {i + 1} | Risky | Maybe | {s} | {r} |\n" for i, (s, r) in enumerate(rows)
    )
    return head + body


@settings(max_examples=300, deadline=None)
@given(
    rows=st.lists(
        st.tuples(
            status,
            st.one_of(
                # a Q<N> wrapped in any prose: "Q8 (partially)", "see Q2", "Q3"
                st.tuples(prose, q_ids, prose).map(
                    lambda t: f"{t[0]}{t[1]}{t[2]}".strip()
                ),
                # no question at all: "n/a", "n/a — decided by convention", prose
                st.one_of(st.just("n/a"), prose.map(lambda p: f"n/a — {p}"), prose),
            ),
        ),
        min_size=1,
        max_size=6,
    ),
    answered=st.sets(q_ids, max_size=10),
)
def test_a_guess_fails_exactly_when_it_names_no_answered_question(rows, answered):
    """For every row: confirmed/decided never error; a guess errors iff its
    Resolves cell names no Q<N>, or names one that is unanswered. The error
    names the row and the file to fix (SPEC.md), never tasks.json."""
    referenced = {q for _, r in rows for q in re.findall(r"\bQ\d+\b", r)}
    unanswered = referenced - answered
    questions = _questions(answered, unanswered)
    errors, _ = check_assumption_audit(_spec(rows), questions)

    expected = []
    for i, (s, r) in enumerate(rows):
        if s != "guess":
            continue
        refs = re.findall(r"\bQ\d+\b", r)
        if not refs:
            expected.append((i + 1, "no-question"))
        elif any(q not in answered for q in refs):
            expected.append((i + 1, "unanswered"))

    assert len(errors) == len(expected), (errors, expected)
    for err, (row_no, kind) in zip(errors, expected):
        assert f"Assumption {row_no}:" in err
        assert "tasks.json" not in err
        if kind == "no-question":
            assert "SPEC.md" in err
        else:
            assert "unanswered" in err


@settings(max_examples=100, deadline=None)
@given(rows=st.lists(st.tuples(status, prose), min_size=1, max_size=6))
def test_disabling_the_check_never_errors(rows):
    errors, warnings = check_assumption_audit(
        _spec(rows), None, overconfidence_enabled=False
    )
    assert errors == [] and warnings == []
