// elonchesd wf_bd10e486-775 (epic-2 Act, the first run through Act with no
// datum halt): two lanes failed with one shape. A lane whose `files`
// include an EXISTING test file must be able to amend the assertions its
// own ACs supersede — task-003 added three fields to a model, epic-1's
// exact-shape toEqual pinned the old shape, RED only appended ("keep all
// existing tests intact"), GREEN may not touch tests (green_edited_tests),
// and the lane deadlocked. The category is stale_owned_test, not a GREEN
// self-report contradiction.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const red = readFileSync(join(__dirname, 'prompts', 'red.md'), 'utf8')
const reflect = readFileSync(join(__dirname, 'prompts', 'reflect.md'), 'utf8')

describe('owned test files: RED may amend what the ACs supersede; reflect checks for contradictions', () => {
  it('red.md scopes amendments to assertions the lane ACs supersede, in the lane-owned test files only, and forbids deleting unrelated tests', () => {
    expect(red).not.toMatch(/keep all existing tests intact/)
    expect(red).toMatch(/stale_owned_test/)
    expect(red).toMatch(/supersede/i)
    expect(red).toMatch(/toEqual|exact-shape|exact shape/i)
    expect(red).toMatch(/never delete or weaken a test that is not contradicted/i)
    expect(red).toMatch(/fixture|precondition/i)
  })

  it('reflect.md asks for existing assertions an AC contradicts and reports them as a gap', () => {
    expect(reflect).toMatch(/contradict/i)
    expect(reflect).toMatch(/stale_owned_test/)
  })
})
