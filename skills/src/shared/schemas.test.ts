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
