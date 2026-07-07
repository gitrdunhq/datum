// Pure utility functions for the datum TDD workflow pipeline.
// Every function here is deterministic and side-effect-free.

import type {
  LanePlan,
  Lane,
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
