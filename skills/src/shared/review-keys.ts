// review-keys.ts — a content key per review finding.
//
// Finding ids (PERF-001, CORR-003) are assigned fresh by each review run, so
// iteration 1's PERF-001 was iteration 2's PERF-002 and an operator's
// `ACCEPT PERF-001` bound to a different finding than the one reasoned
// about (elonchesd epic-1, review iteration 2). The key is derived from
// what identifies a finding across runs — the lens, the file and the
// normalised description — never from the id or the line number, both of
// which drift. `datum gate review` clears a high/critical row by its key.
// tested-by: skills/src/datum-review.test.ts

import { sha1Hex } from './sha1'
import { utf8Encode } from './utf8'

export function normaliseFindingText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function findingKey(domain: string, file: string, description: string): string {
  const material = `${normaliseFindingText(domain)}|${file.trim()}|${normaliseFindingText(description)}`
  return sha1Hex(utf8Encode(material)).slice(0, 8)
}
