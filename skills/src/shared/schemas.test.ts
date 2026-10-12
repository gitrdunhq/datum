// #341 wf_d125a570-0a2 task-011 (twice) and the #516 probes: a structured
// answer drops optional fields. read_witness is optional in the schema, the
// runner reads it, and RED failed context_read_unverified with seven verified
// failing tests on disk. Every field a runner reads is required; a stage with
// nothing deferred returns an empty object.

import { describe, it, expect } from 'vitest'
import * as schemas from './schemas'

describe('every schema that declares read_witness requires it', () => {
  const declaring = Object.entries(schemas).filter(([, s]) => {
    const props = (s as { properties?: Record<string, unknown> }).properties
    return props !== undefined && 'read_witness' in props
  })

  it('finds the stage, reflect and skeptic schemas', () => {
    expect(declaring.map(([name]) => name).sort()).toEqual(['REFLECT_SCHEMA', 'SKEPTIC_SCHEMA', 'STAGE_RESULT_SCHEMA'])
  })

  it.each(declaring.map(([name, s]) => [name, s] as const))('%s lists read_witness in required', (_name, s) => {
    expect((s as { required: readonly string[] }).required).toContain('read_witness')
  })
})

// DAT-14 AC1/AC9: the stage result schema requires every field the runner and
// the lanes read, and types the two new ones.
describe('STAGE_RESULT_SCHEMA required fields and property types', () => {
  it('AC1: required lists the six fields in order', () => {
    expect([...schemas.STAGE_RESULT_SCHEMA.required]).toEqual([
      'success',
      'tests_pass',
      'committed',
      'read_witness',
      'files_written',
      'test_exit_code',
    ])
  })

  it('AC1: files_written is an array and test_exit_code is an integer', () => {
    expect(schemas.STAGE_RESULT_SCHEMA.properties.files_written.type).toBe('array')
    expect(schemas.STAGE_RESULT_SCHEMA.properties.test_exit_code.type).toBe('integer')
  })

  it('AC1: REFLECT_SCHEMA and SKEPTIC_SCHEMA still require read_witness', () => {
    expect([...schemas.REFLECT_SCHEMA.required]).toContain('read_witness')
    expect([...schemas.SKEPTIC_SCHEMA.required]).toContain('read_witness')
  })

  it('AC9: the other schemas keep their required lists', () => {
    expect([...schemas.REFLECT_SCHEMA.required]).toEqual(['reasoning', 'score', 'read_witness'])
    expect([...schemas.SKEPTIC_SCHEMA.required]).toEqual(['bugs_found', 'confidence', 'verdict', 'read_witness'])
  })
})
