# Codebase-Wide Invariants

These invariants appear across multiple epics and are candidates for
promotion to permanent, non-negotiable rules. Promoted invariants should
reference the corresponding ADR.

## 1. The gate NEVER advances to Act when an assumption has Status "guess" without a resolved question
*Appears in 1 epic(s)*

## 2. Classifier safety — System-tier never misrouted to lightweight pipeline
*Appears in 1 epic(s)*

## 3. DAG integrity — all dependency graphs validated as acyclic before use
*Appears in 1 epic(s)*

## 4. The gate NEVER advances when QUESTIONS.md contains an unanswered [Answer]: entry
*Appears in 1 epic(s)*

## 5. Once `datum classify` is called with a valid SPEC.md, it ALWAYS returns a JSON result within 2 seconds
*Appears in 1 epic(s)*

## 6. Once `datum landscape` is called, it ALWAYS produces docs/LANDSCAPE.md (scaffold or cached)
*Appears in 1 epic(s)*

## 7. Once all [Answer]: entries are filled, the QUESTIONS.md gate check ALWAYS passes
*Appears in 1 epic(s)*

## 8. Backward compatibility — new features must not break existing input formats
*Appears in 1 epic(s)*

## 9. SPEC.md template ALWAYS contains all 7 original required sections plus Assumption Audit and Classification Metadata
*Appears in 1 epic(s)*

## 10. Gate output is always valid JSON — every gate function returns parseable JSON to stdout
*Appears in 1 epic(s)*

## 11. classify() output ALWAYS contains exactly three fields: tier, signals, pipeline_shape
*Appears in 1 epic(s)*

## 12. classify() with estimated_loc=49, clusters_touched=1, new_public_api=false MUST return tier "patch"
*Appears in 1 epic(s)*

## 13. classify() with estimated_loc=50, clusters_touched=1, new_public_api=false MUST return tier "feature" (not patch)
*Appears in 1 epic(s)*

## 14. classify() with clusters_touched=5 MUST return tier "feature"; clusters_touched=6 MUST return tier "system"
*Appears in 1 epic(s)*

## 15. parse_classification_metadata with missing fields MUST return None for missing values, not raise
*Appears in 1 epic(s)*

## 16. generate_scaffold with an empty directory MUST produce valid markdown (not crash)
*Appears in 1 epic(s)*

## 17. Cache idempotency — repeated operations with unchanged input produce identical output
*Appears in 1 epic(s)*

## 18. Running `datum landscape --force` twice produces the same output (deterministic scan)
*Appears in 1 epic(s)*

## 19. Running gate_plan() twice on the same SPEC.md + QUESTIONS.md produces the same pass/fail result
*Appears in 1 epic(s)*

## 20. Classification Metadata MUST be filled in SPEC.md before `datum classify` can run
*Appears in 1 epic(s)*

## 21. Assumption Audit MUST be completed before the plan_human_approval gate can pass
*Appears in 1 epic(s)*

## 22. Unit dependency ordering: a unit's tasks MUST NOT start before all dependency units complete
*Appears in 1 epic(s)*

## 23. QUESTIONS.md Refine section MUST be generated before Plan section is appended
*Appears in 1 epic(s)*

## 24. Patch-tier classification MUST NOT trigger Properties phase or architect sidecar
*Appears in 1 epic(s)*

## 25. Unit groupings MUST NOT affect task-level topological sort within a unit
*Appears in 1 epic(s)*

## 26. GitNexus enrichment sections in LANDSCAPE.md (between markers) MUST NOT overwrite CLI scaffold content
*Appears in 1 epic(s)*

## 27. datum classify` MUST complete within 2 seconds (no network calls)
*Appears in 1 epic(s)*

## 28. datum landscape` MUST complete within 30 seconds on a 10K-file repo
*Appears in 1 epic(s)*

## 29. *Exclusion note:* This epic modifies pipeline tooling, not user-facing systems. No authentication, authorization, or data protection boundaries are affected. Gate enforcement is a correctness concern (SAFETY), not a security concern
*Appears in 1 epic(s)*

## 30. classify() result MUST include a signals object showing which thresholds triggered the tier decision
*Appears in 1 epic(s)*

## 31. landscape cache behavior (hit/miss/force) MUST be reported in the JSON output
*Appears in 1 epic(s)*

## 32. No Act with unresolved guess assumptions
*Appears in 1 epic(s)*

## 33. No advancement with unanswered questions
*Appears in 1 epic(s)*

## 34. classify always returns within 2s
*Appears in 1 epic(s)*

## 35. landscape always produces output
*Appears in 1 epic(s)*

## 36. Filled answers always pass gate
*Appears in 1 epic(s)*

## 37. SPEC template has all required sections
*Appears in 1 epic(s)*

## 38. classify output has exactly 3 fields
*Appears in 1 epic(s)*

## 39. 49 LOC + 1 cluster → patch
*Appears in 1 epic(s)*

## 40. 50 LOC + 1 cluster → feature (not patch)
*Appears in 1 epic(s)*

## 41. 5 clusters → feature; 6 → system
*Appears in 1 epic(s)*

## 42. Missing metadata fields → None not exception
*Appears in 1 epic(s)*

## 43. Empty dir → valid markdown
*Appears in 1 epic(s)*

## 44. Landscape force double-run = same output
*Appears in 1 epic(s)*

## 45. Gate double-run = same verdict
*Appears in 1 epic(s)*

## 46. Metadata before classify
*Appears in 1 epic(s)*

## 47. Audit before plan gate
*Appears in 1 epic(s)*

## 48. Unit deps respected in scheduling
*Appears in 1 epic(s)*

## 49. Refine questions before Plan questions
*Appears in 1 epic(s)*

## 50. Patch tier skips Properties/architect
*Appears in 1 epic(s)*

## 51. Units don't affect intra-unit task sort
*Appears in 1 epic(s)*

## 52. GitNexus markers don't overwrite scaffold
*Appears in 1 epic(s)*

## 53. classify < 2s
*Appears in 1 epic(s)*

## 54. landscape < 30s on 10K files
*Appears in 1 epic(s)*

## 55. Exclusion: no user-facing security boundaries affected
*Appears in 1 epic(s)*

## 56. Zero-questions warning in gate output
*Appears in 1 epic(s)*

## 57. classify signals in output
*Appears in 1 epic(s)*

## 58. landscape cache status in output
*Appears in 1 epic(s)*

## 59. [What must NEVER happen]
*Appears in 1 epic(s)*

## 60. [What must EVENTUALLY happen]
*Appears in 1 epic(s)*

## 61. [What must ALWAYS be true]
*Appears in 1 epic(s)*

## 62. [Valid input ranges]
*Appears in 1 epic(s)*

## 63. [What is safe to run twice]
*Appears in 1 epic(s)*

## 64. [Order invariants]
*Appears in 1 epic(s)*

## 65. [What cannot leak between contexts]
*Appears in 1 epic(s)*

## 66. [Latency/throughput/size bounds]
*Appears in 1 epic(s)*

## 67. [Access control invariants]
*Appears in 1 epic(s)*

## 68. [What must be logged or measured]
*Appears in 1 epic(s)*
