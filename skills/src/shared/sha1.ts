// sha1.ts — pure SHA-1 (FIPS 180-1) over a byte array, no platform crypto APIs.
//
// Why: contextAssembleChunks (shared/context-relay.ts) needs to verify the
// bytes it assembles from chunked batch steps against the git blob hash a
// probe step already read from disk with `git hash-object`. The Workflow
// sandbox has neither node:crypto nor SubtleCrypto (see the banned-globals
// tripwire in utf8.test.ts), so the hash has to be pure code, same as
// utf8.ts/base64.ts. git's blob hash is sha1("blob " + <decimal length> +
// "\0" + content) — see gitBlobSha below.
// tested-by: skills/src/shared/sha1.test.ts

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

/** FIPS 180-1 SHA-1 digest of raw bytes (0-255 each), as 40 lowercase hex chars. */
export function sha1Hex(bytes: number[]): string {
  const msgBitsLow = (bytes.length * 8) >>> 0
  const msgBitsHigh = Math.floor((bytes.length * 8) / 0x100000000) >>> 0

  const padded = bytes.slice()
  padded.push(0x80)
  while (padded.length % 64 !== 56) padded.push(0x00)
  padded.push(
    (msgBitsHigh >>> 24) & 0xff, (msgBitsHigh >>> 16) & 0xff, (msgBitsHigh >>> 8) & 0xff, msgBitsHigh & 0xff,
    (msgBitsLow >>> 24) & 0xff, (msgBitsLow >>> 16) & 0xff, (msgBitsLow >>> 8) & 0xff, msgBitsLow & 0xff,
  )

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Array<number>(80).fill(0)
  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      const o = chunkStart + i * 4
      w[i] = ((padded[o] << 24) | (padded[o + 1] << 16) | (padded[o + 2] << 8) | padded[o + 3]) >>> 0
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4)
}

/** git's blob object id: sha1("blob " + <decimal byte length> + "\0" + content). */
export function gitBlobSha(bytes: number[]): string {
  const header = `blob ${bytes.length}\0`
  const headerBytes: number[] = []
  for (let i = 0; i < header.length; i++) headerBytes.push(header.charCodeAt(i))
  return sha1Hex(headerBytes.concat(bytes))
}
