// sha1.test.ts — FIPS 180-1 test vectors plus real-git cross-checks.
//
// Why a from-scratch SHA-1: the Workflow sandbox has neither node:crypto nor
// SubtleCrypto (utf8.test.ts's banned-globals tripwire), but
// contextAssembleChunks (shared/context-relay.ts) needs to verify assembled
// bytes against the git blob hash a probe step read with `git hash-object`.
// node:crypto/execFileSync are fine HERE because this test runs under real
// Node, never inside the Workflow sandbox.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha1Hex, gitBlobSha } from './sha1'

const toBytes = (s: string): number[] => Array.from(Buffer.from(s, 'utf8'))

describe('sha1Hex', () => {
  it('matches the FIPS 180-1 one-block example: "abc"', () => {
    expect(sha1Hex(toBytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('matches the empty-string vector', () => {
    expect(sha1Hex([])).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })

  it('matches the FIPS 180-1 56-byte multi-block-padding example', () => {
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
    expect(msg.length).toBe(56)
    expect(sha1Hex(toBytes(msg))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  })

  it('matches node:crypto for an input over 64 bytes (multiple 512-bit blocks)', () => {
    const msg = 'x'.repeat(200) + 'the quick brown fox jumps over the lazy dog, repeated for length'
    const bytes = toBytes(msg)
    expect(bytes.length).toBeGreaterThan(64)
    expect(sha1Hex(bytes)).toBe(createHash('sha1').update(Buffer.from(bytes)).digest('hex'))
  })

  it('matches node:crypto for a >1 MiB input', () => {
    const bytes: number[] = []
    for (let i = 0; i < 1024 * 1024 + 777; i++) bytes.push(i & 0xff)
    expect(sha1Hex(bytes)).toBe(createHash('sha1').update(Buffer.from(bytes)).digest('hex'))
  })
})

describe('gitBlobSha', () => {
  it('matches a real `git hash-object` of a temp file with multibyte content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-sha1-'))
    try {
      const content = 'naïve café — §4 acceptance criteria, 日本語, 😀'
      const filePath = join(dir, 'blob.txt')
      writeFileSync(filePath, content, 'utf8')
      const expected = execFileSync('git', ['hash-object', 'blob.txt'], { cwd: dir, encoding: 'utf8' }).trim()
      const bytes = toBytes(content)
      expect(gitBlobSha(bytes)).toBe(expected)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('matches a real `git hash-object` for the empty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-sha1-'))
    try {
      const filePath = join(dir, 'empty.txt')
      writeFileSync(filePath, '', 'utf8')
      const expected = execFileSync('git', ['hash-object', 'empty.txt'], { cwd: dir, encoding: 'utf8' }).trim()
      expect(gitBlobSha([])).toBe(expected)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
