// agent-types.ts — one table mapping pipeline stage kinds to the custom
// subagent definitions in agents/datum-*.md (#368).
//
// Every agent() call in the lane/setup/merge/docs scripts goes through
// stageOpts() so the mapping lives in exactly one place. The `agent_types`
// config switch (default true) turns the whole thing off for runtimes that
// have no agentType support (the OpenAI-compatible workflow runtime);
// `hooks_installed` (written by `datum init`, default false) reports whether
// the PreToolUse hooks the datum-red/green/refactor definitions reference
// are actually materialised in the consumer repo.
//
// Pure module state — no sandbox globals — so vitest covers it directly.
// Each compiled workflow bundle carries its own copy of this state, so every
// script must call configureAgentTypes() from its own config/args.
// tested-by: skills/src/shared/agent-types.test.ts

export type StageKind =
  | 'red'
  | 'green'
  | 'refactor'
  | 'skeptic'
  | 'reflect'
  | 'docs'
  | 'reader'
  | 'cli'

export const AGENT_TYPE_TABLE: Readonly<Record<StageKind, string>> = {
  red: 'datum-red',
  green: 'datum-green',
  refactor: 'datum-refactor',
  skeptic: 'datum-skeptic',
  reflect: 'datum-reflect',
  docs: 'datum-docs',
  reader: 'datum-reader',
  cli: 'datum-cli',
}

export interface AgentTypeConfig {
  agentTypes: boolean
  hooksInstalled: boolean
}

const state: AgentTypeConfig = { agentTypes: true, hooksInstalled: false }

/** Read the two switches out of a raw .datum/config.json object. */
export function readAgentTypeConfig(cfg: unknown): AgentTypeConfig {
  const o = (cfg && typeof cfg === 'object' ? cfg : {}) as Record<string, unknown>
  return {
    agentTypes: o.agent_types !== false,
    hooksInstalled: o.hooks_installed === true,
  }
}

export function configureAgentTypes(opts: Partial<AgentTypeConfig>): void {
  if (typeof opts.agentTypes === 'boolean') state.agentTypes = opts.agentTypes
  if (typeof opts.hooksInstalled === 'boolean') state.hooksInstalled = opts.hooksInstalled
}

export function agentTypesEnabled(): boolean {
  return state.agentTypes
}

export function hooksInstalled(): boolean {
  return state.hooksInstalled
}

/**
 * True when the deterministic PreToolUse hooks (lane-file-guard,
 * protect-tests) are both installed AND the agentType that carries them is
 * actually being passed — only then may the LLM ownership/completion checks
 * be replaced by a plain `git diff` evaluated in the script (#368 item D).
 */
export function deterministicChecks(): boolean {
  return state.agentTypes && state.hooksInstalled
}

/** Build agent() opts for a stage: `extra` plus the table's agentType (when enabled). */
export function stageOpts<T extends AgentOpts>(stage: StageKind, extra: T = {} as T): T & { agentType?: string } {
  if (!state.agentTypes) return { ...extra }
  return { ...extra, agentType: AGENT_TYPE_TABLE[stage] }
}

/** Current config as a plain object, for passing to child workflows via args. */
export function agentTypeArgs(): AgentTypeConfig {
  return { ...state }
}
