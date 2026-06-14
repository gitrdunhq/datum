export const meta = {
  name: 'datum-go',
  description: 'Full pipeline: TICKET → SPEC → Plan → Properties → Act → Validate → Review → Closeout',
  phases: [],
}

// ── Parse args ──

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})

const yolo: boolean = !!a.yolo
const startFrom: string = (a.startFrom || 'refine').toLowerCase()

const PHASE_ORDER = ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout']
const startIdx = PHASE_ORDER.indexOf(startFrom)
if (startIdx === -1) {
  throw new Error(`Unknown phase: ${startFrom}. Valid: ${PHASE_ORDER.join(', ')}`)
}

log(`datum go — starting from ${startFrom}${yolo ? ' (yolo mode)' : ''}`)

// ── Pipeline ──

interface PhaseResult {
  gatePassed?: boolean
  gateMessage?: string
  testsPassed?: boolean
  criticalFindings?: number
  canMerge?: boolean
  completed?: number
  failed?: number
  failedLanes?: string[]
  taskCount?: number
  [key: string]: unknown
}

let lastResult: PhaseResult = {}
let haltedAt = ''

// Refine
if (!haltedAt && startIdx <= 0) {
  log('── Refine ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-refine.js' }, yolo ? 'yolo' : {}) as PhaseResult
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = 'refine'
    log(`Refine gate held: ${lastResult.gateMessage || 'needs review'}. Address QUESTIONS.md, then: datum go --start-from plan`)
  } else {
    log('Refine complete')
  }
}

// Plan
if (!haltedAt && startIdx <= 1) {
  log('── Plan ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-plan.js' }, yolo ? 'yolo' : {}) as PhaseResult
  if (!lastResult.gatePassed) {
    haltedAt = 'plan'
    log(`Plan gate held: ${lastResult.gateMessage || 'needs approval'}. Review TASKS.md, then: datum go --start-from properties`)
  } else {
    log(`Plan complete — ${lastResult.taskCount || '?'} tasks`)
  }
}

// Properties
if (!haltedAt && startIdx <= 2) {
  log('── Properties ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-properties.js' }, yolo ? 'yolo' : {}) as PhaseResult
  log('Properties complete')
}

// Act
if (!haltedAt && startIdx <= 3) {
  log('── Act ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-tdd-act.js' }, yolo ? 'yolo' : {}) as PhaseResult
  log(`Act complete — ${lastResult.completed || 0} succeeded, ${lastResult.failed || 0} failed`)
  if ((lastResult.failed || 0) > 0) {
    log(`Failed lanes: ${(lastResult.failedLanes || []).join(', ')}`)
  }
}

// Validate
if (!haltedAt && startIdx <= 4) {
  log('── Validate ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-validate.js' }, yolo ? 'yolo' : {}) as PhaseResult
  if (!lastResult.testsPassed) {
    haltedAt = 'validate'
    log('Validate FAILED — tests are red. Pipeline halted.')
  } else {
    log('Validate complete')
  }
}

// Review
if (!haltedAt && startIdx <= 5) {
  log('── Review ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-review.js' }, yolo ? 'yolo' : {}) as PhaseResult
  if (!lastResult.canMerge) {
    haltedAt = 'review'
    log(`Review: ${lastResult.criticalFindings || '?'} critical issues. Fix, then: datum go --start-from validate`)
  } else {
    log('Review complete — clear to merge')
  }
}

// Closeout
if (!haltedAt && startIdx <= 6) {
  log('── Closeout ──')
  lastResult = await workflow({ scriptPath: 'skills/datum-closeout.js' }, yolo ? 'yolo' : {}) as PhaseResult
  log('Closeout complete')
}

if (haltedAt) {
  log(`\nPipeline halted at ${haltedAt}. Resume with: datum go --start-from <next-phase>`)
} else {
  log('\n' + '='.repeat(60))
  log('DATUM GO COMPLETE')
  log('='.repeat(60))
}

export const __workflowResult = {
  phase: haltedAt || 'complete',
  halted: !!haltedAt,
  ...lastResult,
}
