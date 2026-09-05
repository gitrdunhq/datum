// Tests for add-context-files-config-default — DEFAULT_CONFIG must expose a
// context_files default (empty array) alongside its existing keys, and any
// config merged over DEFAULT_CONFIG that omits context_files must resolve
// it to [] rather than leaving it undefined.

import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from './models'

describe('DEFAULT_CONFIG.context_files', () => {
  it('deep-equals [] (empty array) by default', () => {
    expect(DEFAULT_CONFIG.context_files).toEqual([])
  })

  it('still exposes existing keys language, test_framework, test_command, skills_dir unchanged', () => {
    expect(DEFAULT_CONFIG.language).toBe('')
    expect(DEFAULT_CONFIG.test_framework).toBe('')
    expect(DEFAULT_CONFIG.test_command).toBe('')
    expect(DEFAULT_CONFIG.skills_dir).toBe('')
  })

  it('resolves context_files to [] when a merged config omits it (default applied, not undefined)', () => {
    const repoConfig = {
      language: 'typescript',
      test_framework: 'vitest',
      test_command: 'npx vitest run',
      skills_dir: 'skills',
    }
    const merged = { ...DEFAULT_CONFIG, ...repoConfig }
    expect(merged.context_files).toEqual([])
    expect(merged.context_files).not.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mergeConfig — deterministic replacement for the LLM READ_CONFIG_PROMPT
// relay in datum-plan.ts. Repo wins on top-level conflicts; nested "models"
// merges key-wise instead of one object replacing the other.
// ---------------------------------------------------------------------------

describe('mergeConfig', () => {
  it('repo config overrides global config on top-level conflicts', () => {
    const merged = mergeConfig(
      { language: 'python', test_command: 'pytest' },
      { test_command: 'npx vitest run' },
    )
    expect(merged.test_command).toBe('npx vitest run')
    expect(merged.language).toBe('python')
  })

  it('merges nested "models" key-wise — repo overrides only the tiers it names', () => {
    const merged = mergeConfig(
      { models: { fast: 'haiku', balanced: 'sonnet', deep: 'opus' } },
      { models: { deep: 'opus-4' } },
    )
    expect(merged.models).toEqual({ fast: 'haiku', balanced: 'sonnet', deep: 'opus-4' })
  })

  it('falls back to repo-only when global config is null/missing', () => {
    const merged = mergeConfig(null, { language: 'go', test_command: 'go test ./...' })
    expect(merged).toEqual({ language: 'go', test_command: 'go test ./...' })
  })

  it('falls back to global-only when repo config is an empty object', () => {
    const merged = mergeConfig({ language: 'go' }, {})
    expect(merged).toEqual({ language: 'go' })
  })

  it('does not mutate either input object', () => {
    const global = { language: 'python', models: { fast: 'haiku' } }
    const repo = { models: { deep: 'opus' } }
    mergeConfig(global, repo)
    expect(global).toEqual({ language: 'python', models: { fast: 'haiku' } })
    expect(repo).toEqual({ models: { deep: 'opus' } })
  })
})
