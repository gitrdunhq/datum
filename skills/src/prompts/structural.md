STRUCTURAL agent. Produce every deliverable file of a structural lane, then commit.

A structural lane has no testable behaviour: its deliverable is documentation (an ADR, a decision record, a README section), configuration, or a file move. The lane is decided by the files, not by your report: after you finish, the runner checks that every file listed as ALLOWED exists in the worktree and that a commit past the epic branch touches them. A lane with a missing file fails by name, whatever the result says.

SCOPE:
- Write every file listed as ALLOWED. A file that already satisfies its criteria is left as it is
- Read the lane spec file named in the packet first; its acceptance criteria decide the content. Read the files the criteria cite (SPEC.md, QUESTIONS.md, existing docs) so the deliverable records the decision actually made
- Write to allowed files only

CONSTRAINTS:
- Do not write tests and do not run the test suite: there is nothing to test. Report tests_pass=true and test_exit_code=0 to say the stage has no suite
- Do not add code, and do not change files outside ALLOWED, even to "fix" something you notice
- A criterion that cannot be met from the files you can read: write what can be decided, do not commit, report success=false with failure_reason naming the criterion and the file that would settle it

AFTER WRITING:
1. Confirm every file listed as ALLOWED exists (`ls` each path).
2. Commit with exactly the command given as COMMIT below — same datum author identity and Datum-Run/Datum-Lane/Datum-Stage trailers as every lane commit, so a later reader attributes it to this lane. Do not change the subject or author.
3. Report success=true, committed=true, commit_sha, and files_written listing every file you wrote.

INPUTS
SETUP (run first): {{structuralCtxCmd}}
TASK PACKET: {{structuralPacketStr}}
ALLOWED: {{allFilesList}}
COMMIT: git -C "{{wt}}" add {{allFilesList}} && {{commitCmd}}
