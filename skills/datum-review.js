// @generated — DO NOT EDIT. Source: skills/src/datum-review.ts
export const meta = {
  name: "datum-review",
  description: "Parallel review swarm \u2014 4 domain agents fan out, synthesize findings",
  phases: [
    { title: "Review", detail: "4 parallel domain reviewers" },
    { title: "Synthesize", detail: "dedup findings, render + commit REVIEW-REPORT.md" }
  ]
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
function scanForAgentJson(text) {
  if (!text || typeof text !== "string") return { found: false };
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
  try {
    return { found: true, value: JSON.parse(cleaned) };
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
  return found ? { found: true, value: best } : { found: false };
}
function parseAgentJson(text, fallback) {
  const r = scanForAgentJson(text);
  return r.found ? r.value : fallback;
}
function parseAgentJsonStrict(text, label) {
  const r = scanForAgentJson(text);
  if (!r.found) {
    throw new Error(`agent_output_unparseable: ${label} \u2014 ${String(text ?? "").slice(0, 200)}`);
  }
  return r.value;
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/review-domain.md
var review_domain_default = 'Domain reviewer. Find issues in your domain ONLY \u2014 your domain, its focus and the diff base are named as YOUR ASSIGNMENT at the end.\n\nRead the diff using difftastic for structural analysis, with the command given as DIFF below. Review only the commits after its merge-base.\n\nDECIDED FINDINGS: if docs/epics/$(git rev-parse --abbrev-ref HEAD)/REVIEW-RESPONSE.md exists, read it first. Every ACCEPT or DEFER line there is an operator decision about a place (file:line) and a reason. Do not re-raise a finding at a decided place under a new wording or a new lens; if the code at that place changed since, say what changed and why the decision no longer holds.\n\nGRADE AGAINST THIS SPEC ONLY: the standard is docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md, its acceptance criteria, PROPERTIES.md and the answered QUESTIONS.md. An architecture the SPEC decided (for example a render layer calling pure engine queries) is not a finding. Do not grade against conventions outside SPEC.md \u2014 house style rules, layering doctrines or personal preferences the spec does not adopt.\n\nSEVERITY RUBRIC (high and critical block the merge, so calibrate to the project\'s stated scale). A high or critical finding MUST cite the SPEC.md requirement, acceptance criterion or requirement id it violates, or the measurable NFR it breaks (with the number); a finding that cannot cite one is at most medium.\n- critical: wrong results, data loss, or a security hole on the documented happy path\n- high: a defect or cost that is MEASURABLE at the scale the spec states (its NFR budget, or absent one, the data sizes visible in SPEC.md/PROPERTIES.md). A per-frame scan over forty items is not high; the same scan over a million rows is.\n- medium: real, but only under inputs the spec does not promise, or with a cheap workaround\n- low / info: style, clarity, hygiene\n\nFor each finding provide:\n- id: the domain prefix below plus -NNN\n- severity: critical / high / medium / low / info\n- file: the path\n- line: the line number (integer)\n- description: what is wrong\n- suggestion: how to fix\n\nRULES:\n- Only report findings in your domain \u2014 do not cross into other reviewers\' territory\n- Every finding must have evidence (file + line). No speculation.\n- READ BUDGET: you have at most 30 tool calls. Start with the diff\'s file list (`--stat`), read the files that matter to your domain first, and when you reach 25 calls stop reading and answer with what you have. A review returned with partial coverage (say which files you did not reach in the findings\' descriptions) is worth more than a complete one never returned; a run that ends without your structured answer counts as no review at all.\n- If the diff is too large to read whole, use ast-grep to search the changed files for the patterns your domain focus names\n\nReturn JSON:\n{\n  "domain": "{{domain}}",\n  "findings": [\n    {"id": "{{domainPrefix}}-001", "severity": "high", "file": "...", "line": 0, "description": "...", "suggestion": "..."}\n  ]\n}\n\nOutput raw JSON only. No markdown fences.\n\nYOUR ASSIGNMENT\nYou are the {{domain}} reviewer.\nDOMAIN FOCUS \u2014 {{domainFocus}}\nDIFF BASE: `{{baseBranch}}` \u2014 the epic\'s recorded parent branch (an epic chained from another epic diffs from that epic, not from the repo default).\nDIFF: `difft --display side-by-side-show-both $(git merge-base HEAD {{baseBranch}}) HEAD 2>/dev/null || git diff {{baseBranch}}...HEAD`\n';

// skills/src/prompts/review-correctness-spec-verify.md
var review_correctness_spec_verify_default = 'You are the Correctness reviewer. Your job: does the implementation actually\nmatch SPEC.md and its acceptance criteria? Adjudicate \u2014 do not just hunt for\nbugs.\n\nThis follows the spec-verify skill\'s method. The failure mode it guards\nagainst is a confident overall impression: reading a diff and a spec together\nand forming a general sense that "looks good" almost always rounds every\nindividual requirement up to a pass, because the impression is dominated by\nwhatever was most prominent in the diff. Per-requirement isolation and named\nevidence exist to stop that impression from becoming the answer.\n\nREAD BUDGET: you have at most 30 tool calls. Resolve the diff\'s file list first, read SPEC.md, then read only the files each requirement\'s evidence needs; when you reach 25 calls stop reading and answer with what you have, marking every requirement you could not reach UNVERIFIABLE with the files you did not read named. A verdict returned with UNVERIFIABLE rows is worth more than a complete one never returned; a run that ends without your structured answer counts as no review at all.\n\n## Step 1 \u2014 resolve the diff\n\nRun the command given as DIFF at the end of this prompt (fall back to the\nworking tree if no merge-base is found \u2014 note which in your report).\n\n## Step 2 \u2014 read SPEC.md\n\nRead "docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md". Extract the numbered\nitems in its Requirements section. Skip any item explicitly marked superseded.\n\n## Step 3 \u2014 adjudicate ONE requirement at a time\n\nDo not scan the whole diff and form a general impression, then assign verdicts\nto match it. Handle exactly one requirement at a time: read it, decide what\nevidence would settle it, go find that evidence in the diff or the surrounding\nfile, write the verdict, then move to the next one.\n\n**Name the evidence before the verdict.** Write down the file:line (or files\nyou read) that settles the requirement BEFORE deciding PASS or FAIL.\n\nThe diff is not always sufficient. When a requirement concerns behavior in\ncode the diff only touches at the edges, read the surrounding file too.\nVerifying against the diff alone produces false FAILs on things that were\nalready true before this change.\n\n### Verdicts\n\n- **PASS** \u2014 the named evidence satisfies the requirement.\n- **FAIL** \u2014 the named evidence contradicts it, or the requirement asks for\n  something the change plainly does not do.\n- **UNVERIFIABLE** \u2014 no evidence in the diff or the tree could settle it,\n  because of how the requirement is worded (e.g. "the code is maintainable").\n  This is a spec-quality problem, not an implementation problem \u2014 report it as\n  info-severity, not high/critical.\n\nNever emit PASS/FAIL without a concrete file:line or "read: <file>" citation.\n\n## Step 4 \u2014 scope creep\n\nNote any file or behavior the diff touches that is not tied to any\nrequirement. Report these as separate low/info-severity findings \u2014 they are\nnot necessarily wrong, but nobody asked for them and a reviewer should see\nthem named explicitly.\n\n## Output\n\nMap your adjudication onto the same JSON contract every other domain\nreviewer uses, so it merges into REVIEW-REPORT.md unchanged:\n\n- Each FAIL becomes one finding, severity "high" (or "critical" if it\'s a\n  MUST-priority requirement that\'s plainly unmet).\n- Each UNVERIFIABLE becomes one finding, severity "info", flagging the\n  requirement\'s wording as unverifiable rather than the code as wrong.\n- Each scope-creep item becomes one finding, severity "low".\n- PASS requirements produce no finding (do not report passes as findings).\n\nFor every finding, `description` MUST include the requirement number and the\nverdict (e.g. "R-003: FAIL \u2014 ...", "R-005: UNVERIFIABLE \u2014 ...",\n"scope-creep: ..."), and `file`/`line` MUST point at the named evidence.\n\nReturn JSON:\n{\n  "domain": "Correctness",\n  "findings": [\n    {"id": "CORR-001", "severity": "high", "file": "...", "line": 0, "description": "R-003: FAIL \u2014 ...", "suggestion": "..."}\n  ]\n}\n\nOutput raw JSON only. No markdown fences.\n\nINPUTS\nDIFF BASE: `{{baseBranch}}` \u2014 the epic\'s recorded parent branch, so a chained epic is judged on its own commits only.\nDIFF: `git diff $(git merge-base HEAD {{baseBranch}})...HEAD`, falling back to `git diff {{baseBranch}}...HEAD`\n';

// skills/src/shared/agent-types.ts
var AGENT_TYPE_TABLE = {
  red: "datum-red",
  green: "datum-green",
  refactor: "datum-refactor",
  // #341 task-001: a structural lane's single writing stage. Not
  // datum-refactor — that definition says "clean up without changing
  // behaviour" and its pre-check answered "nothing to improve" on a file
  // that did not exist yet, so docs-only lanes completed with no commit.
  structural: "datum-structural",
  skeptic: "datum-skeptic",
  // #375: the Review lenses. Not datum-skeptic — that definition's body is
  // the lane panel's (read .datum/lane-spec.json, emit a read_witness, answer
  // PASS/FRAGILE/BROKEN), while a lens reads the epic diff and answers with a
  // findings array. Same read-only shape, plus a Bash matcher: the lens that
  // broke a run did it with `git checkout`, which Edit|Write cannot see.
  review: "datum-reviewer",
  reflect: "datum-reflect",
  docs: "datum-docs",
  reader: "datum-reader",
  // Read-only LLM *judges* (refactor pre-check, docs-staleness check). They
  // are not datum-reader: that definition says "read one file, return its
  // contents, do not interpret" at maxTurns 4, and these calls read every
  // file a lane touched and answer a rubric.
  quality: "datum-quality-reader",
  cli: "datum-cli"
};
var READ_ONLY_STAGES = ["skeptic", "review", "reflect", "reader", "quality", "cli"];
var READ_ONLY_AGENT_TYPES = new Set(READ_ONLY_STAGES.map((s) => AGENT_TYPE_TABLE[s]));
function isReadOnlyAgentType(agentType) {
  return typeof agentType === "string" && READ_ONLY_AGENT_TYPES.has(agentType);
}
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

// skills/src/shared/sha1.ts
function rotl(x, n) {
  return (x << n | x >>> 32 - n) >>> 0;
}
function sha1Hex(bytes) {
  const msgBitsLow = bytes.length * 8 >>> 0;
  const msgBitsHigh = Math.floor(bytes.length * 8 / 4294967296) >>> 0;
  const padded = bytes.slice();
  padded.push(128);
  while (padded.length % 64 !== 56) padded.push(0);
  padded.push(
    msgBitsHigh >>> 24 & 255,
    msgBitsHigh >>> 16 & 255,
    msgBitsHigh >>> 8 & 255,
    msgBitsHigh & 255,
    msgBitsLow >>> 24 & 255,
    msgBitsLow >>> 16 & 255,
    msgBitsLow >>> 8 & 255,
    msgBitsLow & 255
  );
  let h0 = 1732584193;
  let h1 = 4023233417;
  let h2 = 2562383102;
  let h3 = 271733878;
  let h4 = 3285377520;
  const w = new Array(80).fill(0);
  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      const o = chunkStart + i * 4;
      w[i] = (padded[o] << 24 | padded[o + 1] << 16 | padded[o + 2] << 8 | padded[o + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a2 = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const temp = rotl(a2, 5) + f + e + k + w[i] >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a2;
      a2 = temp;
    }
    h0 = h0 + a2 >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  const toHex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}
function gitBlobSha(bytes) {
  const header = `blob ${bytes.length}\0`;
  const headerBytes = [];
  for (let i = 0; i < header.length; i++) headerBytes.push(header.charCodeAt(i));
  return sha1Hex(headerBytes.concat(bytes));
}

// skills/src/shared/utf8.ts
function utf8Encode(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 56320 && d <= 57343) {
        c = 65536 + (c - 55296 << 10) + (d - 56320);
        i++;
      }
    }
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
function utf8ByteLength(s) {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) bytes += 1;
    else if (c < 2048) bytes += 2;
    else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 56320 && d <= 57343) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
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
  const inner = innerBatchScript(steps);
  const sha = gitBlobSha(utf8Encode(inner));
  const rootGuard = batchRoot ? [`cd ${shellQuote(batchRoot)} 2>/dev/null || { printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_root_missing: %s"}]\\n' ${shellQuote(batchRoot)}; exit 0; }`] : [];
  const toolPath = 'export PATH="$PATH:${DATUM_BATCH_TOOL_PREFIXES:-/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin}"';
  const jqGuard = `if ! jq --version >/dev/null 2>&1; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_tool_missing: jq is not on the runner PATH (set DATUM_BATCH_TOOL_PREFIXES or install jq)"}]\\n'; exit 0; fi`;
  return [
    ...rootGuard,
    toolPath,
    jqGuard,
    `__f=$(mktemp); trap 'rm -f "$__f"' EXIT`,
    `cat > "$__f" <<'${BATCH_EOF}'`,
    inner.replace(/\n$/, ""),
    BATCH_EOF,
    '__h=$(git hash-object "$__f" 2>&1)',
    // `bash "$__f"`, not sourced: the runner's Bash tool was zsh 5.9 on the
    // datum host (2026-09-07) and zsh refused to source the file with exit
    // 126 while bash ran it — every "boot refused the script" halt of the
    // week. The wrapper's cwd and exported PATH reach the child; a prelude
    // variable must be exported to be seen (the tests' `export __root=`).
    `if [ "$__h" != "${sha}" ]; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_script_corrupt: expected %s, got %s"}]\\n' "${sha}" "$__h"; else bash "$__f"; fi`
  ].join("\n") + "\n";
}
var BATCH_EOF = "DATUM_BATCH_EOF";
function shellQuote(s) {
  return `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
}
var batchRoot = "";
function setBatchRoot(root) {
  batchRoot = typeof root === "string" ? root.trim() : "";
}
function innerBatchScript(steps) {
  validateBatchSteps(steps);
  for (const s of steps) {
    if (s.command.split("\n").some((l) => l.trim() === BATCH_EOF)) throw new Error(`batch: step "${s.name}" contains the heredoc delimiter ${BATCH_EOF}`);
  }
  const lines = [
    "__bo=$(mktemp); __be=$(mktemp); __r='[]'",
    // #517: jq's exit is checked. A step jq cannot encode is still recorded —
    // without jq (name and exit code are validated/numeric, so a literal is
    // safe) and named on stderr — instead of vanishing from the array.
    `__rec() { __n=$(printf '%s' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" '. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]') && __r="$__n" || { __sep=","; [ "$__r" = "[]" ] && __sep=""; __r="\${__r%]}\${__sep}{\\"name\\":\\"$1\\",\\"exit_code\\":$2,\\"stdout\\":\\"\\",\\"stderr\\":\\"batch_rec_failed: jq could not record this step (exit $2; output lost, likely not valid UTF-8)\\"}]"; }; }`,
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
var BATCH_TOOL_TIMEOUT_MS = 6e5;
var TIMEOUT_RE = /timed out after|"error"\s*:\s*"timeout"|Command timed out/i;
function batchCommandPrompt(steps) {
  return `Run exactly this script with the Bash tool in ONE invocation, with the Bash tool's timeout parameter ${BATCH_TOOL_TIMEOUT_MS} (the script may run a whole test suite; the default two minutes is too short), and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.

` + (cacheKey ? `(inputs fingerprint ${cacheKey} \u2014 informational, do not act on it)

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
  if (!Array.isArray(arr)) {
    const text = typeof raw === "string" ? raw.replace(/```[a-z]*/gi, "").trim() : "";
    if (!text) return { steps: [], failed: null, missing: true };
    const prose = raw.trim();
    if (TIMEOUT_RE.test(prose)) {
      return { steps: [], failed: null, missing: true, scriptError: `batch_timeout: the runner's shell cut the script before it finished (runner said: "${prose.replace(/\s+/g, " ").slice(0, 160)}"); the Bash tool must be called with timeout ${BATCH_TOOL_TIMEOUT_MS}` };
    }
    const exited = /exit(?:ed)?(?: with)? code (\d+)/i.exec(prose);
    if (exited && /\b126\b|cannot execute|failed to execute/i.test(prose)) {
      return { steps: [], failed: null, missing: true, refusal: prose, scriptError: `batch_script_failed: the batch script exited ${exited[1]} before any step ran (the host shell refused to execute it; runner said: "${prose.replace(/\s+/g, " ").slice(0, 160)}")` };
    }
    if (/^\[\s*\{\s*"name"\s*:/.test(text)) {
      const names = [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      const complete = names.slice(0, -1);
      return { steps: [], failed: null, missing: true, scriptError: `batch_truncated: the runner's reply is a step array cut before it closed (${text.length} chars; last complete step: ${complete[complete.length - 1] ?? "none"}; cut inside: ${names[names.length - 1] ?? "unknown"}) \u2014 the script's stdout was too long to relay whole` };
    }
    return { steps: [], failed: null, missing: true, refusal: prose };
  }
  const results = arr.map(asStepResult).filter((r) => r !== null);
  if (results.length === 0) return { steps: [], failed: null, missing: true };
  if (results.length === 1 && results[0].name === "__script" && results[0].exit_code !== 0) {
    const { exit_code, stderr } = results[0];
    const guard = /^batch_(script_corrupt|root_missing|tool_missing)\b/.test(stderr.trim());
    const scriptError = guard ? stderr.trim() : `batch_script_failed: the batch script exited ${exit_code} before any step ran (the host shell refused to execute it; exit 126 is "cannot execute")${stderr.trim() ? `; runner said: "${stderr.trim().replace(/\s+/g, " ").slice(0, 160)}"` : ""}`;
    return scriptError.startsWith("batch_script_corrupt") ? { steps: [], failed: null, missing: true, corrupt: scriptError, scriptError } : { steps: [], failed: null, missing: true, scriptError };
  }
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const recFailed = results.find((r) => r.stderr.startsWith("batch_rec_failed:")) ?? null;
  const failed = recFailed ?? results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  const last = results[results.length - 1];
  const stoppedByFailFast = failed !== null && last?.name === failed.name && !tolerant.has(failed.name);
  if (results.length < steps.length && !stoppedByFailFast) {
    const returned = new Set(results.map((r) => r.name));
    const absent = steps.map((s) => s.name).filter((n) => !returned.has(n));
    return {
      steps: [],
      failed: null,
      missing: true,
      scriptError: `batch_incomplete: ${results.length} of ${steps.length} step records returned and no non-tolerant failure stopped the batch \u2014 the runner returned a partial result (last record: ${last?.name ?? "none"}); absent: [${absent.join(", ")}]`
    };
  }
  return { steps: results, failed, missing: false };
}
function stepResult(r, name) {
  return r.steps.find((s) => s.name === name) ?? null;
}
function stepStdout(r, name) {
  const s = stepResult(r, name);
  return s ? s.stdout : null;
}
var REFUSAL_RE = /\b(permission|denied|blocked|classifier|not allowed|refused?|unable to (?:run|execute)|can(?:no|')t (?:run|execute))\b/i;
function isRunnerRefusal(reply) {
  return REFUSAL_RE.test(reply);
}
function describeFailure(r, label) {
  if (r.missing) {
    if (r.corrupt) return `${label}: batch_script_corrupt \u2014 the runner did not run the script it was given (${r.corrupt})`;
    if (r.scriptError) return `${label}: ${r.scriptError}`;
    if (!r.refusal) return `${label}: runner_empty_result \u2014 batch agent returned no parseable result (empty reply)`;
    const excerpt = r.refusal.replace(/\s+/g, " ").slice(0, 300);
    if (REFUSAL_RE.test(r.refusal)) {
      return `${label}: runner_permission_denied \u2014 the datum-cli runner was refused by the host permission classifier and replied in prose; the commands in this batch need an allow-rule for this repo: "${excerpt}"`;
    }
    return `${label}: runner_no_json \u2014 batch agent returned no parseable result (reply: "${excerpt}")`;
  }
  if (!r.failed) return `${label}: ok`;
  const tail2 = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail2 ? ` \u2014 ${tail2}` : ""}`;
}

// skills/src/shared/gate.ts
function gateSteps(phase2, flags) {
  return [{ name: "gate", command: `datum gate ${phase2}${flags}`, tolerant: true }];
}
function parseGateResult(result) {
  const step = result.missing ? null : stepResult(result, "gate");
  if (!step) {
    return {
      passed: false,
      needsHuman: false,
      hardStop: false,
      exitCode: null,
      message: `gate_run_failed: ${describeFailure(result, "gate")}`
    };
  }
  let json = null;
  try {
    const text = step.stdout.trim();
    const start = text.indexOf("{");
    json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) : null;
  } catch {
    json = null;
  }
  if (!json || typeof json !== "object") {
    const tail2 = (step.stderr || step.stdout).trim().split("\n").slice(-3).join(" | ");
    return {
      passed: false,
      needsHuman: false,
      hardStop: step.exit_code === 2,
      exitCode: step.exit_code,
      message: `gate_run_failed: datum gate exited ${step.exit_code} without JSON${tail2 ? ` \u2014 ${tail2}` : ""}`
    };
  }
  return {
    passed: step.exit_code === 0 && json.passed === true,
    needsHuman: json.needs_human === true,
    hardStop: step.exit_code === 2 || json.hard_stop === true,
    exitCode: step.exit_code,
    message: typeof json.message === "string" ? json.message : ""
  };
}

// skills/src/shared/review-keys.ts
function normaliseFindingText(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function findingKey(domain, file, description) {
  const material = `${normaliseFindingText(domain)}|${file.trim()}|${normaliseFindingText(description)}`;
  return sha1Hex(utf8Encode(material)).slice(0, 8);
}

// skills/src/shared/review-branch.ts
function reviewBranchMoved(before, after) {
  const b = (before || "").trim();
  const a2 = (after || "").trim();
  if (!b || !a2 || b === a2) return null;
  return `review_branch_moved: the review lenses left the checkout on ${a2}, but Review started on ${b} \u2014 the diff, the synthesis and REVIEW-REPORT.md would all be for the wrong branch`;
}

// skills/src/shared/schemas.ts
var REVIEW_LENS_SCHEMA = {
  type: "object",
  properties: {
    domain: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          severity: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
          description: { type: "string" },
          suggestion: { type: "string" }
        },
        required: ["id", "severity", "file", "description"]
      }
    }
  },
  required: ["domain", "findings"]
};

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
function worktreeDirtySteps(wt) {
  return [{ name: "status", command: `git -C ${q(wt)} status --porcelain`, tolerant: true }];
}
function worktreeDirtyFromSteps(result) {
  if (result.missing) {
    return { dirty: true, known: false, detail: `retry_guard_unverified: ${describeFailure(result, "status")}` };
  }
  const step = stepResult(result, "status");
  if (!step || step.exit_code !== 0) {
    const tail2 = (step && (step.stderr || step.stdout) || "").trim().split("\n").slice(-3).join(" | ");
    return { dirty: true, known: false, detail: `retry_guard_unverified: git status exited ${step ? step.exit_code : "without running"}${tail2 ? ` \u2014 ${tail2}` : ""}` };
  }
  const lines = (step.stdout || "").split("\n").filter((l) => l.trim().length > 0);
  return { dirty: lines.length > 0, known: true, detail: lines.join(" | ") };
}

// skills/src/shared/agents.ts
var RATE_LIMIT_MAX_RETRIES = 4;
var RATE_LIMIT_BASE_DELAY_MS = 5e3;
var RATE_LIMIT_JITTER_MS = 2e3;
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function unknownAgentType(message) {
  const m = /agent type '([^']+)' not found/.exec(message);
  return m ? m[1] : null;
}
async function resilientAgent(prompt, opts, deps) {
  const agentFn = deps?.agentFn ?? agent;
  const logFn = deps?.logFn ?? log;
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let threw = false;
    let caughtMessage = "";
    try {
      lastResult = await agentFn(prompt, opts);
    } catch (err) {
      threw = true;
      caughtMessage = err instanceof Error ? err.message : String(err);
      lastResult = null;
    }
    const unknownType = threw ? unknownAgentType(caughtMessage) : null;
    if (unknownType && opts?.agentType) {
      logFn(`[resilientAgent] agent_type_unavailable: ${unknownType} \u2014 the host has not registered agents/${unknownType}.md (a new Claude Code session picks it up); running ${opts.label || "this call"} on the default agent instead`);
      const rest = { ...opts };
      delete rest.agentType;
      opts = rest;
      attempt--;
      continue;
    }
    if (!threw && lastResult !== null) return lastResult;
    if (threw) {
      logFn(`[resilientAgent] attempt ${attempt + 1} threw: ${caughtMessage} \u2014 treating as retryable`);
    } else if (attempt < maxRetries) {
      logFn(`[resilientAgent] attempt ${attempt + 1} returned nothing (null result) \u2014 retrying`);
    }
    if (attempt < maxRetries && opts?.worktree && !isReadOnlyAgentType(opts.agentType)) {
      const guardSteps = worktreeDirtySteps(opts.worktree);
      const guard = worktreeDirtyFromSteps(parseBatchResult(
        await agentFn(batchCommandPrompt(guardSteps), stageOpts("cli", { label: "retry-guard", model: "haiku" })),
        guardSteps
      ));
      if (!guard.known) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : "returned null"} and the worktree state is unknown (${guard.detail}) \u2014 aborting retry to prevent duplicate writes`);
        return lastResult;
      }
      if (guard.dirty) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : "returned null"} but worktree is dirty \u2014 aborting retry to prevent duplicate writes (${guard.detail})`);
        return lastResult;
      }
    }
    if (attempt < maxRetries) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt) + (attempt + 1) * 7919 % RATE_LIMIT_JITTER_MS;
      const reason = threw ? `threw: ${caughtMessage}` : "returned null";
      logFn(`[resilientAgent] attempt ${attempt + 1} ${reason}, backing off ${Math.round(delay / 1e3)}s before retry ${attempt + 2}/${maxRetries + 1}`);
      await sleepMs(delay);
    }
  }
  return lastResult;
}
var LARGE_BATCH_BYTES = 8 * 1024;
async function runBatch(steps, opts, deps) {
  const agentFn = deps?.agentFn ?? agent;
  const logFn = deps?.logFn ?? log;
  const prompt = batchCommandPrompt(steps);
  const promptBytes = utf8ByteLength(prompt);
  if (promptBytes > LARGE_BATCH_BYTES && opts.model !== model("balanced") && opts.model !== model("deep")) {
    logFn(`[runBatch] ${opts.label || "batch"}: ${promptBytes}-byte script routed to the balanced model (over ${LARGE_BATCH_BYTES} bytes, a fast-runner transcription slip is likely)`);
    opts = { ...opts, model: model("balanced") };
  }
  let result = parseBatchResult(await agentFn(prompt, opts), steps);
  const label = opts.label || "batch";
  const retryOpts = { ...opts, label: `${label}:retry` };
  if (result.missing && result.refusal && isRunnerRefusal(result.refusal)) {
    logFn(`[runBatch] ${label}: runner_permission_denied on attempt 1 ("${result.refusal.replace(/\s+/g, " ").slice(0, 120)}") \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner refused this batch`, retryOpts), steps);
  } else if (result.missing && result.corrupt) {
    logFn(`[runBatch] ${label}: batch_script_corrupt on attempt 1 (${result.corrupt}) \u2014 retrying once on the balanced model`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner mistyped this script; copy it exactly`, { ...retryOpts, model: model("balanced") }), steps);
  } else if (result.missing && !result.refusal && !result.scriptError) {
    logFn(`[runBatch] ${label}: runner_empty_result on attempt 1 (the runner returned nothing parseable) \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner returned nothing; return the script's stdout`, retryOpts), steps);
  } else if (result.missing && result.scriptError?.startsWith("batch_script_failed")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying with a fresh runner (up to two retries)`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 3 \u2014 the previous runner's shell refused to execute the script; run it again`, retryOpts), steps);
    if (result.missing && result.scriptError?.startsWith("batch_script_failed")) {
      logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 2 \u2014 last retry with a fresh runner`);
      result = parseBatchResult(await agentFn(`${prompt}

# attempt 3 of 3 \u2014 two runners' shells refused to execute the script; run it again`, { ...opts, label: `${label}:retry2` }), steps);
    }
  } else if (result.missing && result.scriptError?.startsWith("batch_truncated")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner's reply was cut before the JSON array closed; return the script's stdout complete and unabridged, nothing else`, retryOpts), steps);
  } else if (result.missing && result.scriptError?.startsWith("batch_timeout")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with the timeout instruction repeated`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner's shell cut the script short; call the Bash tool with timeout 600000 and let the script finish`, retryOpts), steps);
  } else if (result.missing && /^batch_(root_missing|tool_missing)/.test(result.scriptError || "")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with a fresh runner (a guard row is not trusted until it repeats)`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 run the script exactly; if its guard prints a row, return that row, never one you wrote`, retryOpts), steps);
  }
  return result;
}

// skills/src/shared/write-steps.ts
var HEREDOC_TERMINATOR = "DATUM_WRITE_EOF";
var q2 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
var DEFAULT_NAMES = { mkdir: "mkdir", write: "write", sha: "sha" };
function heredocBytes(content) {
  return content === "" || content.endsWith("\n") ? content : content + "\n";
}
function writeFileSteps(o) {
  if (o.content.split("\n").some((line) => line === HEREDOC_TERMINATOR)) {
    throw new Error(`writeFileSteps: content contains the heredoc terminator ${HEREDOC_TERMINATOR} on its own line`);
  }
  const names = o.names ?? DEFAULT_NAMES;
  const slash = o.path.lastIndexOf("/");
  const dir = slash > 0 ? o.path.slice(0, slash) : ".";
  const body = heredocBytes(o.content);
  const write = body === "" ? `: > ${q2(o.path)}` : `cat > ${q2(o.path)} <<'${HEREDOC_TERMINATOR}'
${body.slice(0, -1)}
${HEREDOC_TERMINATOR}`;
  return [
    { name: names.mkdir, command: `mkdir -p ${q2(dir)}` },
    { name: names.write, command: write },
    { name: names.sha, command: `git hash-object ${q2(o.path)}`, tolerant: true }
  ];
}
function writeFileBlobSha(content) {
  return gitBlobSha(utf8Encode(heredocBytes(content)));
}
function tail(step) {
  return (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
}
function writeFileFromSteps(result, o) {
  const names = o.names ?? DEFAULT_NAMES;
  if (result.missing) return { ok: false, error: `${o.prefix}_write_failed: ${describeFailure(result, names.write)}` };
  for (const name of [names.mkdir, names.write]) {
    const step = stepResult(result, name);
    if (!step) return { ok: false, error: `${o.prefix}_write_failed: ${name} step did not run` };
    if (step.exit_code !== 0) return { ok: false, error: `${o.prefix}_write_failed: ${name} exited ${step.exit_code} \u2014 ${tail(step)}` };
  }
  const sha = (stepResult(result, names.sha)?.stdout || "").trim();
  if (sha !== o.expectedSha) {
    return { ok: false, error: `${o.prefix}_write_mismatch: ${o.path} on disk is blob ${sha || "(none)"}, the script wrote ${o.expectedSha} \u2014 the runner did not copy the heredoc verbatim` };
  }
  return { ok: true, error: "" };
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/lane-steps.ts
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function withPreamble(text) {
  return PREAMBLE + text;
}

// skills/src/datum-review.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
else configureAgentTypes({});
setBatchCacheKey(a.configFingerprint || "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
var DOMAINS = [
  { domain: "Security", prefix: "SEC", focus: "OWASP top 10, injection, auth bypass, secrets exposure, unsafe deserialization", model: model("balanced") },
  { domain: "Performance", prefix: "PERF", focus: "Hot paths, N+1 queries, unbounded loops, missing pagination, excessive allocations", model: model("fast") },
  { domain: "Architecture", prefix: "ARCH", focus: "Layer violations, tight coupling, dependency direction, abstraction leaks", model: model("fast") },
  { domain: "Correctness", prefix: "CORR", focus: "Does implementation match SPEC and ACs? Off-by-one, null handling, edge cases", model: model("balanced") }
];
phase("Review");
function normaliseSeverity(raw, where) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low" || v === "info") return v;
  if (/\b(crit|blocker|sev ?0|sev ?1|p0|p1)\b/.test(v)) return "critical";
  log(`review_severity_unknown: ${where} reported severity ${JSON.stringify(raw)} \u2014 counted as high (fail closed)`);
  return "high";
}
var baseSteps = [
  { name: "base-branch", command: "datum epic-base", tolerant: true },
  { name: "branch-before", command: "git rev-parse --abbrev-ref HEAD", tolerant: true }
];
var baseResult = await runBatch(baseSteps, stageOpts("cli", { label: "read-base", model: model("fast") }));
var baseBranch = (stepStdout(baseResult, "base-branch") || "").trim();
var branchBefore = (stepStdout(baseResult, "branch-before") || "").trim();
if (!branchBefore) log("review_branch_unchecked: the pre-lens branch read returned nothing \u2014 the branch-drift check is skipped this run");
if (!baseBranch || /\s/.test(baseBranch)) {
  throw new Error(`review_base_unresolved: datum epic-base printed ${JSON.stringify(baseBranch)} (${baseResult.missing ? "batch returned no result" : describeFailure(baseResult, "read-base")})`);
}
log(`Review diff base: ${baseBranch}`);
var earlyGateSteps = gateSteps("review", " --approve");
var earlyGate = parseGateResult(await runBatch(earlyGateSteps, stageOpts("cli", { label: "gate-early", model: model("fast") })));
var alreadyComplete = earlyGate.passed;
if (alreadyComplete) log(`review_already_complete: REVIEW-REPORT.md passes the review gate (${earlyGate.message || "no blocking findings"}) \u2014 lenses not re-run`);
async function reviewFromDiff() {
  const lensWorktree = typeof a.repoRoot === "string" && a.repoRoot ? { worktree: a.repoRoot } : {};
  const reviewResults = await parallel(
    DOMAINS.map(
      (d) => () => resilientAgent(
        withPreamble(d.domain === "Correctness" ? renderPrompt(review_correctness_spec_verify_default, { baseBranch }) : renderPrompt(review_domain_default, { domain: d.domain, domainPrefix: d.prefix, domainFocus: d.focus, baseBranch })),
        // One retry (#341 wf_ae694af5-a70): three lenses hit the turn cap on a
        // 115-file diff without calling StructuredOutput; with no retry the
        // phase halted on the first of them.
        stageOpts("review", { label: `review-${d.domain.toLowerCase()}`, phase: "Review", model: d.model, schema: REVIEW_LENS_SCHEMA, maxRetries: 1, ...lensWorktree })
      )
    )
  );
  const allFindings = [];
  for (let i = 0; i < DOMAINS.length; i++) {
    const result = reviewResults[i];
    if (!result) {
      throw new Error(`agent_output_unparseable: review-${DOMAINS[i].domain.toLowerCase()} \u2014 (no result)`);
    }
    const parsed = typeof result === "string" ? parseAgentJsonStrict(result, `review-${DOMAINS[i].domain.toLowerCase()}`) : result;
    if (!Array.isArray(parsed.findings)) {
      throw new Error(`agent_output_unparseable: review-${DOMAINS[i].domain.toLowerCase()} \u2014 reply has no findings array`);
    }
    log(`${parsed.domain}: ${parsed.findings.length} findings`);
    for (const raw of parsed.findings) {
      const description = String(raw.description ?? "");
      const f = {
        ...raw,
        severity: normaliseSeverity(raw.severity, `review-${DOMAINS[i].domain.toLowerCase()} ${raw.id || ""}`),
        description,
        key: findingKey(DOMAINS[i].domain, String(raw.file ?? ""), description)
      };
      log(`  [${f.severity}] ${f.id}: ${f.description.slice(0, 80)}`);
      allFindings.push(f);
    }
  }
  phase("Synthesize");
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const f of allFindings) {
    const key = `${f.file}:${f.line}:${f.description.slice(0, 40)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }
  const critical = deduped.filter((f) => f.severity === "critical" || f.severity === "high");
  log(`Findings: ${deduped.length} unique (${critical.length} high/critical)`);
  const reportLines = [
    "# Review Report\n",
    `**Findings:** ${deduped.length} unique (${critical.length} high/critical)
`,
    "## Findings\n",
    "| ID | Severity | File | Line | Description | Suggestion | Key |",
    "|---|---|---|---|---|---|---|",
    ...deduped.map((f) => `| ${f.id} | **${f.severity}** | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} | ${f.key} |`),
    ""
  ];
  const branchSteps = [{ name: "branch", command: "git rev-parse --abbrev-ref HEAD", tolerant: true }];
  const branchResult = await runBatch(branchSteps, stageOpts("cli", { label: "read-branch", model: model("fast") }));
  const branch = (stepStdout(branchResult, "branch") || "").trim();
  if (!branch) throw new Error(`review_branch_unresolved: git rev-parse printed nothing (${branchResult.missing ? "batch returned no result" : "empty stdout"})`);
  const moved = reviewBranchMoved(branchBefore, branch);
  if (moved) throw new Error(moved);
  const epicDir = `docs/epics/${branch}`;
  const reportPath = `${epicDir}/REVIEW-REPORT.md`;
  const reportContent = reportLines.join("\n");
  const writeSteps = writeFileSteps({ path: reportPath, content: reportContent });
  const written = writeFileFromSteps(await runBatch(writeSteps, stageOpts("cli", { label: "write-report", model: model("fast") })), { path: reportPath, expectedSha: writeFileBlobSha(reportContent), prefix: "review_report" });
  if (!written.ok) throw new Error(written.error);
  const commitStepList = commitFilesSteps({ wt: ".", files: [reportPath], message: `review: REVIEW-REPORT.md (${deduped.length} findings)` });
  const commit = commitFilesFromSteps(await runBatch(commitStepList, stageOpts("cli", { label: "commit-report", model: model("fast") })));
  if (commit.error) throw new Error(`review_commit_failed: ${commit.error}`);
  if (commit.nothingToCommit) log("REVIEW-REPORT.md unchanged since the last review \u2014 nothing to commit");
  else log(`REVIEW-REPORT.md committed (${commit.sha})`);
  if (critical.length > 0) log(`${critical.length} high/critical \u2014 remediation needed`);
  return { deduped, critical };
}
var outcome = alreadyComplete ? null : await reviewFromDiff();
var gateStepList = gateSteps("review", yolo ? " --approve" : "");
var gate = parseGateResult(await runBatch(gateStepList, stageOpts("cli", { label: "gate", model: model("fast") })));
if (gate.passed) log("Review gate PASSED");
else log(`Review gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
return {
  // On the skip path the report was not regenerated: the gate's verdict is
  // the only truth about it (accepted findings do not block), so canMerge
  // follows the gate rather than a count of unreviewed rows.
  totalFindings: outcome ? outcome.deduped.length : -1,
  criticalFindings: outcome ? outcome.critical.length : 0,
  canMerge: outcome ? outcome.critical.length === 0 : gate.passed || gate.needsHuman,
  alreadyComplete,
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman
};
