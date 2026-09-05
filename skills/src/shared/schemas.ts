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
    test_output: { type: 'string' },
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    failure_reason: { type: 'string' },
    // #356: structured GREEN block — {status:"blocked", needs_write:[paths], reason}
    status: { type: 'string', enum: ['ok', 'blocked'] },
    needs_write: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    // Blob-sha prefix of every deferred file the agent was told to read (assertReadWitness).
    read_witness: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: ['success', 'tests_pass', 'committed'],
} as const

export const REFLECT_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    score: { type: 'number' },
    // Blob-sha prefix of every deferred file the agent was told to read (assertReadWitness).
    read_witness: { type: 'object', additionalProperties: { type: 'string' } },
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
    // Blob-sha prefix of every deferred file the agent was told to read (assertReadWitness).
    read_witness: { type: 'object', additionalProperties: { type: 'string' } },
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

export const REFACTOR_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    should_refactor: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['should_refactor'],
} as const
