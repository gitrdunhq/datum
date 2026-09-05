// utf8.ts — byte length of a string as UTF-8, in pure code.
//
// The Workflow sandbox provides neither Buffer nor TextEncoder, and the
// context-relay integrity check compares the relayed content against the
// `wc -c` the datum-cli step ran on the real file — so the count has to be
// computed without any platform global. Unpaired surrogates count as 3
// bytes (what Buffer.byteLength does), so a lone surrogate can never make a
// faithful relay look like a mismatch.
// tested-by: skills/src/shared/utf8.test.ts

/**
 * The inverse of utf8ByteLength: decode a full array of raw UTF-8 bytes back
 * into a JS string. Used by the chunked context relay (shared/context-relay.ts)
 * ONLY on the fully-assembled byte array — never on a single chunk — because
 * a byte-budget chunk boundary can land in the middle of a multibyte
 * character, and decoding a partial sequence would silently produce garbage.
 * Throws on any malformed sequence rather than substituting a replacement
 * character: a relayed file that doesn't decode cleanly is a mismatch to
 * surface, not a lossy "best effort" read.
 */
export function utf8BytesToString(bytes: number[]): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    let codepoint: number
    let len: number
    if (b0 < 0x80) { codepoint = b0; len = 1 }
    else if ((b0 & 0xe0) === 0xc0) { codepoint = b0 & 0x1f; len = 2 }
    else if ((b0 & 0xf0) === 0xe0) { codepoint = b0 & 0x0f; len = 3 }
    else if ((b0 & 0xf8) === 0xf0) { codepoint = b0 & 0x07; len = 4 }
    else { throw new Error(`utf8_decode_invalid_byte: 0x${b0.toString(16)} at position ${i}`) }
    if (i + len > bytes.length) throw new Error(`utf8_decode_truncated: sequence at position ${i} needs ${len} bytes`)
    for (let k = 1; k < len; k++) {
      const bk = bytes[i + k]
      if ((bk & 0xc0) !== 0x80) throw new Error(`utf8_decode_invalid_continuation: at position ${i + k}`)
      codepoint = (codepoint << 6) | (bk & 0x3f)
    }
    if (codepoint <= 0xffff) {
      out += String.fromCharCode(codepoint)
    } else {
      const cp = codepoint - 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    }
    i += len
  }
  return out
}

export function utf8ByteLength(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { bytes += 4; i++ } else bytes += 3
    } else bytes += 3
  }
  return bytes
}
