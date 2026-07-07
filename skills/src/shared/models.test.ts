// Tests for add-context-files-config-default — DEFAULT_CONFIG must expose a
// context_files default (empty array) alongside its existing keys, and any
// config merged over DEFAULT_CONFIG that omits context_files must resolve
// it to [] rather than leaving it undefined.

import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './models'

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
