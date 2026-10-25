// @generated — DO NOT EDIT. Source: skills/src/runtime/runner.ts
// skills/src/runtime/runner.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join3, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// assets/runtime-kinds.json
var runtime_kinds_default = {
  kinds: ["fake", "pi"],
  unavailable: []
};

// skills/src/shared/models.ts
var DEFAULT_TIERS = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
var activeTiers = { ...DEFAULT_TIERS };
function setModelTiers(tiers) {
  activeTiers = { ...DEFAULT_TIERS, ...tiers };
}
var DEFAULT_STAGE_TIMEOUT_S = 900;
var RUNTIME_KINDS = runtime_kinds_default.kinds;
var RUNTIME_TIERS = ["fast", "balanced", "deep"];
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function readRuntimeConfig(parsedConfig) {
  const block = parsedConfig && isRecord(parsedConfig) ? parsedConfig.runtime : void 0;
  if (!isRecord(block)) throw new Error("runtime_block_missing");
  const kind = block.kind;
  if (typeof kind !== "string" || !RUNTIME_KINDS.includes(kind)) {
    throw new Error(`runtime_kind_unknown: ${String(kind)}`);
  }
  const rawModels = isRecord(block.models) ? block.models : {};
  const models = {};
  for (const tier of RUNTIME_TIERS) {
    const id = rawModels[tier];
    if (typeof id !== "string" || id === "") throw new Error(`runtime_models_missing: ${tier}`);
    models[tier] = id;
  }
  const concurrency = {};
  if (isRecord(block.concurrency)) {
    for (const [modelId, n] of Object.entries(block.concurrency)) {
      if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
        throw new Error(`runtime_concurrency_invalid: ${modelId}`);
      }
      concurrency[modelId] = n;
    }
  }
  const priority = block.priority === "interactive" ? "interactive" : "batch";
  const client = typeof block.client === "string" && block.client !== "" ? block.client : "datum";
  const base = { kind, models, concurrency, priority, client };
  if (kind !== "pi") return base;
  if (typeof block.stage_script !== "string" || block.stage_script === "") throw new Error("runtime_stage_script_missing");
  let stageTimeoutS = DEFAULT_STAGE_TIMEOUT_S;
  if (block.stage_timeout_s !== void 0) {
    const t = block.stage_timeout_s;
    if (typeof t !== "number" || !Number.isInteger(t) || t <= 0) throw new Error("runtime_stage_timeout_invalid");
    stageTimeoutS = t;
  }
  return { ...base, stageScript: block.stage_script, stageTimeoutS, commitsExternal: block.commits_external === true };
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

// skills/src/runtime/semaphore.ts
function createModelSemaphores(concurrency) {
  const states = /* @__PURE__ */ new Map();
  const stateFor = (model) => {
    let s = states.get(model);
    if (!s) {
      const limit = Object.prototype.hasOwnProperty.call(concurrency, model) ? concurrency[model] : 1;
      s = { limit, active: 0, waiters: [] };
      states.set(model, s);
    }
    return s;
  };
  const take = (state, agentType) => {
    state.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active--;
      if (state.waiters.length === 0) return;
      let idx = agentType === void 0 ? -1 : state.waiters.findIndex((w) => w.agentType === agentType);
      if (idx < 0) idx = 0;
      const [next] = state.waiters.splice(idx, 1);
      next.grant();
    };
  };
  return {
    acquire(model, agentType) {
      const state = stateFor(model);
      if (state.active < state.limit) return Promise.resolve(take(state, agentType));
      return new Promise((resolve2) => {
        state.waiters.push({ agentType, grant: () => resolve2(take(state, agentType)) });
      });
    }
  };
}

// skills/src/runtime/metrics.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
var pad = (n, width = 2) => String(n).padStart(width, "0");
function currentTime() {
  return Reflect.construct(Date, []);
}
function deriveRunId(start) {
  return `${pad(start.getUTCFullYear(), 4)}${pad(start.getUTCMonth() + 1)}${pad(start.getUTCDate())}-${pad(start.getUTCHours())}${pad(start.getUTCMinutes())}${pad(start.getUTCSeconds())}`;
}
var RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function resolveRunId(args, start) {
  if (typeof args === "object" && args !== null) {
    const id = args.runId;
    if (typeof id === "string" && id !== "") {
      if (!RUN_ID_RE.test(id)) throw new Error(`run_id_invalid: ${JSON.stringify(id)} is not one plain path segment (${RUN_ID_RE.source})`);
      return id;
    }
  }
  return deriveRunId(start);
}
function buildMetricsLine(input) {
  const usage = input.reply?.usage;
  const timings = input.reply?.timings;
  return {
    ts: input.ts.toISOString(),
    run_id: input.runId,
    label: input.label ?? "",
    agent_type: input.agentType ?? "",
    model: input.model,
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    cached_tokens: usage?.cached_tokens ?? 0,
    prefill_ms: timings?.prefill_ms ?? 0,
    decode_ms: timings?.decode_ms ?? 0,
    queue_wait_ms: input.queueWaitMs,
    wall_ms: input.wallMs,
    attempt: input.attempt,
    outcome: input.outcome
  };
}
function appendMetricsLine(repoRoot, line) {
  const dir = join(repoRoot, ".datum", "runs", line.run_id);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "metrics.jsonl"), JSON.stringify(line) + "\n");
}

// skills/src/runtime/validate.ts
function typeMatches(type, value) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}
function validateAgainstSchema(schema, value) {
  if (!typeMatches("object", value)) return ["value: expected object"];
  const { properties = {}, required = [] } = schema;
  const record = value;
  const problems = [];
  for (const field of required) {
    if (record[field] === void 0) problems.push(`${field}: missing`);
  }
  for (const [field, spec] of Object.entries(properties)) {
    const present = record[field];
    if (present === void 0 || spec.type === void 0) continue;
    if (!typeMatches(spec.type, present)) problems.push(`${field}: expected ${spec.type}`);
  }
  return problems;
}

// skills/src/runtime/fake-executor.ts
var FakeExecutor = class {
  constructor(script, defaultReply) {
    this.script = script;
    this.defaultReply = defaultReply;
  }
  script;
  defaultReply;
  requests = [];
  holds = /* @__PURE__ */ new Map();
  hold(labelPrefix) {
    if (this.holds.has(labelPrefix)) return;
    let open;
    const promise = new Promise((resolve2) => {
      open = resolve2;
    });
    this.holds.set(labelPrefix, { promise, open });
  }
  release(labelPrefix) {
    const gate = this.holds.get(labelPrefix);
    if (!gate) return;
    this.holds.delete(labelPrefix);
    gate.open();
  }
  async execute(req) {
    const record = {
      prompt: req.prompt,
      model: req.model,
      opts: req.opts,
      startedAt: performance.now(),
      endedAt: null
    };
    this.requests.push(record);
    try {
      const label = req.opts.label;
      if (label !== void 0) {
        const gates = [...this.holds].filter(([prefix]) => label.startsWith(prefix)).map(([, g]) => g.promise);
        await Promise.all(gates);
      }
      const entry = label === void 0 ? void 0 : this.script.find((e) => label.startsWith(e.labelPrefix));
      if (!entry) return this.defaultReply;
      return typeof entry.reply === "function" ? entry.reply(req) : entry.reply;
    } finally {
      record.endedAt = performance.now();
    }
  }
};

// skills/src/runtime/pi-executor.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync as mkdirSync2, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join as join2 } from "node:path";

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

// skills/src/runtime/pi-executor.ts
var CONTAINER_WORKTREE = "/work";
var HARD_KILL_GRACE_S = 60;
var STDERR_TAIL_CHARS = 2048;
function sanitizeLabel(label) {
  const cleaned = label.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned === "" ? "unlabeled" : cleaned;
}
function roleOf(agentType) {
  if (agentType === void 0 || !agentType.startsWith("datum-") || agentType.length === "datum-".length) return void 0;
  return agentType.slice("datum-".length);
}
function rewritePrompt(prompt, worktree) {
  return prompt.split(worktree).join(CONTAINER_WORKTREE);
}
function exitErrorCode(code) {
  if (code === 2) return "stage_usage_error";
  if (code === 3) return "stage_guard_blocked";
  if (code === 4) return "stage_timeout";
  return void 0;
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isRecord2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseReply(raw) {
  if (!isRecord2(raw)) return { why: "reply.json is not an object" };
  if (typeof raw.text !== "string") return { why: "text is not a string" };
  const reply = { text: raw.text };
  if (raw.usage !== void 0) {
    const u = raw.usage;
    if (!isRecord2(u) || !isNum(u.prompt_tokens) || !isNum(u.completion_tokens) || !isNum(u.cached_tokens)) {
      return { why: "usage needs numeric prompt_tokens, completion_tokens, cached_tokens" };
    }
    const usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, cached_tokens: u.cached_tokens };
    reply.usage = usage;
  }
  if (raw.timings !== void 0) {
    const t = raw.timings;
    if (!isRecord2(t) || !isNum(t.prefill_ms) || !isNum(t.decode_ms)) return { why: "timings needs numeric prefill_ms, decode_ms" };
    const timings = { prefill_ms: t.prefill_ms, decode_ms: t.decode_ms };
    reply.timings = timings;
  }
  return { reply };
}
function runScript(script, worktree, stageJson, hardKillMs) {
  return new Promise((resolve2) => {
    const child = spawn("bash", [script, worktree, stageJson], { stdio: ["ignore", "ignore", "pipe"], detached: true });
    let tail = "";
    let hardKilled = false;
    let done = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      tail = (tail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    const timer = setTimeout(() => {
      hardKilled = true;
      try {
        if (child.pid !== void 0) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, hardKillMs);
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve2({ ...r, stderrTail: tail, hardKilled });
    };
    child.on("error", (err) => finish({ code: null, signal: null, spawnError: err }));
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function buildLaneGuard(agentType, worktree, fail) {
  if (isReadOnlyAgentType(agentType)) return { allowed_write_files: [], forbidden_write_files: [], read_only: true };
  const ctxFile = join2(worktree, ".datum", "lane-context.json");
  if (!existsSync(ctxFile)) throw fail("stage_guard_context_missing");
  let raw;
  try {
    raw = JSON.parse(readFileSync(ctxFile, "utf8"));
  } catch (err) {
    throw fail("stage_guard_context_invalid", `cannot read lane-context.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord2(raw) || !isStringArray(raw.allowed_write_files) || !isStringArray(raw.forbidden_write_files)) {
    throw fail("stage_guard_context_invalid", "lane-context.json needs string arrays allowed_write_files and forbidden_write_files");
  }
  return { allowed_write_files: raw.allowed_write_files, forbidden_write_files: raw.forbidden_write_files, read_only: false };
}
var PiExecutor = class {
  constructor(runtime, ctx) {
    this.runtime = runtime;
    this.ctx = ctx;
  }
  runtime;
  ctx;
  counter = 0;
  async execute(req) {
    const label = req.opts.label ?? "";
    const role = roleOf(req.opts.agentType);
    if (role === void 0) throw new Error(`stage_role_missing: ${label}: agentType ${JSON.stringify(req.opts.agentType)} is not a datum- agent type`);
    const worktree = req.opts.worktree ?? this.ctx.repoRoot;
    if (!isAbsolute(worktree) || !isDirectory(worktree)) {
      throw new Error(`stage_worktree_missing: ${label}: ${worktree} is not an existing absolute directory`);
    }
    const { stageScript: script, stageTimeoutS: timeoutS } = this.runtime;
    if (script === void 0 || timeoutS === void 0) throw new Error(`runtime_stage_script_missing: ${label}`);
    this.counter += 1;
    const dir = join2(this.ctx.repoRoot, ".datum", "runs", this.ctx.runId, "stages", `${this.counter}-${sanitizeLabel(label)}`);
    const fail = (code, detail) => new Error(`${code}: ${label} (${dir})${detail === void 0 ? "" : `: ${detail}`}`);
    mkdirSync2(dir, { recursive: true, mode: 448 });
    const promptFile = join2(dir, "prompt.md");
    const replyFile = join2(dir, "reply.json");
    const stageJson = join2(dir, "stage.json");
    writeFileSync(promptFile, rewritePrompt(req.prompt, worktree));
    writeFileSync(
      stageJson,
      JSON.stringify({
        model: req.model,
        role,
        read_only: isReadOnlyAgentType(req.opts.agentType),
        prompt_file: promptFile,
        reply_file: replyFile,
        timeout_s: timeoutS,
        headers: req.headers,
        label,
        worktree
      })
    );
    const guard = buildLaneGuard(req.opts.agentType, worktree, fail);
    mkdirSync2(join2(worktree, ".datum"), { recursive: true });
    writeFileSync(join2(worktree, ".datum", "lane-guard.json"), JSON.stringify(guard));
    const result = await runScript(script, worktree, stageJson, (timeoutS + HARD_KILL_GRACE_S) * 1e3);
    if (result.spawnError !== void 0) throw fail("stage_failed", `spawn error: ${result.spawnError.message}`);
    if (result.hardKilled) throw fail("stage_timeout", `process group killed after ${timeoutS + HARD_KILL_GRACE_S}s`);
    if (result.code === null) throw fail("stage_failed", `killed by signal ${result.signal ?? "unknown"}
${result.stderrTail}`);
    if (result.code !== 0) {
      const named = exitErrorCode(result.code);
      if (named !== void 0) throw fail(named);
      throw fail(`stage_failed: exit ${result.code}`, result.stderrTail);
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(replyFile, "utf8"));
    } catch (err) {
      throw fail("stage_reply_invalid", `cannot read reply.json: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = parseReply(raw);
    if ("why" in parsed) throw fail("stage_reply_invalid", parsed.why);
    return parsed.reply;
  }
};
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// skills/src/runtime/executors.ts
function selectExecutor(runtime, ctx) {
  if (runtime.kind === "fake") return new FakeExecutor([], { text: "{}" });
  if (runtime.kind === "pi") return new PiExecutor(runtime, ctx);
  throw new Error(`runtime_kind_unsupported: ${runtime.kind}`);
}

// skills/src/runtime/shell.ts
import { spawn as spawn2 } from "node:child_process";
var DEFAULT_MAX_STDOUT_CHARS = 16 * 1024 * 1024;
var DEFAULT_MAX_STDERR_CHARS = 64 * 1024;
function createNodeShell(limits = {}) {
  const maxStdout = limits.maxStdoutChars ?? DEFAULT_MAX_STDOUT_CHARS;
  const maxStderr = limits.maxStderrChars ?? DEFAULT_MAX_STDERR_CHARS;
  return (script, opts) => new Promise((resolve2, reject) => {
    const child = spawn2("bash", ["-c", script], {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    let stdout = "";
    let stderrTail = "";
    let stderrDropped = 0;
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const killGroup = () => {
      try {
        if (child.pid !== void 0) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      if (stdout.length + chunk.length > maxStdout) {
        finish(() => {
          killGroup();
          reject(new Error(`shell_output_too_large: stdout passed ${maxStdout} characters; the script was killed`));
        });
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      const joined = stderrTail + chunk;
      if (joined.length > maxStderr) {
        stderrDropped += joined.length - maxStderr;
        stderrTail = joined.slice(joined.length - maxStderr);
      } else {
        stderrTail = joined;
      }
    });
    const timer = setTimeout(() => {
      finish(() => {
        killGroup();
        reject(new Error(`shell timeout after ${opts.timeoutMs}ms`));
      });
    }, opts.timeoutMs);
    child.on("error", (err) => finish(() => reject(err)));
    child.on(
      "close",
      (code, signal) => finish(() => {
        let stderr = stderrTail;
        if (stderrDropped > 0) {
          const nl = stderr.indexOf("\n");
          stderr = `[stderr truncated: ${stderrDropped} earlier characters dropped]
${nl >= 0 ? stderr.slice(nl + 1) : stderr}`;
        }
        resolve2({ exit_code: code ?? (signal ? 128 : 1), stdout, stderr });
      })
    );
  });
}
var nodeShell = createNodeShell();

// skills/src/runtime/runner.ts
var SHELL_CONCURRENCY_KEY = "shell";
var WORKFLOW_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var AsyncFunction = Object.getPrototypeOf(async function() {
}).constructor;
var TIERS = ["fast", "balanced", "deep"];
function stripMetaExport(source) {
  return source.replace(/^export(\s+const\s+meta\b)/m, "$1");
}
var DEFAULT_TIER_NAMES = { haiku: "fast", sonnet: "balanced", opus: "deep" };
function resolveModel(runtime, requested, bundleTiers = {}) {
  if (requested === void 0) return runtime.models.balanced;
  if (TIERS.includes(requested)) return runtime.models[requested];
  if (Object.values(runtime.models).includes(requested)) return requested;
  for (const tier of TIERS) if (bundleTiers[tier] === requested) return runtime.models[tier];
  const byDefault = DEFAULT_TIER_NAMES[requested];
  return byDefault ? runtime.models[byDefault] : requested;
}
async function runBundle(opts) {
  const { bundlePath, args, executor, shell, log, runtime } = opts;
  const rootSource = stripMetaExport(readFileSync2(bundlePath, "utf8"));
  setModelTiers(runtime.models);
  const runId = opts.runId ?? resolveRunId(args, currentTime());
  let spentTokens = 0;
  const addUsage = (u) => {
    if (u) spentTokens += u.prompt_tokens + u.completion_tokens;
  };
  const semaphores = createModelSemaphores(runtime.concurrency);
  const headers = { "X-Client": runtime.client, "X-Priority": runtime.priority };
  const boundedShell = async (script, shellOpts) => {
    const release = await semaphores.acquire(SHELL_CONCURRENCY_KEY, SHELL_CONCURRENCY_KEY);
    try {
      return await shell(script, shellOpts);
    } finally {
      release();
    }
  };
  const attempt = async (prompt, agentOpts, model, attemptNo, validate) => {
    const enteredAt = performance.now();
    const release = await semaphores.acquire(model, agentOpts.agentType);
    const acquiredAt = performance.now();
    let reply;
    let failure;
    let failed = false;
    try {
      reply = await executor.execute({ prompt, opts: agentOpts, model, headers: { ...headers } });
    } catch (err) {
      failed = true;
      failure = err;
    } finally {
      release();
    }
    const valid = !failed && reply !== void 0 && (validate ? validate(reply) : true);
    appendMetricsLine(
      opts.repoRoot,
      buildMetricsLine({
        ts: currentTime(),
        runId,
        label: agentOpts.label,
        agentType: agentOpts.agentType,
        model,
        reply,
        queueWaitMs: acquiredAt - enteredAt,
        wallMs: performance.now() - acquiredAt,
        attempt: attemptNo,
        outcome: failed ? "error" : valid ? "ok" : "invalid"
      })
    );
    if (failed || reply === void 0) throw failure;
    addUsage(reply.usage);
    return { reply, valid };
  };
  const tierOf = (model) => {
    for (const tier of [...TIERS].reverse()) if (runtime.models[tier] === model) return tier;
    return "fast";
  };
  const agent = async (prompt, agentOpts = {}) => {
    if (agentOpts.agentType === "datum-cli") {
      throw new Error(`cli_call_bypassed_runbatch: agent() call '${agentOpts.label ?? ""}' has agentType datum-cli`);
    }
    const model = resolveModel(runtime, agentOpts.model, opts.bundleTiers);
    const schema = agentOpts.schema;
    if (schema === void 0) {
      const { reply } = await attempt(prompt, agentOpts, model, 1, void 0);
      return parseAgentJson(reply.text, null);
    }
    const label = agentOpts.label ?? "";
    let lastProblems = [];
    const check = (reply) => {
      lastProblems = validateAgainstSchema(schema, parseAgentJson(reply.text, null));
      return lastProblems.length === 0;
    };
    const first = await attempt(prompt, agentOpts, model, 1, check);
    if (first.valid) return parseAgentJson(first.reply.text, null);
    log(`stage_output_invalid: ${label}: ${lastProblems.join(", ")}`);
    const tier = tierOf(model);
    if (tier === "deep") {
      if (runtime.models.fast === model || runtime.models.balanced === model) log(`stage_output_invalid: ${label}: no distinct higher tier`);
      return null;
    }
    const retryModel = runtime.models[tier === "fast" ? "balanced" : "deep"];
    if (retryModel === model) {
      log(`stage_output_invalid: ${label}: no distinct higher tier`);
      return null;
    }
    const second = await attempt(prompt, { ...agentOpts, model: retryModel }, retryModel, 2, check);
    if (second.valid) return parseAgentJson(second.reply.text, null);
    log(`stage_output_invalid: ${label}: ${lastProblems.join(", ")}`);
    return null;
  };
  const parallel = async (thunks) => Promise.all(
    thunks.map(async (thunk) => {
      try {
        return await thunk();
      } catch {
        return null;
      }
    })
  );
  const pipeline = async (items, ...stages) => Promise.all(
    items.map(async (item) => {
      try {
        let value = item;
        for (const stage of stages) value = await stage(value);
        return value;
      } catch {
        return null;
      }
    })
  );
  const phase = (title) => log(`== ${title} ==`);
  const budget = {
    total: null,
    spent: () => spentTokens,
    remaining: () => null
  };
  const execute = (source, scriptArgs) => {
    const fn = new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "workflow", "shell", "args", "budget", source);
    return fn(agent, parallel, pipeline, phase, log, workflow, boundedShell, scriptArgs, budget);
  };
  const workflow = async (ref, childArgs) => {
    let path = ref.scriptPath;
    if (path === void 0) {
      const name = ref.name ?? "";
      if (!WORKFLOW_NAME_RE.test(name)) throw new Error(`workflow_name_invalid: ${JSON.stringify(name)} is not a bare bundle name`);
      path = opts.skillsDirs.map((dir) => join3(dir, `${name}.js`)).find((candidate) => existsSync2(candidate));
      if (path === void 0) {
        throw new Error(`workflow_not_found: ${name} (searched: ${opts.skillsDirs.join(", ")})`);
      }
    }
    return execute(stripMetaExport(readFileSync2(path, "utf8")), childArgs);
  };
  const g = globalThis;
  const keys = ["datumRuntime", "shell", "args"];
  const saved = keys.map((k) => ({ k, had: k in g, v: g[k] }));
  g.datumRuntime = { agentTypes: true };
  g.shell = boundedShell;
  g.args = args;
  try {
    return await execute(rootSource, args);
  } finally {
    for (const { k, had, v } of saved) {
      if (had) g[k] = v;
      else delete g[k];
    }
  }
}
var MAIN_FLAGS = ["--bundle", "--args", "--config", "--repo-root", "--skills-dir"];
function parseMainArgv(argv) {
  const found = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!MAIN_FLAGS.includes(flag)) throw new Error(`runner_flag_unknown: ${flag}`);
    const value = argv[i + 1];
    if (value === void 0) throw new Error(`runner_flag_value_missing: ${flag}`);
    (found[flag] ??= []).push(value);
  }
  for (const flag of MAIN_FLAGS) {
    if (found[flag] === void 0) throw new Error(`runner_flag_missing: ${flag}`);
  }
  return found;
}
async function main(argv, io) {
  try {
    const flags = parseMainArgv(argv);
    const args = JSON.parse(readFileSync2(flags["--args"][0], "utf8"));
    const config = JSON.parse(readFileSync2(flags["--config"][0], "utf8"));
    const runtime = readRuntimeConfig(config);
    const repoRoot = flags["--repo-root"][0];
    const runId = resolveRunId(args, currentTime());
    const bundleTiers = typeof config.models === "object" && config.models !== null ? config.models : {};
    const result = await runBundle({
      runId,
      bundlePath: flags["--bundle"][0],
      args,
      executor: selectExecutor(runtime, { repoRoot, runId }),
      shell: nodeShell,
      skillsDirs: flags["--skills-dir"],
      log: (line) => io.stderr(`${line}
`),
      runtime,
      repoRoot,
      bundleTiers
    });
    io.stdout(`${JSON.stringify(result ?? null)}
`);
    return 0;
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}
`);
    return 1;
  }
}
var { argv: processArgv, stdout: processStdout, stderr: processStderr } = process;
if (processArgv[1] !== void 0 && import.meta.url === pathToFileURL(resolve(processArgv[1])).href) {
  void main(processArgv.slice(2), {
    stdout: (text) => void processStdout.write(text),
    stderr: (text) => void processStderr.write(text)
  }).then((code) => {
    process.exitCode = code;
  });
}
export {
  SHELL_CONCURRENCY_KEY,
  main,
  resolveModel,
  runBundle
};
