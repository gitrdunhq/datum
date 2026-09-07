// base64.ts tests — RFC 4648 vectors, multibyte UTF-8 round trips, and a
// chunk boundary that splits a 3-byte character across two chunks (the exact
// shape a byte-budget chunk plan produces on a real file).

import { describe, it, expect } from 'vitest'
import { base64Encode, base64Decode } from './base64'
import { utf8BytesToString } from './utf8'

function toBytes(s: string): number[] {
  return Array.from(Buffer.from(s, 'utf8'))
}

describe('base64Encode / base64Decode', () => {
  // RFC 4648 §10 test vectors.
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ]

  it('encodes the RFC 4648 test vectors', () => {
    for (const [plain, encoded] of vectors) {
      expect(base64Encode(toBytes(plain))).toBe(encoded)
    }
  })

  it('decodes the RFC 4648 test vectors', () => {
    for (const [plain, encoded] of vectors) {
      expect(base64Decode(encoded)).toEqual(toBytes(plain))
    }
  })

  it('round-trips a multibyte UTF-8 string (§4-style text)', () => {
    const s = 'acceptance criteria: §4 applies, naïve café, 日本語, 😀'
    const bytes = toBytes(s)
    const decoded = base64Decode(base64Encode(bytes))
    expect(decoded).toEqual(bytes)
    expect(utf8BytesToString(decoded)).toBe(s)
  })

  it('tolerates newline-wrapped base64 output (the `base64` CLI wraps at 76 cols)', () => {
    const bytes = toBytes('x'.repeat(200))
    const wrapped = base64Encode(bytes).replace(/(.{20})/g, '$1\n')
    expect(base64Decode(wrapped)).toEqual(bytes)
  })

  it('throws on an invalid character', () => {
    expect(() => base64Decode('not!base64')).toThrow(/base64_decode_invalid_char/)
  })

  it('a chunk boundary that splits a 3-byte character (§ = C2 A7... no, 0xC2A7 is 2 bytes; use € = E2 82 AC) still assembles correctly once both halves are decoded and concatenated as bytes, then decoded as UTF-8 once', () => {
    const s = 'price: € 12'
    const bytes = toBytes(s)
    // € is bytes [0xE2, 0x82, 0xAC] inside this string — split it mid-character.
    const euroIdx = bytes.indexOf(0xe2)
    expect(bytes[euroIdx + 1]).toBe(0x82)
    const splitAt = euroIdx + 1 // cuts between byte 1 and byte 2 of the 3-byte sequence
    const chunkA = bytes.slice(0, splitAt)
    const chunkB = bytes.slice(splitAt)
    const b64A = base64Encode(chunkA)
    const b64B = base64Encode(chunkB)
    const reassembled = [...base64Decode(b64A), ...base64Decode(b64B)]
    expect(reassembled).toEqual(bytes)
    expect(utf8BytesToString(reassembled)).toBe(s)
  })
})
