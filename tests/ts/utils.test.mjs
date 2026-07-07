// Unit tests for pure helpers in skills/src/shared/utils.ts.
// Run via: bash scripts/test-ts.sh (esbuild-transpiles utils.ts, then node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fnv1a64, laneSpecHash, epicSlug } from '../../.temp/ts-test/utils.mjs'

test('epicSlug replaces path separators and unsafe chars with dashes', () => {
  assert.equal(epicSlug('datum/epic-287'), 'datum-epic-287')
  assert.equal(epicSlug('feature/foo bar@2'), 'feature-foo-bar-2')
  assert.equal(epicSlug('main'), 'main')
})

test('fnv1a64 is deterministic and prefix-tagged', () => {
  const h = fnv1a64('hello')
  assert.equal(h, fnv1a64('hello'))
  assert.match(h, /^fnv1a64:[0-9a-f]{16}$/)
})

test('fnv1a64 distinguishes different inputs', () => {
  assert.notEqual(fnv1a64('hello'), fnv1a64('hellp'))
  assert.notEqual(fnv1a64(''), fnv1a64(' '))
})

test('fnv1a64 of empty string is the FNV-1a offset basis', () => {
  assert.equal(fnv1a64(''), 'fnv1a64:cbf29ce484222325')
})

test('laneSpecHash depends only on files, acceptance_criteria, depends_on', () => {
  const lane = {
    title: 'Split RecordingRepository',
    files: ['Sources/Domain/Storage/RecordingRepository.swift', 'Tests/Domain/RepoTests.swift'],
    acceptance_criteria: ['Read/Write protocols exist', 'TestMocks conform'],
    depends_on: ['task-001'],
    red_note: 'scoped deletion note',
  }
  const same = { ...lane, title: 'renamed title', red_note: 'different note' }
  assert.equal(laneSpecHash(lane), laneSpecHash(same))

  const filesChanged = { ...lane, files: [...lane.files, 'Extra.swift'] }
  assert.notEqual(laneSpecHash(lane), laneSpecHash(filesChanged))

  const acChanged = { ...lane, acceptance_criteria: ['Read/Write protocols exist'] }
  assert.notEqual(laneSpecHash(lane), laneSpecHash(acChanged))

  const depsChanged = { ...lane, depends_on: [] }
  assert.notEqual(laneSpecHash(lane), laneSpecHash(depsChanged))
})

test('laneSpecHash treats missing optional arrays as empty', () => {
  const bare = { title: 't', files: ['a.swift'] }
  const explicit = { title: 't', files: ['a.swift'], acceptance_criteria: [], depends_on: [] }
  assert.equal(laneSpecHash(bare), laneSpecHash(explicit))
})

test('laneSpecHash is order-sensitive for files (spec identity, not set equality)', () => {
  const a = { files: ['a.swift', 'b.swift'] }
  const b = { files: ['b.swift', 'a.swift'] }
  assert.notEqual(laneSpecHash(a), laneSpecHash(b))
})
