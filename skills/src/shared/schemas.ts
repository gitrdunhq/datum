export const WRITE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    files_written: { type: 'array', items: { type: 'string' } },
    success: { type: 'boolean' },
    failure_reason: { type: 'string' },
  },
  required: ['success'],
} as const

export const STAGE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    files_written: { type: 'array', items: { type: 'string' } },
    success: { type: 'boolean' },
    tests_pass: { type: 'boolean' },
    test_exit_code: { type: 'number' },
    test_errors: { type: 'array', items: { type: 'string' } },
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    failure_reason: { type: 'string' },
  },
  required: ['success', 'tests_pass', 'committed'],
} as const

export const COMMIT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    files_staged: { type: 'array', items: { type: 'string' } },
    violations: { type: 'array', items: { type: 'string' } },
    failure_reason: { type: 'string' },
  },
  required: ['committed'],
} as const

export const REFLECT_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    score: { type: 'number' },
  },
  required: ['reasoning', 'score'],
} as const

export const SKEPTIC_SCHEMA = {
  type: 'object',
  properties: {
    bugs_found: { type: 'array', items: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        evidence: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      },
      required: ['description', 'evidence', 'severity'],
    }},
    confidence: { type: 'number' },
    verdict: { type: 'string', enum: ['PASS', 'FRAGILE', 'BROKEN'] },
  },
  required: ['bugs_found', 'confidence', 'verdict'],
} as const

export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: { type: 'string', enum: ['workflow-bug', 'lane-plan', 'agent-behavior', 'infrastructure', 'test-quality'] },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        body: { type: 'string' },
        lane: { type: 'string' },
        stage: { type: 'string' },
      },
      required: ['title', 'category', 'body'],
    }},
  },
  required: ['issues'],
} as const

export const VERIFY_STAGE_SCHEMA = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
    exit_code: { type: 'number' },
    error: { type: 'string' },
    test_signal: {
      type: 'object',
      properties: {
        exit_code: { type: 'number' },
        errors: { type: 'array', items: { type: 'string' } },
        assertion_messages: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['verified'],
} as const

export const REFACTOR_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    should_refactor: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['should_refactor'],
} as const
