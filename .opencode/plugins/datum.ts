// OpenCode plugin: datum — wraps datum CLI as typed OpenCode tools.
// SDK: @opencode-ai/plugin@1.17.5

import { tool, type Plugin, type PluginModule, type ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runDatum(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile("datum", [command, ...args], { cwd }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error ? (child.exitCode ?? -2) : 0,
      });
    });
  });
}

function checkDatumDir(cwd: string): string | null {
  if (existsSync(join(cwd, ".datum"))) return null;
  return formatError(-1, "No .datum/ directory. Run datum_init first.");
}

function formatResult(data: unknown): string {
  return `{"ok":true,"data":${JSON.stringify(data)}}`;
}

function formatError(code: number, message: string): string {
  return `{"error":true,"code":${code},"message":${JSON.stringify(message)}}`;
}

function readDatumState(dir: string): {
  phase?: string;
  run_id?: string;
  epic_branch?: string;
  last_gate_result?: unknown;
} | null {
  try {
    const stateFile = join(dir, ".datum", "state.json");
    if (!existsSync(stateFile)) return null;
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function dir(args: { cwd?: string }, ctx: ToolContext): string {
  return args.cwd ?? ctx.directory;
}

// ---------------------------------------------------------------------------
// Headroom MCP client — persistent subprocess for context compression
// ---------------------------------------------------------------------------

const HEADROOM_BIN = "/Users/samfakhreddine/.local/bin/headroom";
const COMPRESS_THRESHOLD = 8000;
const HEADROOM_TIMEOUT = 10_000;
const SKIP_TOOLS = new Set(["mcp__headroom__headroom_compress", "mcp__headroom__headroom_retrieve", "mcp__headroom__headroom_stats"]);

type RpcCallback = { resolve: (v: unknown) => void; reject: (e: Error) => void };

class HeadroomMCP {
  private proc: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private rpcId = 0;
  private pending = new Map<number, RpcCallback>();
  private buf = "";

  async init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.spawn();
    return this.ready;
  }

  private spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(HEADROOM_BIN, ["mcp", "serve"], {
        stdio: ["pipe", "pipe", "ignore"],
      });

      this.proc.stdout!.on("data", (chunk: Buffer) => {
        this.buf += chunk.toString();
        this.drain();
      });

      this.proc.on("error", (err) => {
        this.ready = null;
        this.proc = null;
        reject(err);
      });

      this.proc.on("exit", () => {
        this.ready = null;
        this.proc = null;
        for (const cb of this.pending.values()) cb.reject(new Error("headroom exited"));
        this.pending.clear();
      });

      const id = ++this.rpcId;
      this.pending.set(id, {
        resolve: () => {
          this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
          resolve();
        },
        reject,
      });
      this.send({
        jsonrpc: "2.0", id, method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "datum-plugin", version: "1.0.0" },
        },
      });
    });
  }

  private send(msg: unknown): void {
    this.proc?.stdin?.write(JSON.stringify(msg) + "\n");
  }

  private drain(): void {
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const cb = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      } catch { /* ignore malformed lines */ }
    }
  }

  async compress(content: string): Promise<string> {
    await this.init();
    const id = ++this.rpcId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("headroom compress timeout"));
      }, HEADROOM_TIMEOUT);

      this.pending.set(id, {
        resolve: (result: unknown) => {
          clearTimeout(timer);
          const r = result as { content?: Array<{ text?: string }> } | undefined;
          resolve(r?.content?.[0]?.text ?? content);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.send({
        jsonrpc: "2.0", id, method: "tools/call",
        params: { name: "headroom_compress", arguments: { content } },
      });
    });
  }

  kill(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this.ready = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const datum_status = tool({
  description: "Run datum status --json. Returns pipeline state, phase, run ID.",
  args: { cwd: z.string().optional() },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const { stdout, stderr, exitCode } = await runDatum("status", ["--json"], cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    try {
      return formatResult(JSON.parse(stdout));
    } catch {
      return formatError(-3, "Failed to parse datum output: " + stdout);
    }
  },
});

const datum_init = tool({
  description: "Run datum init --epic <name> [--description <desc>].",
  args: {
    epic: z.string().describe("Epic branch name"),
    description: z.string().optional().describe("Optional epic description"),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const cmdArgs = ["--epic", args.epic];
    if (args.description) cmdArgs.push("--description", args.description);
    const { stdout, stderr, exitCode } = await runDatum("init", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const datum_classify = tool({
  description: "Run datum classify. Returns tier, signals, pipeline_shape.",
  args: { cwd: z.string().optional() },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const { stdout, stderr, exitCode } = await runDatum("classify", [], cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    try {
      const parsed = JSON.parse(stdout);
      return formatResult({
        tier: parsed.tier,
        signals: parsed.signals,
        pipeline_shape: parsed.pipeline_shape,
      });
    } catch {
      return formatError(-3, "Failed to parse classify output: " + stdout);
    }
  },
});

const datum_lane_plan = tool({
  description: "Run datum lane-plan. Builds lane-plan.json from tasks.",
  args: { cwd: z.string().optional() },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const { stdout, stderr, exitCode } = await runDatum("lane-plan", [], cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const PHASE_ENUM = z.enum([
  "refine", "plan", "properties", "act", "validate", "review", "closeout",
]);

const datum_gate = tool({
  description: "Run datum gate <phase> [--approve]. Exit codes: 0=pass, 1=fail, 2=hard-stop.",
  args: {
    phase: PHASE_ENUM,
    approve: z.boolean().optional().describe("Pass --approve flag"),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const cmdArgs = ["-m", "datum.gate", args.phase];
    if (args.approve) cmdArgs.push("--approve");
    const result = await new Promise<{
      stdout: string; stderr: string; exitCode: number;
    }>((resolve) => {
      const child = execFile("python", cmdArgs, { cwd }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? (child.exitCode ?? -2) : 0,
        });
      });
    });
    if (result.exitCode === 0) {
      return formatResult({ passed: true, hard_stop: false, message: result.stdout.trim() });
    }
    if (result.exitCode === 2) {
      return formatError(2, result.stdout.trim() || result.stderr.trim());
    }
    return formatError(result.exitCode, result.stderr || result.stdout);
  },
});

const datum_skeleton = tool({
  description: "Run datum skeleton --task-id <id> --language <lang> [--batch --output-dir <dir>].",
  args: {
    task_id: z.string().optional(),
    language: z.string(),
    tasks: z.string().optional().describe("Path to lane-plan.json"),
    batch: z.boolean().optional().describe("Process all tasks at once"),
    output_dir: z.string().optional().describe("Output directory for batch mode"),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const cmdArgs = ["--language", args.language];
    if (args.tasks) cmdArgs.push("--tasks", args.tasks);
    if (args.batch) {
      cmdArgs.push("--batch");
      if (args.output_dir) cmdArgs.push("--output-dir", args.output_dir);
    } else if (args.task_id) {
      cmdArgs.push("--task-id", args.task_id);
    }
    const { stdout, stderr, exitCode } = await runDatum("skeleton", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const datum_verify = tool({
  description: "Run datum verify-stage <stage> where stage is red, green, baseline.",
  args: {
    stage: z.enum(["red", "green", "baseline"]),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const { stdout, stderr, exitCode } = await runDatum("verify-stage", [args.stage], cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    try {
      return formatResult(JSON.parse(stdout));
    } catch {
      return formatResult({ message: stdout.trim() });
    }
  },
});

const datum_commit_queue = tool({
  description: "Run datum commit-queue. Supports one-shot (apply_patch) and server (socket) modes.",
  args: {
    apply_patch: z.string().optional().describe("Path to patch file for one-shot mode"),
    socket: z.string().optional().describe("Socket path for server mode"),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const cmdArgs: string[] = [];
    if (args.apply_patch) cmdArgs.push("--apply-patch", args.apply_patch);
    else if (args.socket) cmdArgs.push("--socket", args.socket);
    const { stdout, stderr, exitCode } = await runDatum("commit-queue", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const datum_issue_comment = tool({
  description: "Run datum issue-comment --issue <id> --body-file <path>.",
  args: {
    issue: z.string(),
    body_file: z.string(),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const { stdout, stderr, exitCode } = await runDatum(
      "issue-comment", ["--issue", args.issue, "--body-file", args.body_file], cwd,
    );
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const datum_bugfile = tool({
  description: "Run datum bugfile <module> <message> [--trace <trace>].",
  args: {
    module: z.string(),
    message: z.string(),
    trace: z.string().optional(),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const cmdArgs = [args.module, args.message];
    if (args.trace) cmdArgs.push("--trace", args.trace);
    const { stdout, stderr, exitCode } = await runDatum("bugfile", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    try {
      return formatResult(JSON.parse(stdout));
    } catch {
      return formatResult({ message: stdout.trim() });
    }
  },
});

const datum_worktree = tool({
  description: "Run datum worktrees <action> where action is setup, merge, cleanup.",
  args: {
    action: z.enum(["setup", "merge", "cleanup"]),
    run_id: z.string().optional(),
    epic_branch: z.string().optional(),
    lane_ids: z.string().optional(),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const cmdArgs: string[] = [args.action];
    if (args.run_id) cmdArgs.push("--run-id", args.run_id);
    if (args.epic_branch) cmdArgs.push("--epic-branch", args.epic_branch);
    if (args.lane_ids) cmdArgs.push("--lane-ids", args.lane_ids);
    const { stdout, stderr, exitCode } = await runDatum("worktrees", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const datum_review = tool({
  description: "Run datum review [--json].",
  args: { cwd: z.string().optional() },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const { stdout, stderr, exitCode } = await runDatum("review", ["--json"], cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    try {
      return formatResult(JSON.parse(stdout));
    } catch {
      return formatResult({ message: stdout.trim() });
    }
  },
});

const datum_closeout = tool({
  description: "Run datum closeout [--force].",
  args: {
    force: z.boolean().optional(),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const cmdArgs: string[] = [];
    if (args.force) cmdArgs.push("--force");
    const { stdout, stderr, exitCode } = await runDatum("closeout", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    return formatResult({ message: stdout.trim() });
  },
});

const datum_tdd_args = tool({
  description: "Run datum tdd-args --task-id <id> [--language <lang>].",
  args: {
    task_id: z.string(),
    language: z.string().optional(),
    cwd: z.string().optional(),
  },
  execute: async (args, ctx) => {
    const cwd = dir(args, ctx);
    const guard = checkDatumDir(cwd);
    if (guard !== null) return guard;
    const cmdArgs = ["--task-id", args.task_id];
    if (args.language) cmdArgs.push("--language", args.language);
    const { stdout, stderr, exitCode } = await runDatum("tdd-args", cmdArgs, cwd);
    if (exitCode !== 0) return formatError(exitCode, stderr || stdout);
    try {
      return formatResult(JSON.parse(stdout));
    } catch {
      return formatResult({ message: stdout.trim() });
    }
  },
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const server: Plugin = async (input) => {
  const headroom = new HeadroomMCP();

  return {
  dispose: async () => { headroom.kill(); },

  tool: {
    datum_status,
    datum_init,
    datum_classify,
    datum_lane_plan,
    datum_gate,
    datum_skeleton,
    datum_verify,
    datum_commit_queue,
    datum_issue_comment,
    datum_bugfile,
    datum_worktree,
    datum_review,
    datum_closeout,
    datum_tdd_args,
  },

  "experimental.chat.system.transform": async (_input, output) => {
    const state = readDatumState(input.directory);
    if (state) {
      output.system.push(
        `[datum] phase=${state.phase ?? "?"} run_id=${state.run_id ?? "?"} branch=${state.epic_branch ?? "?"}`,
      );
    }
  },

  "experimental.provider.small_model": async (providerInput, output) => {
    if (providerInput.provider.id === "omlx") {
      output.model = { id: "mlx-community--gemma-4-E4B-it-qat-4bit" } as any;
    }
  },

  "experimental.session.compacting": async (_input, output) => {
    const state = readDatumState(input.directory);
    if (state) {
      output.context.push(
        `datum: phase=${state.phase ?? "?"} run_id=${state.run_id ?? "?"} last_gate=${JSON.stringify(state.last_gate_result ?? null)}`,
      );
    }
  },

  "tool.execute.after": async (inp, output) => {
    if (output.output.length < COMPRESS_THRESHOLD) return;
    if (SKIP_TOOLS.has(inp.tool)) return;
    try {
      output.output = await headroom.compress(output.output);
    } catch {
      // headroom unavailable — leave output as-is
    }
  },
};
};

export default { server } satisfies PluginModule;
