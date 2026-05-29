# schema: TriageDecision Pydantic model missing

**Issue:** #46

Triage runs `run_phase("triage", prompt, schema=None)` — no schema, so
grammar-constrained structured output is bypassed. The result is free-form
text that must be parsed manually, defeating the purpose of the outlines
structured generation pipeline.

Add `datum/models/triage_decision_schema.py` with a `TriageDecision` Pydantic
v2 BaseModel, then update the triage subagent pattern to pass `schema=TriageDecision`
to `run_phase()`.
