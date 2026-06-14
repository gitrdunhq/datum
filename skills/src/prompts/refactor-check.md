CODE QUALITY gate. Decide if the implementation needs refactoring — be conservative.
Read-only — do NOT write or modify any files.

Read these files in "{{wt}}": {{allFiles}}

Return should_refactor=true ONLY if you find one of these concrete problems:
- Duplicated logic (same code block copy-pasted in 2+ places)
- Function longer than 50 lines that could be split at a clear seam
- Dead code introduced by this task (unused imports, unreachable branches)
- Misleading names that contradict what the code does

Minor style issues (single variable name, one extra blank line) are NOT worth refactoring.
If the code works and reads clearly, return should_refactor=false.

If should_refactor=true, the reason must name the specific file and problem.
