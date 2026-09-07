// #437: the roadmap append is keyed by addendum date so a re-entered Refine
// appends each roadmapped addendum once. The agent ends every appended
// ROADMAP.md line with `(addendum YYYY-MM-DD)`; the probe batch greps those
// markers; only roadmap-verdict addenda without a marker are appended.

/** The marker the triage agent writes and the probe step greps for. */
export const ROADMAP_MARK_RE = /\(addendum (\d{4}-\d{2}-\d{2})\)/

/** Shell command for the probe batch: one marker per line, or nothing. */
export const ROADMAPPED_ADDENDA_CMD = "grep -oE '\\(addendum [0-9]{4}-[0-9]{2}-[0-9]{2}\\)' ROADMAP.md 2>/dev/null | sort -u || true"

export interface TriagedAddendum {
  date: string
  summary: string
  verdict: string
  reason: string
}

/** Addendum dates ROADMAP.md already carries, from the probe step's stdout. */
export function recordedAddendumDates(stepOut: string | null | undefined): string[] {
  const dates = new Set<string>()
  for (const line of (stepOut || '').split('\n')) {
    const m = ROADMAP_MARK_RE.exec(line)
    if (m) dates.add(m[1])
  }
  return [...dates].sort()
}

/** Roadmap-verdict addenda whose date ROADMAP.md does not carry yet. */
export function pendingRoadmapAddenda(addenda: TriagedAddendum[], recorded: string[]): TriagedAddendum[] {
  const seen = new Set(recorded)
  return addenda.filter((a) => a.verdict === 'roadmap' && !seen.has(a.date))
}
