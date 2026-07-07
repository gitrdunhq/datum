// Pure utility functions for the datum TDD workflow pipeline.
// Every function here is deterministic and side-effect-free.

import type {
  LanePlan,
  Lane,
  LaneOutcome,
  PipelineConfig,
  TaskPacket,
  SkepticResult,
  SkepticLens,
} from './types'
import type { TddStage, Severity } from './models'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

export interface ContractEntry {
  function: string
  args: string[]
  returns: string | null
  raises: string | null
  ac: string
}

// ---------------------------------------------------------------------------
// buildWaves — Kahn's algorithm BFS wave grouping
// ---------------------------------------------------------------------------

export function buildWaves(lanePlan: LanePlan): string[][] {
  const lanes = lanePlan.lanes
  const ids = Object.keys(lanes)
  const inDeg: Record<string, number> = {}
  const adj: Record<string, string[]> = {}

  for (const id of ids) {
    const deps = lanes[id].depends_on || []
    for (const dep of deps) {
      if (!lanes[dep]) {
        throw new Error(
          `Task '${id}' depends on '${dep}', which does not exist in the lane plan`,
        )
      }
    }
    inDeg[id] = deps.length
    for (const dep of deps) {
      ;(adj[dep] = adj[dep] || []).push(id)
    }
  }

  const waves: string[][] = []
  let queue = ids.filter((id) => inDeg[id] === 0).sort()

  while (queue.length > 0) {
    waves.push([...queue])
    const next: string[] = []
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--
        if (inDeg[child] === 0) next.push(child)
      }
    }
    queue = next.sort()
  }

  const placed = new Set(waves.flat())
  const cyclic = ids.filter((id) => !placed.has(id))
  if (cyclic.length > 0) {
    throw new Error(
      `Cyclic dependency detected among tasks: ${cyclic.sort().join(', ')}`,
    )
  }

  return waves
}

// ---------------------------------------------------------------------------
// packWaves — partitions BFS waves into batches capped at maxBatch lanes.
//
// A real (>2-wave) lane plan is a chain of waves where every lane in wave
// k depends on something in an earlier wave. Spilling lanes across a wave
// boundary into a shared batch can therefore land a lane in the same batch
// as its own dependency, breaking the "dep must be in a strictly earlier
// batch" scheduling invariant. For that reason batches never merge lanes
// across more than two waves' worth of input: only a single wave is ever
// split across batches (when it alone exceeds maxBatch), and every other
// wave gets its own batch (or run of batches, if oversized).
//
// The permissive two-wave merge/spillover path below exists for callers
// that hand packWaves a bare, already-flattened pair of lane groups with
// no dependency relationship to respect (e.g. simple manual partitioning) —
// it preserves the tightest possible packing in that narrow case.
// ---------------------------------------------------------------------------

export function packWaves(waves: string[][], maxBatch: number): string[][] {
  if (waves.length <= 2) {
    return packWavesMerging(waves, maxBatch)
  }
  return packWavesStrict(waves, maxBatch)
}

// Greedy flatten-and-chunk: fills each batch to maxBatch, spilling lanes
// across a wave boundary if needed. Only safe when there are at most two
// waves, since it may otherwise place a lane in the same batch as its own
// dependency.
function packWavesMerging(waves: string[][], maxBatch: number): string[][] {
  const batches: string[][] = []
  let current: string[] = []

  for (const wave of waves) {
    let idx = 0
    while (idx < wave.length) {
      const remaining = maxBatch - current.length
      if (remaining <= 0) {
        batches.push(current)
        current = []
        continue
      }
      const take = Math.min(remaining, wave.length - idx)
      current.push(...wave.slice(idx, idx + take))
      idx += take
    }
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

// Each wave gets its own batch (or, if it alone exceeds maxBatch, a run of
// consecutive batches). Waves are never merged with each other, so a lane
// can never share a batch with a lane from a different wave — guaranteeing
// every dependency (which always lives in a strictly earlier wave) ends up
// in a strictly earlier batch.
function packWavesStrict(waves: string[][], maxBatch: number): string[][] {
  const batches: string[][] = []

  for (const wave of waves) {
    let idx = 0
    while (idx < wave.length) {
      const take = Math.min(maxBatch, wave.length - idx)
      batches.push(wave.slice(idx, idx + take))
      idx += take
    }
  }

  return batches
}

// ---------------------------------------------------------------------------
// computeBlockedLanes — propagates upstream failures to dependent lanes so
// they are reported as blocked/SKIPPED instead of being dispatched.
// ---------------------------------------------------------------------------

export function computeBlockedLanes(
  lanePlan: LanePlan,
  laneIds: string[],
  _completed: string[],
  failures: string[],
  results: Record<string, LaneOutcome>,
): Record<string, LaneOutcome> {
  const failedSet = new Set(failures)
  const blocked: Record<string, LaneOutcome> = {}

  let changed = true
  while (changed) {
    changed = false
    for (const id of laneIds) {
      if (blocked[id]) continue
      const lane = lanePlan.lanes[id]
      if (!lane) continue

      for (const dep of lane.depends_on || []) {
        if (failedSet.has(dep)) {
          const depResult = results[dep]
          const stage = depResult?.stage || 'unknown stage'
          blocked[id] = {
            task_id: id,
            status: 'blocked',
            stage: 'SKIPPED',
            error: `blocked: upstream dependency '${dep}' failed at stage ${stage}`,
          }
          changed = true
          break
        }
        if (blocked[dep]) {
          blocked[id] = {
            task_id: id,
            status: 'blocked',
            stage: 'SKIPPED',
            error: `blocked: upstream dependency '${dep}' is blocked (${blocked[dep].error})`,
          }
          changed = true
          break
        }
      }
    }
  }

  return blocked
}

// ---------------------------------------------------------------------------
// groupBlockedByRoot — groups transitively blocked lanes under every failed
// root they trace back to (a diamond-dependency lane can appear under more
// than one root's group — triage is for human diagnosis, so showing every
// causal path is more useful than picking one arbitrarily).
// ---------------------------------------------------------------------------

export function groupBlockedByRoot(
  lanePlan: LanePlan,
  failures: string[],
  blockedIds: string[],
): Record<string, string[]> {
  const failedSet = new Set(failures)
  const groups: Record<string, Set<string>> = {}
  for (const f of failures) groups[f] = new Set()

  for (const bid of blockedIds) {
    const seen = new Set<string>()
    const queue: string[] = [...(lanePlan.lanes[bid]?.depends_on || [])]
    const roots = new Set<string>()

    while (queue.length > 0) {
      const cur = queue.shift() as string
      if (seen.has(cur)) continue
      seen.add(cur)
      if (failedSet.has(cur)) {
        roots.add(cur)
        continue
      }
      queue.push(...(lanePlan.lanes[cur]?.depends_on || []))
    }

    for (const r of roots) {
      if (!groups[r]) groups[r] = new Set()
      groups[r].add(bid)
    }
  }

  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(groups)) out[k] = [...v].sort()
  return out
}

// ---------------------------------------------------------------------------
// filterGreenLanes — GREEN merge gate. A completed-lane id whose recorded
// stage is 'RED' never reaches the squash-merge step, even if some upstream
// caller mistakenly marked it 'completed' — it's reported and left in place.
// ---------------------------------------------------------------------------

export function filterGreenLanes(
  completedIds: string[],
  results: Record<string, LaneOutcome>,
): { greenIds: string[]; redOnlyIds: string[] } {
  const greenIds = completedIds.filter((id) => results?.[id]?.stage !== 'RED')
  const redOnlyIds = completedIds.filter((id) => results?.[id]?.stage === 'RED')
  return { greenIds, redOnlyIds }
}

// ---------------------------------------------------------------------------
// fnv1a64 / laneSpecHash — content-addressed lane identity for epic-scoped
// completion markers. The sandbox has no crypto module, so we use FNV-1a
// (64-bit, BigInt) — collision resistance is not a security property here,
// only change detection on a handful of lane specs.
// ---------------------------------------------------------------------------

// Filesystem-safe slug for an epic branch name, used as the directory key
// under .datum/epics/. "datum/epic-287" → "datum-epic-287".
export function epicSlug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]/g, '-')
}

export function fnv1a64(input: string): string {
  const PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * PRIME) & MASK
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

// Hash of the fields that define WHAT a lane does. title/red_note/model hints
// are presentation — editing them must not invalidate a completed lane.
export function laneSpecHash(lane: Pick<Lane, 'files' | 'acceptance_criteria' | 'depends_on'>): string {
  const spec = {
    files: lane.files || [],
    acceptance_criteria: lane.acceptance_criteria || [],
    depends_on: lane.depends_on || [],
  }
  return fnv1a64(JSON.stringify(spec))
}

// ---------------------------------------------------------------------------
// classifyFiles — separates test files from implementation files
// ---------------------------------------------------------------------------

export function classifyFiles(files: string[]): {
  testFiles: string[]
  implFiles: string[]
} {
  // Files in support directories are impl-adjacent even when under /Tests/
  const isImplAdjacent = (f: string): boolean => {
    return (
      f.includes('/Mocks/') ||
      f.includes('/mocks/') ||
      f.includes('/Fakes/') ||
      f.includes('/fakes/') ||
      f.includes('/Stubs/') ||
      f.includes('/stubs/') ||
      f.includes('/Fixtures/') ||
      f.includes('/fixtures/') ||
      f.includes('/Helpers/') ||
      f.includes('/helpers/')
    )
  }
  const isTest = (f: string): boolean => {
    if (isImplAdjacent(f)) return false
    const base = f.split('/').pop() || ''
    return (
      base.startsWith('test_') ||
      base.endsWith('_test.py') ||
      base.endsWith('.test.ts') ||
      base.endsWith('.test.js') ||
      base.endsWith('.spec.ts') ||
      base.endsWith('.spec.js') ||
      base.endsWith('_test.go') ||
      base.endsWith('Tests.swift') ||
      f.includes('/tests/') ||
      f.includes('/Tests/') ||
      base === 'conftest.py'
    )
  }
  const testFiles = (files || []).filter(isTest)
  const implFiles = (files || []).filter((f) => !isTest(f))
  return { testFiles, implFiles }
}

// ---------------------------------------------------------------------------
// resolveLanePlanPath — prefer lane-plan-final.json over lane-plan.json
// ---------------------------------------------------------------------------

export function resolveLanePlanPrompt(epicDir: string): string {
  return (
    `[${epicDir}]\n` +
    `ls "${epicDir}/lane-plan-final.json" 2>/dev/null && echo "final" || echo "default"` +
    `\nReturn ONLY: "final" if lane-plan-final.json exists, "default" if only lane-plan.json exists, or "none" if neither exists.`
  )
}

export function resolveLanePlanPath(epicDir: string, agentResult: string): string {
  const resolved = agentResult.trim()
  if (resolved === 'final') return `${epicDir}/lane-plan-final.json`
  if (resolved === 'default') return `${epicDir}/lane-plan.json`
  throw new Error(`No lane-plan.json found — tried: ${epicDir}/lane-plan-final.json, ${epicDir}/lane-plan.json`)
}

// ---------------------------------------------------------------------------
// parseAgentJson — extracts JSON from agent text output
// ---------------------------------------------------------------------------

export function parseAgentJson<T = unknown>(text: string, fallback: T): T {
  if (!text || typeof text !== 'string') return fallback
  const cleaned = text.replace(/```[a-z]*\n?/g, '').trim()
  const start = cleaned.search(/[{[]/)
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (start === -1 || end === -1) return fallback
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// laneCtxCmd — builds a shell command that writes lane-context.json
// ---------------------------------------------------------------------------

export function laneCtxCmd(packet: TaskPacket, wt: string): string {
  const ctx = JSON.stringify({
    task_id: packet.task_id,
    stage: packet.stage,
    allowed_write_files: packet.allowed_write_files,
    forbidden_write_files: packet.forbidden_write_files,
    commit_prefix: packet.commit_prefix,
    test_count_floor: 0,
  })
  return `mkdir -p "${wt}/.datum" && printf '%s' '${ctx.replace(/'/g, "'\\''")}' > "${wt}/.datum/lane-context.json"`
}

// ---------------------------------------------------------------------------
// extractContractSummary — extracts function signatures from AC text
// ---------------------------------------------------------------------------

const BUILTIN_SKIP = new Set([
  // Python
  'print',
  'len',
  'str',
  'int',
  'dict',
  'list',
  'set',
  'isinstance',
  'type',
  'exit',
  'round',
  'sorted',
  'filter',
  'map',
  'any',
  'all',
  'range',
  'enumerate',
  'zip',
  'open',
  'input',
  'format',
  'repr',
  'hash',
  'id',
  'dir',
  'vars',
  'super',
  'property',
  'staticmethod',
  'classmethod',
  // Swift
  'fatalError',
  'precondition',
  'debugPrint',
  'String',
  'Int',
  'Array',
  'Dictionary',
  'Bool',
  'Optional',
  // Go
  'fmt',
  'Println',
  'Printf',
  'Sprintf',
  'make',
  'append',
  'delete',
  'panic',
  'recover',
  // TypeScript / JavaScript
  'console',
  'log',
  'parseInt',
  'parseFloat',
  'Number',
  'Object',
  'Boolean',
  'Promise',
  'setTimeout',
  'JSON',
])

export function extractContractSummary(
  acceptanceCriteria: string[],
): ContractEntry[] {
  return (acceptanceCriteria || [])
    .map((ac): ContractEntry | null => {
      const funcMatch = ac.match(/(?<!['"-])(\w+)\(([^)]*)\)/)
      const retMatch = ac.match(/returns?\s+(?:a\s+)?(\w+)/i)
      const raiseMatch = ac.match(/[Rr]aises?\s+(\w+Error|\w+Exception)/)
      if (!funcMatch || BUILTIN_SKIP.has(funcMatch[1])) return null
      return {
        function: funcMatch[1],
        args: funcMatch[2]
          ? funcMatch[2]
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean)
          : [],
        returns: retMatch ? retMatch[1] : null,
        raises: raiseMatch ? raiseMatch[1] : null,
        ac: ac.slice(0, 120),
      }
    })
    .filter((entry): entry is ContractEntry => entry !== null)
}

// ---------------------------------------------------------------------------
// crossValidateBugs — cross-validates bugs across skeptic lenses
// ---------------------------------------------------------------------------

interface CrossValidatedBug {
  description: string
  evidence: string
  severity: Severity
  lens: string
}

export function crossValidateBugs(
  skepticResults: (SkepticResult | null)[],
  lenses: SkepticLens[],
): {
  allBugs: CrossValidatedBug[]
  brokenCount: number
  crossValidated: CrossValidatedBug[]
} {
  const allBugs: CrossValidatedBug[] = []
  let brokenCount = 0

  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i]
    if (!s) continue
    if (s.verdict === 'BROKEN') brokenCount++
    for (const bug of s.bugs_found || []) {
      allBugs.push({ ...bug, lens: lenses[i].key })
    }
  }

  const bugDescs = allBugs.map((b) => b.description.toLowerCase().slice(0, 60))
  const crossValidated = allBugs.filter((_bug, idx) => {
    const myDesc = bugDescs[idx]
    return bugDescs.some((d, j) => j !== idx && d === myDesc)
  })

  return { allBugs, brokenCount, crossValidated }
}

// ---------------------------------------------------------------------------
// buildPacket — builds a JSON packet for TDD agents
// ---------------------------------------------------------------------------

export function buildPacket(
  taskId: string,
  testFiles: string[],
  implFiles: string[],
  lane: Lane,
  wt: string,
  cfg: PipelineConfig,
  stage: TddStage,
  extras: Record<string, unknown> = {},
): TaskPacket {
  return {
    schema_version: '1.0',
    task_id: taskId,
    stage: stage as TaskPacket['stage'],
    title: lane.title,
    working_directory: wt,
    test_command: cfg.testCommand,
    acceptance_criteria: lane.acceptance_criteria || [],
    red_note: lane.red_note || '',
    allowed_write_files:
      stage === 'RED'
        ? testFiles
        : stage === 'GREEN'
          ? implFiles
          : [...testFiles, ...implFiles],
    forbidden_write_files:
      stage === 'RED'
        ? implFiles
        : stage === 'GREEN'
          ? testFiles
          : [],
    commit_prefix:
      stage === 'RED'
        ? `red(${taskId})`
        : stage === 'GREEN'
          ? `green(${taskId})`
          : `refactor(${taskId})`,
    ...(cfg.test_framework ? { test_framework: cfg.test_framework } : {}),
    ...extras,
  }
}

// ---------------------------------------------------------------------------
// renderPrompt — replaces {{key}} placeholders with values
// ---------------------------------------------------------------------------

export function renderPrompt(
  template: string,
  vars: { [key: string]: string },
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => (vars as Record<string, string>)[key] ?? `{{${key}}}`,
  )
}
