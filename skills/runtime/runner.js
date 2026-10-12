// @generated — DO NOT EDIT. Source: skills/src/runtime/runner.ts
// skills/src/runtime/runner.ts
import { existsSync, readFileSync } from "node:fs";
import { join as join2, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
var RUNTIME_KINDS = ["fake", "pi"];
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
  return { kind, models, concurrency, priority, client };
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
function resolveRunId(args, start) {
  if (typeof args === "object" && args !== null) {
    const id = args.runId;
    if (typeof id === "string" && id !== "") return id;
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

// skills/src/runtime/shell.ts
import { spawn } from "node:child_process";
var nodeShell = (script, opts) => new Promise((resolve2, reject) => {
  const child = spawn("bash", ["-c", script], {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const finish = (fn) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn();
  };
  const timer = setTimeout(() => {
    finish(() => {
      try {
        if (child.pid !== void 0) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      reject(new Error(`shell timeout after ${opts.timeoutMs}ms`));
    });
  }, opts.timeoutMs);
  child.on("error", (err) => finish(() => reject(err)));
  child.on(
    "close",
    (code, signal) => finish(() => resolve2({ exit_code: code ?? (signal ? 128 : 1), stdout, stderr }))
  );
});

// skills/src/runtime/runner.ts
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
  const rootSource = stripMetaExport(readFileSync(bundlePath, "utf8"));
  setModelTiers(runtime.models);
  const runId = resolveRunId(args, currentTime());
  let spentTokens = 0;
  const addUsage = (u) => {
    if (u) spentTokens += u.prompt_tokens + u.completion_tokens;
  };
  const semaphores = createModelSemaphores(runtime.concurrency);
  const headers = { "X-Client": runtime.client, "X-Priority": runtime.priority };
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
    return fn(agent, parallel, pipeline, phase, log, workflow, shell, scriptArgs, budget);
  };
  const workflow = async (ref, childArgs) => {
    let path = ref.scriptPath;
    if (path === void 0) {
      const name = ref.name ?? "";
      path = opts.skillsDirs.map((dir) => join2(dir, `${name}.js`)).find((candidate) => existsSync(candidate));
      if (path === void 0) {
        throw new Error(`workflow_not_found: ${name} (searched: ${opts.skillsDirs.join(", ")})`);
      }
    }
    return execute(stripMetaExport(readFileSync(path, "utf8")), childArgs);
  };
  const g = globalThis;
  const saved = { shell: g.shell, args: g.args, hadShell: "shell" in g, hadArgs: "args" in g };
  g.datumRuntime = { agentTypes: true };
  g.shell = shell;
  g.args = args;
  try {
    return await execute(rootSource, args);
  } finally {
    delete g.datumRuntime;
    if (saved.hadShell) g.shell = saved.shell;
    else delete g.shell;
    if (saved.hadArgs) g.args = saved.args;
    else delete g.args;
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
    const args = JSON.parse(readFileSync(flags["--args"][0], "utf8"));
    const config = JSON.parse(readFileSync(flags["--config"][0], "utf8"));
    const runtime = readRuntimeConfig(config);
    const bundleTiers = typeof config.models === "object" && config.models !== null ? config.models : {};
    if (runtime.kind !== "fake") throw new Error(`runtime_kind_unsupported: ${runtime.kind}`);
    const result = await runBundle({
      bundlePath: flags["--bundle"][0],
      args,
      executor: new FakeExecutor([], { text: "{}" }),
      shell: nodeShell,
      skillsDirs: flags["--skills-dir"],
      log: (line) => io.stderr(`${line}
`),
      runtime,
      repoRoot: flags["--repo-root"][0],
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
  main,
  resolveModel,
  runBundle
};
