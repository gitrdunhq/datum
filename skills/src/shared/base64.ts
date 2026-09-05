// base64.ts — pure base64 encode/decode, no Buffer/atob/btoa.
//
// Why: chunked context relay (shared/context-relay.ts) hands a file's bytes
// back through a datum-cli batch step as `... | base64` so the runner cannot
// "normalise" typography inside the payload the way it did with a plain
// `cat` (elonchesd run wf_6bfbd9f2-510 — 5 of 18 lanes had "§4" silently
// rewritten to "§ 4" by an LLM echo, which changed laneSpecHash() for those
// lanes and re-ran already-completed work). Base64 text has no typography to
// normalise. The Workflow sandbox exposes neither Buffer nor atob/btoa
// (utf8.test.ts's sandbox-globals tripwire), so decode has to be pure code.
// tested-by: skills/src/shared/base64.test.ts

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** RFC 4648 base64 encode of raw bytes (0-255 each). */
export function base64Encode(bytes: number[]): string {
  let out = ''
  let i = 0
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '=='
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + '='
  }
  return out
}

/**
 * RFC 4648 base64 decode to raw bytes (0-255 each). Tolerant of whitespace
 * and newlines (the `base64` CLI wraps output at 76 columns) and of a
 * missing/partial `=` padding tail. Throws on any other invalid character —
 * a batch step's stdout that isn't valid base64 is a relay bug, not silently
 * "close enough" data.
 */
export function base64Decode(input: string): number[] {
  const chars = input.replace(/[\s=]/g, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const val = B64_CHARS.indexOf(c)
    if (val === -1) throw new Error(`base64_decode_invalid_char: ${JSON.stringify(c)} at position ${i}`)
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return bytes
}
