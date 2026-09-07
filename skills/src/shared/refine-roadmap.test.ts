// #437: Refine re-triaged every TICKET.md addendum on every re-entry and
// appended the roadmap items to ROADMAP.md again. The append is now keyed
// by addendum date: each appended line ends with `(addendum YYYY-MM-DD)`,
// the probe batch lists the dates ROADMAP.md already carries, and only the
// roadmap-verdict addenda whose date is not recorded are appended.

import { describe, it, expect } from 'vitest'
import { recordedAddendumDates, pendingRoadmapAddenda, ROADMAP_MARK_RE } from './refine-roadmap'

const addenda = [
  { date: '2026-09-01', summary: 'same scope thing', verdict: 'same_scope', reason: 'overlaps' },
  { date: '2026-09-03', summary: 'new feature A', verdict: 'roadmap', reason: 'no overlap' },
  { date: '2026-09-05', summary: 'new feature B', verdict: 'roadmap', reason: 'no overlap' },
]

describe('recordedAddendumDates — what the probe step printed', () => {
  it('parses one date per marker, deduplicated, ignoring noise', () => {
    const out = '(addendum 2026-09-03)\n(addendum 2026-09-03)\nsomething else\n'
    expect(recordedAddendumDates(out)).toEqual(['2026-09-03'])
  })
  it('an empty or missing step output is no dates', () => {
    expect(recordedAddendumDates('')).toEqual([])
    expect(recordedAddendumDates(undefined)).toEqual([])
  })
})

describe('pendingRoadmapAddenda — only unrecorded roadmap-verdict addenda are appended', () => {
  it('first entry: every roadmap addendum is pending, same-scope ones never are', () => {
    expect(pendingRoadmapAddenda(addenda, []).map((a) => a.date)).toEqual(['2026-09-03', '2026-09-05'])
  })
  it('re-entry: an addendum whose date ROADMAP.md already carries is not appended again', () => {
    expect(pendingRoadmapAddenda(addenda, ['2026-09-03']).map((a) => a.date)).toEqual(['2026-09-05'])
  })
  it('fully recorded: nothing pending, so the commit may legitimately see no change', () => {
    expect(pendingRoadmapAddenda(addenda, ['2026-09-03', '2026-09-05'])).toEqual([])
  })
})

describe('the marker the agent must write is the one the probe greps for', () => {
  it('ROADMAP_MARK_RE matches the documented shape and nothing looser', () => {
    expect('- Feature A (addendum 2026-09-03)').toMatch(ROADMAP_MARK_RE)
    expect('- Feature A (addendum 26-9-3)').not.toMatch(ROADMAP_MARK_RE)
  })
})
