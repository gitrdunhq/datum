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
  // read_witness is required: a structured answer drops optional fields
  // (#341 task-011 twice, the #516 probes: 7 of 9 answers omitted it) and the
  // runner reads it. A stage with nothing deferred returns {}.
  required: ['success', 'tests_pass', 'committed', 'read_witness'],
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
  required: ['reasoning', 'score', 'read_witness'],
} as const

// Review lens result. A schema, not a "return raw JSON" instruction: the
// correctness lens answered in markdown and Review halted on a strict parse
// with no retry (elonchesd wf_22ad6b36-dec). StructuredOutput validates at
// the tool layer and the model retries on mismatch.
export const REVIEW_LENS_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          description: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['id', 'severity', 'file', 'description'],
      },
    },
  },
  required: ['domain', 'findings'],
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
  required: ['bugs_found', 'confidence', 'verdict', 'read_witness'],
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

// Validate's one substantive agent call. A schema for the same reason
// REVIEW_LENS_SCHEMA is one (see above): it was the last LLM call in the
// pipeline still answering a prose "return raw JSON only" instruction
// through parseAgentJson's fallback. Every field here has a reader in
// datum-validate.ts; the retired `committed_fixes`/`commit_sha` asked for a
// receipt for a commit no step instructs.
export const VALIDATE_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    tests_pass: { type: 'boolean' },
    test_count: { type: 'number' },
    lint_clean: { type: 'boolean' },
    lint_fixes: { type: 'array', items: { type: 'string' } },
    ac_gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['tests_pass', 'test_count', 'lint_clean', 'lint_fixes', 'ac_gaps'],
} as const

export const REFACTOR_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    should_refactor: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['should_refactor'],
} as const
