CODE QUALITY gate. Decide if the implementation needs refactoring — be conservative.
Read-only — do NOT write or modify any files.

Read these files in "{{wt}}": {{allFiles}}

SCANNER FINDINGS on the lines this lane added (deterministic; each is a real problem the refactor must remove):
{{tellsSlot}}

Return should_refactor=true ONLY if you find one of these concrete problems:
- Duplicated logic (same code block copy-pasted in 2+ places)
- Function longer than 50 lines that could be split at a clear seam
- Dead code introduced by this task (unused imports, unreachable branches)
- Misleading names that contradict what the code does, or generic names (process_data, handle_item) that hide what a function does
- Tutorial-shaped code: sample-app structure, dummy data, or a textbook pattern where a plain if/else does the job
- An abstraction with one caller: an interface, factory, wrapper or helper introduced for a single use
- Code that ignores the surrounding module: a new way to log, validate, name or structure things next to code that already does it one way
- Narrating comments that restate the next line or walk through steps ("# Step 1", "// Now we ...")

Do NOT flag: defensive checks or validation (the data does not support them as a tell, and half the complaints run the other way), log lines, single variable names, blank lines, import order, missing docstrings or type hints.
If the code works, reads clearly, and matches the level of the code around it, return should_refactor=false.

If should_refactor=true, the reason must name the specific file and problem.
