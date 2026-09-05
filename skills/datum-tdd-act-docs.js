// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-docs.ts
export const meta = {
  name: "datum-tdd-act-docs",
  description: "Haiku pre-check + conditional sonnet docs sync with git commit",
  phases: [{ title: "Docs" }]
};

// skills/src/shared/models.ts
var DEFAULT_TIERS = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
var activeTiers = { ...DEFAULT_TIERS };
function model(tier) {
  return activeTiers[tier];
}

// skills/src/shared/schemas.ts
var WRITE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    files_written: { type: "array", items: { type: "string" } },
    success: { type: "boolean" },
    failure_reason: { type: "string" }
  },
  required: ["success"]
};
var REFACTOR_CHECK_SCHEMA = {
  type: "object",
  properties: {
    should_refactor: { type: "boolean" },
    reason: { type: "string" }
  },
  required: ["should_refactor"]
};

// skills/src/shared/utils.ts
function findMatchingBracketEnd(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
  }
  const openRe = /[{[]/g;
  let match;
  let best;
  let found = false;
  while ((match = openRe.exec(cleaned)) !== null) {
    const start = match.index;
    const end = findMatchingBracketEnd(cleaned, start);
    if (end === -1) continue;
    try {
      best = JSON.parse(cleaned.slice(start, end + 1));
      found = true;
      openRe.lastIndex = end + 1;
    } catch {
      openRe.lastIndex = start + 1;
    }
  }
  return found ? best : fallback;
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/shared/batch.ts
var NAME_RE = /^[a-z][a-z0-9-]*$/;
function validateBatchSteps(steps) {
  if (steps.length === 0) throw new Error("batch: no steps");
  const seen = /* @__PURE__ */ new Set();
  for (const s of steps) {
    if (!NAME_RE.test(s.name)) throw new Error(`batch: invalid step name "${s.name}"`);
    if (seen.has(s.name)) throw new Error(`batch: duplicate step name "${s.name}"`);
    seen.add(s.name);
    if (!s.command || !s.command.trim()) throw new Error(`batch: step "${s.name}" has an empty command`);
  }
}
function batchScript(steps) {
  validateBatchSteps(steps);
  const lines = [
    "__bo=$(mktemp); __be=$(mktemp); __r='[]'",
    `__rec() { __r=$(printf '%s' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" '. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]'); }`,
    `__end() { printf '%s\\n' "$__r"; rm -f "$__bo" "$__be"; }`
  ];
  steps.forEach((s, i) => {
    lines.push(`# step ${i + 1}/${steps.length}: ${s.name}${s.tolerant ? " (tolerant)" : ""}`);
    lines.push("{");
    lines.push(s.command.replace(/\n+$/, ""));
    lines.push(`} >"$__bo" 2>"$__be"; __c=$?`);
    lines.push(`__rec '${s.name}' "$__c"`);
    if (!s.tolerant) lines.push('if [ "$__c" -ne 0 ]; then __end; exit 0; fi');
  });
  lines.push("__end");
  return lines.join("\n") + "\n";
}
var cacheKey = "";
function setBatchCacheKey(key) {
  cacheKey = typeof key === "string" ? key : "";
}
function batchCommandPrompt(steps) {
  return 'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.\n\n' + (cacheKey ? `(inputs fingerprint ${cacheKey} \u2014 informational, do not act on it)

` : "") + batchScript(steps);
}
function asStepResult(x) {
  if (!x || typeof x !== "object") return null;
  const o = x;
  if (typeof o.name !== "string") return null;
  const code = typeof o.exit_code === "number" ? o.exit_code : parseInt(String(o.exit_code ?? ""), 10);
  return {
    name: o.name,
    exit_code: Number.isFinite(code) ? code : 1,
    stdout: typeof o.stdout === "string" ? o.stdout : "",
    stderr: typeof o.stderr === "string" ? o.stderr : ""
  };
}
function parseBatchResult(raw, steps) {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? parseAgentJson(raw, null) : null;
  if (!Array.isArray(arr)) return { steps: [], failed: null, missing: true };
  const results = arr.map(asStepResult).filter((r) => r !== null);
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const failed = results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  return { steps: results, failed, missing: false };
}
function stepResult(r, name) {
  return r.steps.find((s) => s.name === name) ?? null;
}
function stepStdout(r, name) {
  const s = stepResult(r, name);
  return s ? s.stdout : null;
}
function describeFailure(r, label) {
  if (r.missing) return `${label}: batch agent returned no parseable result`;
  if (!r.failed) return `${label}: ok`;
  const tail = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` \u2014 ${tail}` : ""}`;
}

// skills/src/shared/commit-steps.ts
var q = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
var NOTHING_TO_COMMIT = "NOTHING_TO_COMMIT";
function commitFilesSteps(o) {
  if (/co-authored-by|claude-session|signed-off-by/i.test(o.message)) {
    throw new Error(`commit message must not carry a trailer (policy): ${JSON.stringify(o.message)}`);
  }
  if (/["`$\\]/.test(o.message)) {
    throw new Error(`commit message must not contain quotes, backticks, $ or backslashes: ${JSON.stringify(o.message)}`);
  }
  if (o.files.length === 0) throw new Error("commitFilesSteps: no files to commit");
  const wt = q(o.wt);
  const files = o.files.map(q).join(" ");
  return [
    { name: "status", command: `git -C ${wt} status --porcelain -- ${files}`, tolerant: true },
    { name: "add", command: `git -C ${wt} add -- ${files}` },
    {
      name: "commit",
      command: `if git -C ${wt} diff --cached --quiet -- ${files}; then echo ${NOTHING_TO_COMMIT}; else git -C ${wt} commit -q -m ${q(o.message)} -- ${files} && echo COMMITTED; fi`,
      tolerant: true
    },
    { name: "sha", command: `git -C ${wt} rev-parse --short HEAD`, tolerant: true }
  ];
}
function commitFilesFromSteps(result) {
  const none = { committed: false, nothingToCommit: false, sha: "", error: "" };
  if (result.missing) return { ...none, error: `commit_failed: batch returned no parseable result (${describeFailure(result, "commit")})` };
  const add = stepResult(result, "add");
  if (!add || add.exit_code !== 0) {
    return { ...none, error: `commit_failed: git add exited ${add ? add.exit_code : "without running"}: ${(add && (add.stderr || add.stdout) || "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  const commit = stepResult(result, "commit");
  if (!commit) return { ...none, error: "commit_failed: commit step did not run" };
  const out = (commit.stdout || "").trim();
  if (out.split("\n").includes(NOTHING_TO_COMMIT)) return { ...none, nothingToCommit: true };
  if (commit.exit_code !== 0) {
    return { ...none, error: `commit_failed: git commit exited ${commit.exit_code}: ${(commit.stderr || commit.stdout || "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  const sha = (stepStdout(result, "sha") || "").trim();
  if (!sha) return { ...none, error: "commit_failed: commit exited 0 but no sha was printed" };
  return { committed: true, nothingToCommit: false, sha, error: "" };
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/docs-check.md
var docs_check_default = "DOCS RELEVANCE checker. Evaluate whether documentation needs updating \u2014 do NOT write or modify files.\n\nSearch for references to these symbols in doc files (*.md, excluding CHANGELOG.md):\n{{changedFiles}}\n\nAlso check: did this task add new public functions or classes with zero documentation?\n\nReturn should_refactor=true only if:\n- An existing doc references a symbol that changed (stale doc)\n- A new public API has zero documentation anywhere\n\nReturn should_refactor=false if all docs are current or no docs reference the changed code.\n";

// skills/src/prompts/docs-sync.md
var docs_sync_default = 'Documentation sync agent. Update existing doc files to reflect code changes.\nWrite updated files \u2014 do NOT run any git commands.\n\nRULES (non-negotiable):\n- Do NOT create new doc files \u2014 only edit existing ones\n- Do NOT touch CHANGELOG.md\n- CLI references use "datum <cmd>", never "uv run" or "python3 scripts/"\n\nTASK PACKET: {{docsPacket}}\n\nACTIONS:\n1. Fix any existing docs that reference changed code incorrectly\n2. If new public APIs were added with zero docs, add a section in the nearest relevant existing doc file\n3. Keep additions concise \u2014 one paragraph per new API, with a usage example\n';

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function docsCheckPrompt(vars) {
  return PREAMBLE + renderPrompt(docs_check_default, vars);
}
function docsSyncPrompt(vars) {
  return PREAMBLE + renderPrompt(docs_sync_default, vars);
}

// skills/src/shared/agent-types.ts
var AGENT_TYPE_TABLE = {
  red: "datum-red",
  green: "datum-green",
  refactor: "datum-refactor",
  skeptic: "datum-skeptic",
  reflect: "datum-reflect",
  docs: "datum-docs",
  reader: "datum-reader",
  cli: "datum-cli"
};
var state = { agentTypes: true, hooksInstalled: false };
var configured = false;
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
  configured = true;
}
function stageOpts(stage, extra = {}) {
  if (!configured) {
    throw new Error(
      `agent_types_unconfigured: stageOpts('${stage}'${extra.label ? `, ${extra.label}` : ""}) called before configureAgentTypes() \u2014 configure from args/config first, or use bootstrapOpts() for the read that has to precede configuration`
    );
  }
  if (!state.agentTypes) return { ...extra };
  return { ...extra, agentType: AGENT_TYPE_TABLE[stage] };
}

// skills/src/datum-tdd-act-docs.ts
var a = args;
configureAgentTypes(a.agentTypes || {});
setBatchCacheKey(a.configFingerprint || "");
phase("Docs");
var synced = false;
var syncedFiles;
var committed;
var commitSha;
var failureReason;
if (a.completedLanes.length === 0) {
  log("No completed lanes \u2014 skipping docs");
} else {
  const changedFiles = [...new Set(a.completedLanes.flatMap((id) => a.lanePlan.lanes[id].files || []))];
  const docsCheck = await agent(
    docsCheckPrompt({ changedFiles: changedFiles.join(", ") }),
    { label: "docs-check", phase: "Docs", model: model("fast"), schema: REFACTOR_CHECK_SCHEMA }
  );
  if (docsCheck?.should_refactor) {
    const docsPacket = JSON.stringify({
      schema_version: "1.0",
      changed_files: changedFiles,
      new_symbols: a.completedLanes.map((id) => ({
        task_id: id,
        title: a.lanePlan.lanes[id].title,
        files: a.lanePlan.lanes[id].files
      })),
      working_directory: "."
    });
    const docs = await agent(
      docsSyncPrompt({ docsPacket }),
      stageOpts("docs", { label: "docs-sync", phase: "Docs", model: model("balanced"), schema: WRITE_RESULT_SCHEMA })
    );
    if (docs?.success) {
      const docsWritten = docs.files_written || [];
      if (docsWritten.length === 0) {
        log("Docs: agent reported success but no files_written \u2014 skipping commit");
        failureReason = "docs agent reported success but wrote no files";
      } else {
        const commitStepList = commitFilesSteps({ wt: ".", files: docsWritten, message: `docs(${a.runId}): sync docs for merged lanes` });
        const commit = commitFilesFromSteps(parseBatchResult(
          await agent(batchCommandPrompt(commitStepList), stageOpts("cli", { label: "docs-commit", phase: "Docs", model: model("fast") })),
          commitStepList
        ));
        committed = commit.committed || commit.nothingToCommit;
        commitSha = commit.sha || "";
        syncedFiles = docsWritten;
        if (committed) {
          log(commit.nothingToCommit ? `Docs already committed (nothing to commit): ${docsWritten.join(", ")}` : `Docs synced and committed (${commitSha}): ${docsWritten.join(", ")}`);
          synced = true;
        } else {
          failureReason = commit.error || "commit_failed: unknown";
          log(`Docs written but NOT committed \u2014 ${failureReason}. Files left modified in the checkout: ${docsWritten.join(", ")}`);
        }
      }
    } else {
      log(`Docs: ${docs?.failure_reason || "nothing to update"}`);
    }
  } else {
    log("Docs: no stale references found, skipping");
  }
}
return { synced, files: syncedFiles, committed, commit_sha: commitSha, failure_reason: failureReason };
