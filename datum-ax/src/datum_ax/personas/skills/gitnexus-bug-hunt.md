---
name: gitnexus-bug-hunt
description: Systematic architecture bug hunt using GitNexus execution flow analysis.
  Finds crash risks, thread starvation, silent failures, security vulnerabilities,
  and blast-radius hotspots by tracing how data actually flows through the codebase
  — not just grepping text. Use whenever the user asks to find bugs, audit the codebase,
  discover what could crash or freeze the app, hunt security vulnerabilities, identify
  concurrency issues or silent failures, or says things like 'what could go wrong',
  'find hidden bugs', 'security audit', 'what's risky in production', 'architecture
  review', or 'use GitNexus to find problems'. Also use proactively after large code
  changes or before a major release to catch issues that grep and static analysis
  miss. Works on any language and any repo indexed in GitNexus.
version: 1
scope_tags:
- code-intelligence
- security
- audit
- bug
tool_refs:
- gitnexus
source: datum gold mine (imported, ADR-0033)
---
# GitNexus Bug Hunt

`grep` finds syntax. GitNexus finds *systems*.

This playbook traces how data actually moves through your codebase to surface bugs that manual review misses: error paths that corrupt state, blocking calls that starve threads, initialization chains that block the UI, and untrusted input reaching dangerous sinks.

## Which hunt for which symptom?

| User says… | Start with |
|------------|-----------|
| "app crashes when X fails" | Hunt 1 — cross-layer error propagation |
| "app freezes under load" | Hunt 2 — blocking on cooperative threads |
| "slow launch / watchdog kills" | Hunt 3 — init blast radius |
| "could there be injection / traversal issues" | Hunt 4 — input sinks |
| "what breaks if I change X" | Run `impact` on X, then Hunt 1 for its cross-layer flows |
| "review before merge" | `detect_changes` first, then Hunts 1–2 on affected flows |
| "general audit" | Run all 4 hunts |

## Risk thresholds (from GitNexus impact scale)

| `impact` result | Depth | Risk |
|----------------|-------|------|
| <5 symbols | any | **LOW** |
| 5–15 symbols, 2–5 processes | d=1–2 | **MEDIUM** |
| >15 symbols or many processes | d=1 | **HIGH** |
| auth / payments / data integrity path | any | **CRITICAL** |
| d=1 callers not in the current diff | — | flag as potential breaking change |

## Before you start

**Identify the repo.** Use `mcp__gitnexus__list_repos` if unsure. Then read the codebase overview:

```
Resource: gitnexus://repo/{repo-name}/context
```

Note the architectural layers (Presentation → Business → Infrastructure, or Controller → Service → Repository, etc.). The hunts look for bugs at these layer boundaries.

> If the context warns the index is stale, ask the user to run `npx gitnexus analyze --force` first.

**Optional: scope to recent changes.** If the user is worried about a specific change or regression:
```
mcp__gitnexus__detect_changes()
```
This tells you which execution flows are affected by current uncommitted changes. Use the result to prioritize which flows to trace in Hunts 1 and 2.

**Understand execution flows.** List the main processes in the codebase:
```
Resource: gitnexus://repo/{repo-name}/processes
```
These are the named execution flows GitNexus has indexed. Reference this list when deciding which flows to query in Hunt 1.

---

## Hunt 1: Cross-layer error propagation

**What you're looking for:** An error thrown deep in one layer that propagates up to a higher layer where a catch block handles it by silently resetting state — losing context, stranding resources, or leaving objects in an inconsistent state.

**Why it's hard to spot with grep:** The throw site and the silent catch are in different files, often 3+ call frames apart. You need the execution graph to connect them.

**Steps:**

1. Query 2–3 major user-facing operations (save, stop, checkout, authenticate, submit):
   ```
   mcp__gitnexus__query({ query: "stop recording session", repo: "{repo-name}" })
   ```

2. For any result flagged as `cross_community` or `cross_layer`, trace the full execution flow:
   ```
   Resource: gitnexus://repo/{repo-name}/process/{process-name}
   ```

3. Use `context` on the symbol at the layer boundary (the method that transitions between layers):
   ```
   mcp__gitnexus__context({ name: "SymbolName", repo: "{repo-name}" })
   ```

4. Read the error-handling site in the higher layer. Look for:
   - A catch block that sets a field to `nil` / `null` / `None` before hardware or resource cleanup runs
   - State reset to "idle" or "ready" while a connection, file, or device handle is still open
   - A `try?` / `try … catch {}` that swallows the error with no log
   - A resource created before the failing operation that is never cleaned up on failure

**Depth guidance (from official GitNexus impact scale):**
- d=1 caller: **WILL be affected** by any change here
- d=2 caller: **LIKELY affected**
- d=3 caller: **May need testing**

**Example finding:**
```
FINDING [CRITICAL] State reset before hardware cleanup on stop failure
Layer boundary: Infrastructure (WhisperKit) → Presentation (RecordingViewModel)
Location: RecordingViewModel.stopRecording() catch block
Evidence: Execution flow trace shows state = .idle and session = nil are set
          before forceStop() runs, leaving CoreAudio tap live while UI shows idle
Fix: Invert order — forceStop() first, state reset after
```

---

## Hunt 2: Blocking calls on cooperative threads

**What you're looking for:** A synchronous, potentially-slow operation executed directly on a cooperative thread pool (async/await, goroutine, coroutine, Node.js event loop) without being offloaded. Under load this starves the pool and freezes the app.

**The key insight:** The async function *signature* looks fine — the blocking nature is in what it *calls*, not how it's declared.

**Steps:**

1. Query for heavy infrastructure components across multiple categories — cast a wide net:
   ```
   mcp__gitnexus__query({ query: "database query execute", repo: "{repo-name}" })
   mcp__gitnexus__query({ query: "ML inference model load predict", repo: "{repo-name}" })
   mcp__gitnexus__query({ query: "file read write disk IO", repo: "{repo-name}" })
   mcp__gitnexus__query({ query: "hardware HAL audio device native", repo: "{repo-name}" })
   mcp__gitnexus__query({ query: "network HTTP socket request", repo: "{repo-name}" })
   ```
   Run all five — different codebases hide blocking calls in different categories.

2. For each heavy symbol found, trace its callers:
   ```
   mcp__gitnexus__impact({ target: "HeavySymbol", direction: "upstream", repo: "{repo-name}" })
   ```
   Then trace the full process to see the threading context:
   ```
   Resource: gitnexus://repo/{repo-name}/process/{process-name}
   ```

3. Look for the pattern: **async function → synchronous C-API / blocking call → no offloading**. Specific red flags:
   - DB query / C-API call directly from an actor method or async function with no `DispatchQueue` hop
   - ML model loaded as a stored property (`let model = SomeModel()`) — synchronous at property init time
   - HAL or hardware calls (`AudioObjectGetPropertyData`, `AudioHardwareCreate*`, device enumeration) on the cooperative thread
   - `DispatchQueue.sync { }` inside an async function — this parks the cooperative thread
   - A missing `withCheckedContinuation` wrapper around a callback-based async operation
   - No `Task.yield()` / `await asyncio.sleep(0)` in a long-running async loop

**Example finding:**
```
FINDING [CRITICAL] DuckDB C-API blocks cooperative thread pool on every query
Location: StorageActor — 14+ methods call PreparedStatement.execute() directly
Evidence: impact shows callers include recording start, search, list — all concurrent
          process trace confirms no DispatchQueue offloading anywhere in the chain
Fix: Use a custom serial executor on a non-cooperative thread for all DuckDB calls
```

---

## Hunt 3: Initialization blast radius

**What you're looking for:** Expensive work (disk I/O, schema migrations, network calls, ML model load) running synchronously in a constructor that is called at app launch from the main/UI thread. Causes a beachball or OS watchdog kill.

**Steps:**

1. Find the composition root — the entry point that wires everything together:
   ```
   mcp__gitnexus__query({ query: "assemble dependency inject startup bootstrap", repo: "{repo-name}" })
   ```

2. Run downstream impact on the composition root to find high fan-out components:
   ```
   mcp__gitnexus__impact({ target: "AppAssembler", direction: "downstream", repo: "{repo-name}" })
   ```
   Components with many downstream deps and synchronous inits are the highest-risk targets.

3. Use `context` and the process resource to trace the init chain:
   ```
   mcp__gitnexus__context({ name: "HighFanOutComponent", repo: "{repo-name}" })
   Resource: gitnexus://repo/{repo-name}/process/ApplicationDidFinishLaunching
   ```

4. Optionally, use Cypher to find constructors that touch storage directly:
   ```
   mcp__gitnexus__cypher({
     query: "MATCH (a)-[:CALLS]->(b) WHERE b.name CONTAINS 'init' AND (b.filePath CONTAINS 'Storage' OR b.filePath CONTAINS 'Database' OR b.filePath CONTAINS 'Migration') RETURN a.name, b.name, b.filePath LIMIT 20",
     repo: "{repo-name}"
   })
   ```

**Red flags:** constructor that calls DDL migrations, opens a DB connection, reads a file, or loads an ML model — all without deferring to a background task.

---

## Hunt 4: Untrusted input to dangerous sinks

**What you're looking for:** User-controlled input that flows to a dangerous operation without sanitization. This includes not just SQL injection and path traversal, but also file *deletion* paths, symlink traversal, and subprocess execution.

**The full list of dangerous sinks to check** (adapt names to your language/framework):

| Sink type | Examples |
|-----------|---------|
| Path write/read | `appendingPathComponent`, `os.path.join`, file URL construction |
| File deletion | `removeItem`, `deleteFile`, `unlink`, `os.remove` |
| SQL query | `execute`, `query`, `rawQuery`, string-interpolated SQL |
| Subprocess | `launchPath`, `exec`, `spawn`, `Process`, `subprocess.run` |
| Symlink traversal | `FileManager.enumerator` following symlinks outside a root |

**Steps:**

1. Query for each sink category:
   ```
   mcp__gitnexus__query({ query: "file path construct append URL", repo: "{repo-name}" })
   mcp__gitnexus__query({ query: "delete remove file unlink", repo: "{repo-name}" })
   mcp__gitnexus__query({ query: "subprocess exec process launch", repo: "{repo-name}" })
   ```

2. Use Cypher to trace from entry points to sinks:
   ```
   mcp__gitnexus__cypher({
     query: "MATCH path = (entry)-[:CALLS*1..5]->(sink) WHERE (entry.name CONTAINS 'request' OR entry.name CONTAINS 'input' OR entry.name CONTAINS 'param' OR entry.name CONTAINS 'query') AND (sink.name CONTAINS 'execute' OR sink.name CONTAINS 'remove' OR sink.name CONTAINS 'append' OR sink.name CONTAINS 'launch') RETURN entry.name, sink.name, sink.filePath LIMIT 15",
     repo: "{repo-name}"
   })
   ```

3. For each path found, check: is there a sanitization or validation step between entry and sink?

4. Also check file enumeration for symlink following:
   ```
   mcp__gitnexus__query({ query: "enumerate files directory walk symlink", repo: "{repo-name}" })
   ```
   Look for enumeration code that doesn't verify enumerated paths stay within a root directory.

---

## Output format

After all hunts, produce two sections:

### Findings

```
## GitNexus Bug Hunt Report — {repo-name}

### Summary
| Severity | Count |
|----------|-------|
| Critical | N     |
| High     | N     |
| Medium   | N     |

### FINDING N [SEVERITY] — {one-line title}
**Hunt:** Cross-layer error propagation / Thread starvation / Init blast radius / Input sink
**Location:** {file}:{symbol or line}
**Evidence from graph:** {what the GitNexus query showed}
**Impact:** {what breaks when this fires}
**Fix:** {concrete recommendation}
```

### What was confirmed clean

Always include this section — it's as useful as the findings. List patterns you checked that are correctly implemented. Helps the team understand what coverage was done and avoids false alarms on future reviews.

```
### What was confirmed clean
- {Component}: {pattern confirmed correct, e.g. "uses withCheckedContinuation — not blocking"}
- {Component}: {e.g. "uses parameterized prepared statements throughout — no SQL injection risk"}
```

### What was checked

```
### What was checked
- Hunt 1 (error propagation): queried {N} flows, examined {N} cross-layer boundaries
- Hunt 2 (thread starvation): queried all 5 infra categories, traced {N} symbols
- Hunt 3 (init blast radius): analyzed composition root, {N} downstream deps
- Hunt 4 (input sinks): traced {N} entry→sink paths across {N} sink categories
```

---

## Visualizing the architecture

If it helps to see the blast radius or layer structure visually, use:
```
mcp__gitnexus__generate_map({ repo: "{repo-name}" })
```
This generates a Mermaid architecture diagram from the knowledge graph — useful for presenting findings to the team or verifying which layers a flow touches before writing up a finding.

---

## Tips

- **Cast a wide net in Hunt 2.** The five query categories (database, ML, file, hardware, network) are all needed — blocking calls hide in different places in different codebases. Don't stop after the first hit.
- **Hunt 4 is wider than SQL injection.** File deletion with an unvalidated URL, symlink traversal, and subprocess path injection are equally dangerous and easier to miss.
- **The process resource gives you the full picture.** After `query` identifies a flow, `gitnexus://repo/{name}/process/{name}` gives you the complete step-by-step execution trace — use it before concluding a path is safe.
- **Cross-community processes are the most interesting.** Bugs that live entirely within one layer are caught by local testing. The hard ones live at seams between layers.
- **The graph shows structure, not runtime probability.** It tells you *that* a blocking call can happen; severity is about what fires under load, not always.
