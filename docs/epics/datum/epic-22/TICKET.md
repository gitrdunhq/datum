# gate.py hardening: two correctness/quality fixes

**Issues:** #24, #22

## #24 — check_questions_answered false-flags multi-line answers

`check_questions_answered` only reads the text on the same line as `[Answer]:`.
If a user writes the answer on the next line (multi-line answer), the inline
text is empty and the function reports "unanswered" even though an answer exists.

Fix: peek ahead to the next non-empty line if inline text is empty.

## #22 — _contracts() tuple indexing is opaque

`_contracts()[0]` and `_contracts()[1]` appear at every call site with no
indication of what each index means. Named unpacking at call sites makes it clear.
