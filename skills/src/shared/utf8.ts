// utf8.ts — byte length of a string as UTF-8, in pure code.
//
// The Workflow sandbox provides neither Buffer nor TextEncoder, and the
// context-relay integrity check compares the relayed content against the
// `wc -c` the datum-cli step ran on the real file — so the count has to be
// computed without any platform global. Unpaired surrogates count as 3
// bytes (what Buffer.byteLength does), so a lone surrogate can never make a
// faithful relay look like a mismatch.
// tested-by: skills/src/shared/utf8.test.ts

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
