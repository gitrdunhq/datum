// Tests task adopt-existing-feature-branch: R4 — Bootstrap epic from an
// existing feature branch (#213).
//
// RED phase — none of these behaviors exist yet:
//  - `datum init` has no adopt-existing-branch path (no --json flag, no
//    epicBranch/lanePlanPath state emission, no unsafe-branch-state guard).
//  - skills/src/datum-go.ts's Act bootstrap still resolves the branch purely
//    via an agent prompt (detectBranchPrompt) — it never shells out to a CLI
//    adopt path.
// All assertions below are expected to fail until GREEN implements them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Fixture helpers — build a throwaway git repo we can safely mutate.
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status: number | null; stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      status: e.status ?? 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    }
  }
}

function initRepo(dir: string): void {
  run('git', ['init', '-q', '-b', 'main'], dir)
  // Hermetic: a machine-global core.hooksPath (post-commit/post-checkout
  // hooks) otherwise writes into this temp repo, `git add .` picks that up,
  // and the AC2 merge-conflict scenario silently stops conflicting.
  run('git', ['config', 'core.hooksPath', '/dev/null'], dir)
  run('git', ['config', 'user.email', 'test@example.com'], dir)
  run('git', ['config', 'user.name', 'Test User'], dir)
  writeFileSync(join(dir, 'README.md'), '# fixture repo\n')
  run('git', ['add', '.'], dir)
  run('git', ['commit', '-q', '-m', 'initial commit'], dir)
}

let repoDir: string

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'datum-adopt-'))
  initRepo(repoDir)
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// AC1 — non-default branch, no TICKET.md/lane-plan artifacts -> adoption
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC1', () => {
  it('datum init --json on a non-default branch with no artifacts sets epicBranch to current branch and emits a lanePlanPath', () => {
    run('git', ['checkout', '-q', '-b', 'feature/existing-work'], repoDir)

    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).toBe(0)

    let parsed: { epicBranch?: string; lanePlanPath?: string; adopted?: boolean }
    expect(() => {
      parsed = JSON.parse(result.stdout)
    }).not.toThrow()

    expect(parsed!.epicBranch).toBe('feature/existing-work')
    expect(typeof parsed!.lanePlanPath).toBe('string')
    expect(parsed!.lanePlanPath!.length).toBeGreaterThan(0)
    expect(parsed!.adopted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC2 — unsafe/conflicting branch state -> non-zero exit, clear error
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC2', () => {
  it('datum init exits non-zero with a clear error when the branch has an unresolved merge conflict', () => {
    // Create a genuine unresolved merge conflict so MERGE_HEAD / conflict
    // markers are present in the working tree — an unsafe state to adopt.
    run('git', ['checkout', '-q', '-b', 'feature/conflicted'], repoDir)
    writeFileSync(join(repoDir, 'shared.txt'), 'from feature branch\n')
    run('git', ['add', '.'], repoDir)
    run('git', ['commit', '-q', '-m', 'feature change'], repoDir)

    run('git', ['checkout', '-q', 'main'], repoDir)
    writeFileSync(join(repoDir, 'shared.txt'), 'from main branch\n')
    run('git', ['add', '.'], repoDir)
    run('git', ['commit', '-q', '-m', 'main change'], repoDir)

    run('git', ['checkout', '-q', 'feature/conflicted'], repoDir)
    const mergeResult = run('git', ['merge', 'main'], repoDir)
    expect(mergeResult.status).not.toBe(0) // sanity: the merge really did conflict
    expect(existsSync(join(repoDir, '.git', 'MERGE_HEAD'))).toBe(true) // sanity: mid-conflict

    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).not.toBe(0)
    const combined = `${result.stdout}${result.stderr}`.toLowerCase()
    expect(combined).toContain('conflict')
  })
})

// ---------------------------------------------------------------------------
// AC3 — datum-go.ts's Act bootstrap must route through the CLI adopt path,
// not resolve the branch inline via an agent prompt / inline shell.
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC3', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('the Act bootstrap step invokes the CLI adopt path (datum init --json / --adopt)', () => {
    expect(src).toMatch(/datum\s+init\s+(--json|--adopt)/)
  })

  it('the Act bootstrap step no longer resolves branch/runId purely via the inline detectBranchPrompt agent call', () => {
    // Today the bootstrap step calls `agent(detectBranchPrompt, ...)` directly
    // with no CLI adopt fallback — that inline-only path must be gone once
    // bootstrap routes through the CLI adopt path.
    expect(src).not.toMatch(/agent\(detectBranchPrompt/)
  })
})

// ---------------------------------------------------------------------------
// AC4 — default branch, or artifacts already present -> adoption not
// triggered; existing behavior is preserved.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// parseArgs — non-JSON free-text args must not be silently dropped (#319).
//
// Incident: a caller passed `--start-from act` as raw args. It wasn't valid
// JSON, wasn't "yolo", wasn't a bare issue number, so it fell into the catch
// branch and became `{ yolo: true, freeText: raw }` with zero indication
// anything was ignored. `startFrom` was never set, `explicitStart` stayed
// false, and the pipeline silently resumed from stale `completedPhases`
// state — skipping 7 bug-fix lanes with no warning.
//
// These tests exercise `parseArgs` in isolation (it's a pure string ->
// object function with no dependency on the sandbox globals `log`/`agent`/
// `workflow`, so we can extract and eval it directly from source) to lock
// in: (a) `--start-from <phase>` / `--route <route>` are recovered from
// free text, and (b) any remaining unrecognized free text triggers a loud
// warning via `log(...)` mentioning it was ignored.
// ---------------------------------------------------------------------------

describe('parseArgs — non-JSON free-text args (#319)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  // Extract the `parseArgs` function body from source and eval it in a
  // sandbox that captures `log(...)` calls, mirroring how the real workflow
  // sandbox injects `log` as an ambient global.
  function loadParseArgs(): { parseArgs: (raw: string) => Record<string, unknown>; logs: string[] } {
    const match = src.match(/function parseArgs\(raw: string\): Record<string, unknown> \{[\s\S]*?\n\}\n/)
    expect(match).not.toBeNull()
    const fnSrc = match![0]
      // strip TS-only annotations so this can run as plain JS via `new Function`
      .replace('function parseArgs(raw: string): Record<string, unknown> {', 'function parseArgs(raw) {')
      .replace(': Record<string, unknown>', '')

    const logs: string[] = []
    const factory = new Function('log', `${fnSrc}\nreturn parseArgs;`)
    const parseArgs = factory((msg: string) => logs.push(msg)) as (raw: string) => Record<string, unknown>
    return { parseArgs, logs }
  }

  it('recovers --start-from from non-JSON free text instead of silently dropping it', () => {
    const { parseArgs, logs } = loadParseArgs()
    const result = parseArgs('--start-from act')

    expect(result.startFrom).toBe('act')
    // A recognized flag was recovered — still log, but not the "IGNORED" warning.
    expect(logs.some((l) => l.includes('IGNORED'))).toBe(false)
  })

  it('recovers --route from non-JSON free text', () => {
    const { parseArgs } = loadParseArgs()
    const result = parseArgs('--route bugfix')

    expect(result.route).toBe('bugfix')
  })

  it('logs a loud warning when free text is neither JSON, yolo, an issue number, nor a recognized flag', () => {
    const { parseArgs, logs } = loadParseArgs()
    const raw = 'do something totally unrecognized'
    const result = parseArgs(raw)

    expect(result.freeText).toBe(raw)
    expect(result.startFrom).toBeUndefined()
    expect(result.route).toBeUndefined()
    expect(logs.some((l) => l.includes('WARNING') && l.includes(raw) && l.includes('IGNORED'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// #327 — preflight check that the globally installed `datum` uv tool editable
// link still resolves to this repo root, before any pipeline phase runs.
// ---------------------------------------------------------------------------

describe('preflight tool-install check (#327)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')
  const checkScript = readFileSync(join(__dirname, '..', '..', 'scripts', 'preflight-tool-check.sh'), 'utf8')

  it('checks the uv tool editable install direct_url.json against the repo root before running any phase', () => {
    expect(checkScript).toMatch(/direct_url\.json/)
    expect(checkScript).toMatch(/git rev-parse --show-toplevel/)
    expect(src).toMatch(/git rev-parse --show-toplevel/)
  })

  it('fails loud with a clear remediation message when the install is misdirected', () => {
    expect(src).toMatch(/throw new Error\(\s*`datum CLI tool install is stale\/misdirected/)
    expect(src).toMatch(/uv tool install --editable \. --force/)
  })

  it('the preflight check runs before the auto-resume / first phase logic', () => {
    const preflightIdx = src.indexOf('preflight-tool-check')
    const firstPhaseIdx = src.indexOf("shouldRun('refine', 0)")
    expect(preflightIdx).toBeGreaterThan(-1)
    expect(firstPhaseIdx).toBeGreaterThan(-1)
    expect(preflightIdx).toBeLessThan(firstPhaseIdx)
  })

  // #378 — the check must not false-positive when datum-go orchestrates a
  // target repo other than datum itself (e.g. run from inside a different
  // project to plan/build a feature there). scripts/preflight-tool-check.sh
  // only ships inside the datum repo, so its call site in datum-go.ts must
  // gate on the script actually existing at the invoking repo's toplevel
  // before running it, and skip (rather than fail) when it's absent.
  it('skips the self-hosted install check when the invoking repo is not the datum repo itself (#378)', () => {
    expect(src).toMatch(/preflight-tool-check\.sh/)
    expect(src).toMatch(/if \[ -f "\$SCRIPT" \]/)
    expect(src).toMatch(/not the datum repo itself/)
  })

  // #378 follow-up — the original inline one-liner (assembled by string
  // concatenation with nested, backslash-escaped JSON quoting) proved
  // unreliable for the LLM `cli` agent running it to reproduce faithfully.
  // The check must be a real script file the agent just invokes by path.
  it('delegates the check to a real script file instead of an inline one-liner (#378 follow-up)', () => {
    expect(src).not.toMatch(/direct_url\.json/)
    expect(checkScript).toMatch(/^#!\/usr\/bin\/env bash/)
  })

  // #378 — the thrown error must never surface literal "undefined" for the
  // installed/expected paths; if the check agent didn't return clean JSON
  // with those fields, fall back to a readable placeholder instead.
  it('never interpolates literal undefined into the misdirected-install error message', () => {
    expect(src).not.toMatch(/points at "\$\{toolCheck\.installed\}"/)
    expect(src).not.toMatch(/repo root is "\$\{toolCheck\.expected\}"/)
  })
})

// ---------------------------------------------------------------------------
// #524 dogfooding — leftover .datum/pipeline-state.json from an unrelated,
// no-longer-checked-out epic must never be trusted by auto-resume: it
// previously set startFrom=act from a stale branch's completedPhases,
// skipping Refine/Plan/Properties for what was actually a brand new epic on
// the current branch, so Act crashed looking for a lane-plan.json that had
// never been written.
// ---------------------------------------------------------------------------

// #368 follow-up: the boot read (config + pipeline state + local skills +
// repo root + branch) used to be a single LLM relay (bootPrompt) trusted
// verbatim. It is now a deterministic datum-cli batch, matching the
// datum-plan.ts config-batch conversion (commit a7093d2).
describe('boot read is a deterministic batch, not an LLM relay (#368 follow-up)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('uses bootSteps()/bootFromSteps() instead of an LLM relay prompt', () => {
    expect(src).toMatch(/bootSteps\(\)/)
    expect(src).toMatch(/bootFromSteps\(/)
  })

  it('never calls agent(bootPrompt(...))', () => {
    expect(src).not.toMatch(/agent\(\s*bootPrompt/)
  })

  it('does not import bootPrompt at all (retired — no remaining consumer)', () => {
    expect(src).not.toMatch(/bootPrompt/)
  })

  it('still warns when configFingerprint is not passed by the launcher', () => {
    expect(src).toMatch(/NO_FINGERPRINT_WARNING/)
  })
})

describe('stale pipeline-state guard (#524)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('asks the boot agent for the currently checked-out branch and compares it against the stored state before trusting it', () => {
    expect(src).toMatch(/isStaleState/)
    expect(src).toMatch(/currentBranch/)
  })

  it('drops the stale state entirely rather than gating only the resume block, so completedPhases/resolvedBranch/the freeText new-epic check all fall back to a fresh run', () => {
    const staleCheckIdx = src.indexOf('isStaleState(priorState')
    const completedPhasesIdx = src.indexOf('const completedPhases')
    const resumeBlockIdx = src.indexOf("if (priorState && !explicitStart && !newEpicBranch)")
    expect(staleCheckIdx).toBeGreaterThan(-1)
    expect(completedPhasesIdx).toBeGreaterThan(-1)
    expect(resumeBlockIdx).toBeGreaterThan(-1)
    expect(staleCheckIdx).toBeLessThan(completedPhasesIdx)
    expect(staleCheckIdx).toBeLessThan(resumeBlockIdx)
  })

  it('protects a bare `datum go` with no freeText the same as one with a brief — the guard does not depend on a.freeText', () => {
    const staleBlock = src.slice(src.indexOf('isStaleState(priorState') - 200, src.indexOf('isStaleState(priorState') + 200)
    expect(staleBlock).not.toMatch(/a\.freeText/)
  })
})

// #524 dogfooding — `Workflow({ name: "datum-go", args: "521" })` parses into
// a.issueNumber via parseArgs, but phaseArgs (what Refine/Plan/Properties
// actually receive) only carried yolo/agentTypes — issueNumber and freeText
// were silently dropped before ever reaching Refine, which then threw a
// generic "TICKET.md not found" with no trace either was passed.
describe('phaseArgs forwards freeText/issueNumber to child phases (#524)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('phaseArgs includes freeText and issueNumber alongside yolo/agentTypes', () => {
    const phaseArgsLine = src.slice(src.indexOf('const phaseArgs ='), src.indexOf('const phaseArgs =') + 400)
    expect(phaseArgsLine).toMatch(/freeText/)
    expect(phaseArgsLine).toMatch(/issueNumber/)
  })
})

// #524 dogfooding (state-flow audit) — phaseArgs never carries a runId, so
// the Closeout call — `workflow({scriptPath: sk('datum-closeout')}, phaseArgs)`
// — sent datum-closeout.ts an object with no runId. datum-closeout.ts reads
// `a.runId || ''`, so it always fell back to generating a brand-new,
// unrelated run id instead of reusing the one Act actually produced —
// closeout then looked for `.datum/runs/<bogus-id>/closeout-data.json`,
// which never exists, silently skipping the real collected data.
describe('Closeout receives the real Act runId, not an empty phaseArgs default (#524)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('the datum-closeout workflow call includes runId: resolvedRunId, not bare phaseArgs', () => {
    const closeoutCallIdx = src.indexOf("sk('datum-closeout')")
    expect(closeoutCallIdx).toBeGreaterThan(-1)
    const closeoutCall = src.slice(closeoutCallIdx, closeoutCallIdx + 200)
    expect(closeoutCall).toMatch(/runId:\s*resolvedRunId/)
  })
})

// #524 dogfooding (state-flow audit) — datum-go.ts's inline Act block
// exists to mirror datum-tdd-act.ts exactly, but its cfg literal for the
// act-lane call had drifted: it omitted test_framework, which
// datum-tdd-act.ts's equivalent cfg includes. Unread by
// datum-tdd-act-lane.ts today (latent, not an active bug) — closing the
// drift before something starts reading it on only one of the two paths.
describe('act-lane cfg includes test_framework, matching datum-tdd-act.ts (#524)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('the cfg object passed to the act-lane workflow call includes test_framework', () => {
    const cfgIdx = src.indexOf('cfg: { lanePlanPath')
    expect(cfgIdx).toBeGreaterThan(-1)
    const cfgLiteral = src.slice(cfgIdx, cfgIdx + 250)
    expect(cfgLiteral).toMatch(/test_framework/)
  })
})

describe('adopt-existing-feature-branch — AC4', () => {
  it('datum init --json on the default branch does not report adoption', () => {
    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as { adopted?: boolean }
    expect(parsed.adopted).toBeFalsy()
  })

  it('datum init --json on a non-default branch with an existing TICKET.md does not report adoption and leaves TICKET.md untouched', () => {
    run('git', ['checkout', '-q', '-b', 'feature/already-planned'], repoDir)
    const epicDir = join(repoDir, 'docs', 'epics', 'feature', 'already-planned')
    mkdirSync(epicDir, { recursive: true })
    const ticketPath = join(epicDir, 'TICKET.md')
    const sentinel = '# Pre-existing ticket — do not overwrite\n'
    writeFileSync(ticketPath, sentinel)

    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as { adopted?: boolean }
    expect(parsed.adopted).toBeFalsy()
    expect(readFileSync(ticketPath, 'utf8')).toBe(sentinel)
  })
})

// ---------------------------------------------------------------------------
// new-epic detection (#213 follow-up) — a freeText brief that clearly
// describes different work than the existing TICKET.md must trigger a new
// epic bootstrap instead of silently resuming the checked-out one.
//
// Incident: on a feature branch with its own TICKET.md from a prior epic,
// `datum go yolo "new brief"` resumed the existing epic because the
// bootstrap logic only ever checked "is TICKET.md missing?" — never whether
// the brief the caller just typed described a different piece of work.
// Fixing this by shelling out to a real LLM mid-test isn't practical, so
// these are source-string assertions (same convention as AC3 / #327 above)
// that lock in: the guard conditions, that it reuses the existing
// `datum init --name <slug>` CLI bootstrap path rather than a second
// mechanism, and that it runs before auto-resume decides to skip Refine.
// ---------------------------------------------------------------------------

describe('new-epic detection from freeText brief (#213 follow-up)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('only runs the new-epic check when freeText is present, prior state exists, and start was not explicit', () => {
    expect(src).toMatch(/if \(a\.freeText && priorState && !explicitStart\)/)
  })

  it('reuses the existing `datum init --name <slug>` bootstrap path rather than inventing a second mechanism', () => {
    expect(src).toMatch(/datum init --name <slug> --json/)
  })

  it('gates auto-resume on the new-epic decision so a detected new epic does not get skipped straight past Refine', () => {
    expect(src).toMatch(/if \(priorState && !explicitStart && !newEpicBranch\)/)
  })

  it('the new-epic check runs before the auto-resume block', () => {
    const newEpicIdx = src.indexOf('New-epic detection')
    const resumeIdx = src.indexOf('if (priorState && !explicitStart && !newEpicBranch)')
    expect(newEpicIdx).toBeGreaterThan(-1)
    expect(resumeIdx).toBeGreaterThan(-1)
    expect(newEpicIdx).toBeLessThan(resumeIdx)
  })

  it('bare `datum go yolo` (no freeText) never triggers the new-epic check, preserving existing resume behavior', () => {
    // Guard requires a.freeText to be truthy — parseArgs only sets freeText
    // in the catch-all branch, never for bare "yolo"/JSON/issue-number input.
    expect(src).toMatch(/a\.freeText && priorState && !explicitStart/)
    // `--start-from` explicitly set must also short-circuit the check,
    // preserving `--start-from`/`--route` resume behavior untouched.
    expect(src).toMatch(/explicitStart: boolean = !!a\.startFrom/)
  })
})

// shouldRun() gates whether EVERY phase in the pipeline executes, combining
// three conditions (halt state, start index, active-phase membership) — it
// had a call-site check ("is shouldRun('refine', 0) called") but its actual
// boolean logic was never unit-tested directly. A wrong operator or an
// off-by-one on startIdx here would silently skip or wrongly run phases in
// production with nothing to catch it.
describe('shouldRun — phase gating logic', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  function loadShouldRun(haltedAt: string | null, startIdx: number, activePhases: string[]): (p: string, idx: number) => boolean {
    const match = src.match(/function shouldRun\(p: Phase, idx: number\): boolean \{[\s\S]*?\n\}\n/)
    expect(match).not.toBeNull()
    const fnSrc = match![0]
      .replace('function shouldRun(p: Phase, idx: number): boolean {', 'function shouldRun(p, idx) {')
    const factory = new Function('haltedAt', 'startIdx', 'activePhases', `${fnSrc}\nreturn shouldRun;`)
    return factory(haltedAt, startIdx, activePhases) as (p: string, idx: number) => boolean
  }

  it('runs a phase at or after startIdx that is in activePhases, when nothing has halted', () => {
    const shouldRun = loadShouldRun(null, 0, ['refine', 'plan', 'act'])
    expect(shouldRun('refine', 0)).toBe(true)
    expect(shouldRun('act', 2)).toBe(true)
  })

  it('does not run a phase before startIdx, even if active and nothing halted', () => {
    const shouldRun = loadShouldRun(null, 2, ['refine', 'plan', 'act'])
    expect(shouldRun('refine', 0)).toBe(false)
    expect(shouldRun('plan', 1)).toBe(false)
    expect(shouldRun('act', 2)).toBe(true)
  })

  it('does not run ANY phase once haltedAt is set, regardless of index or active-phase membership', () => {
    const shouldRun = loadShouldRun('review', 0, ['refine', 'plan', 'act', 'review', 'closeout'])
    expect(shouldRun('refine', 0)).toBe(false)
    expect(shouldRun('review', 3)).toBe(false)
    expect(shouldRun('closeout', 4)).toBe(false)
  })

  it('does not run a phase absent from activePhases, even at/after startIdx with nothing halted', () => {
    const shouldRun = loadShouldRun(null, 0, ['refine', 'act'])
    expect(shouldRun('plan', 1)).toBe(false)
    expect(shouldRun('act', 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Act failure must halt the pipeline (eedom dogfooding, run wf_2a5ede48-358):
// a lane the runner marked completed had its squash-merge fail, another lane
// was blocked, yet datum-go marked Act complete, ran Validate/Review/Closeout
// on an unmerged epic, Closeout's housekeeping deleted the surviving lane
// branches and pipeline-state, and the final result said "complete".
// ---------------------------------------------------------------------------

describe('Act failures halt datum-go before Validate/Review/Closeout', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('captures the merge workflow result instead of discarding it', () => {
    expect(goSource).toMatch(/const merge\w* = await workflow\(\s*\{ scriptPath: sk\('datum-tdd-act-merge'\) \}/)
  })

  it('demotes lanes whose merge failed from completed to failed', () => {
    expect(goSource).toMatch(/merge_failed/)
  })

  // New-epic detection: the model judges SAME vs DIFFERENT; it must not also
  // run `datum init` and echo the JSON — a fabricated or mistyped epicBranch
  // in that echo became resolvedBranch with nothing verifying it. The
  // bootstrap is a batch step whose stdout the script parses itself.
  it('the new-epic agent only decides (newEpic + slug); the script runs datum init --name as a batch and reads epicBranch from it', () => {
    const idx = goSource.indexOf("label: 'new-epic-check'")
    expect(idx).toBeGreaterThan(-1)
    const prompt = goSource.slice(idx - 1500, idx)
    expect(prompt).not.toMatch(/then run exactly: datum init/)
    expect(prompt).toMatch(/"slug"/)
    expect(prompt).toMatch(/Do NOT run datum init/)
    const after = goSource.slice(idx)
    expect(after).toMatch(/newEpicBootstrapSteps\(newEpicInfo\.slug\)/)
    expect(after).toMatch(/newEpicBootstrapFromSteps\(parseBatchResult\(/)
    expect(after).toMatch(/throw new Error\(`new_epic_bootstrap_failed: /)
    expect(after).toMatch(/newEpicBranch = bootstrap\.epicBranch/)
  })

  it('on a partial merge, demotes only the lanes the merge did not land (elonchesd wf_4f1e41dd-ab7 batch 3/5)', () => {
    expect(goSource).toMatch(/const landed = new Set\(mergeResult && Array\.isArray\(mergeResult\.mergedIds\) \? mergeResult\.mergedIds : \[\]\)/)
    expect(goSource).toMatch(/const unmerged = mergedIds\.filter\(\(?id\)? => !landed\.has\(id\)\)/)
    expect(goSource).toMatch(/for \(const id of unmerged\) \{/)
    expect(goSource).not.toMatch(/for \(const id of mergedIds\) \{[^}]*status: 'failed', stage: 'MERGE'/)
    expect(goSource).toMatch(/failedLane/)
  })

  it('halts at act when any lane failed or was blocked, not only when zero completed', () => {
    expect(goSource).toMatch(/actFailures\.length > 0[^\n]*\|\|[^\n]*actBlocked\.length > 0/)
  })

  it('does not record Act as a completed phase when it halted', () => {
    const haltIdx = goSource.indexOf("haltedAt = 'act'")
    const markIdx = goSource.indexOf("markPhaseComplete('act')")
    expect(haltIdx).toBeGreaterThan(-1)
    expect(markIdx).toBeGreaterThan(haltIdx)
    expect(goSource).toMatch(/else \{\s*await markPhaseComplete\('act'\)/)
  })
})

// ---------------------------------------------------------------------------
// markPhaseComplete must not believe a phase was recorded when
// `datum pipeline-state-save` refused it (verified:false, exit 1). It pushed
// the phase into the in-memory completedPhases BEFORE running the CLI and
// discarded the CLI output, so the orchestrator and the on-disk state
// disagreed (eedom run wf_2a5ede48-358: act-verify returned verified:false).
// ---------------------------------------------------------------------------

describe('markPhaseComplete honours pipeline-state-save refusals', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')
  const fn = goSource.slice(goSource.indexOf('async function markPhaseComplete'), goSource.indexOf('// New-epic detection'))

  it('runs pipeline-state-save as a batch step and reads the verdict from its exit code + JSON, not an LLM echo', () => {
    expect(fn).toMatch(/pipelineStateSaveSteps\(\{ phase: p, runId: resolvedRunId, route, testsPass \}\)/)
    expect(fn).toMatch(/pipelineStateSaveFromSteps\(parseBatchResult\(/)
    expect(fn).not.toMatch(/Run: datum pipeline-state-save/)
    expect(fn).not.toMatch(/\/"verified"/)
  })

  it('only records the phase in completedPhases after the CLI recorded it', () => {
    const pushIdx = fn.indexOf('completedPhases.push(p)')
    const verdictIdx = fn.indexOf('pipelineStateSaveFromSteps(')
    expect(verdictIdx).toBeGreaterThan(-1)
    expect(pushIdx).toBeGreaterThan(verdictIdx)
    expect(fn).toMatch(/if \(!saved\.recorded\) \{/)
  })

  it('logs the named reason (refused / unverified) and returns without recording', () => {
    expect(fn).toMatch(/log\(`\[warn\] \$\{saved\.reason\}/)
  })
})

describe('docs workflow result is consumed, not discarded', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('captures the datum-tdd-act-docs result and surfaces a refused docs commit', () => {
    expect(goSource).toMatch(/docs\w* = await workflow\(\s*\{ scriptPath: sk\('datum-tdd-act-docs'\) \}/)
    expect(goSource).toMatch(/docs[^\n]*committed === false|docs[^\n]*failure_reason/)
  })
})

// ---------------------------------------------------------------------------
// Preflight demands a robust .gitignore: every scratch path datum writes
// (.datum/worktrees, .datum/runs, .datum/skills, .datum/hooks, .temp) must be
// ignored, or generated files end up in `git add .`, collide with lane
// squash-merges and get blamed on agents. yolo auto-fixes; otherwise halt
// with the exact gaps before any agent burns tokens.
// ---------------------------------------------------------------------------

describe('preflight: gitignore check', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('runs datum gitignore-check in preflight, before auto-resume', () => {
    const idx = goSource.indexOf('datum gitignore-check')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(goSource.indexOf('// Auto-resume'))
  })

  it('auto-fixes in yolo mode and throws with the missing patterns otherwise', () => {
    expect(goSource).toMatch(/gitignore-check[^\n]*--fix/)
    expect(goSource).toMatch(/gitignore[\s\S]{0,600}throw new Error\([^)]*missing/)
  })
})

// ---------------------------------------------------------------------------
// The lane plan is never relayed through an LLM turn in any form. A
// datum-reader echo normalised "§4" to "§ 4" inside acceptance criteria
// (wf_6bfbd9f2-510, spec hashes changed, completed lanes re-ran); the base64
// chunk relay that replaced it was GENERATED by the runner past ~2.7 KB
// rather than copied (wf_5791e11f-693). The scheduler now runs on a compact
// digest (`datum lane-plan-digest`: topology, files, per-lane spec_hash)
// written to a file by the act-start batch and byte-verified (wc -c + git
// hash-object); each lane fetches its own full spec at intake.
// ---------------------------------------------------------------------------

describe('lane plan reaches the scheduler as a byte-verified digest, never an LLM echo', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('no longer imports or calls readLanePlanPrompt, a reader agent, or the chunk relay', () => {
    expect(goSource).not.toMatch(/readLanePlanPrompt/)
    expect(goSource).not.toMatch(/stageOpts\('reader'/)
    expect(goSource).not.toMatch(/contextChunkPlan|contextChunkSteps|contextAssembleChunks|verifyLanePlanShape/)
  })

  it('parses the digest from the act-start batch with lanePlanDigestFromSteps and halts on its named failures', () => {
    expect(goSource).toMatch(/const digestResult = lanePlanDigestFromSteps\(actStartResult, lanePlanPath\)/)
    expect(goSource).toMatch(/if \(!digestResult\.ok \|\| !digestResult\.digest\) throw new Error\(digestResult\.error\)/)
    expect(goSource).toMatch(/const lanePlan: LanePlanDigest = digestResult\.digest/)
  })

  it('compares prior markers against the digest spec_hash, not a TS hash of a relayed lane', () => {
    expect(goSource).not.toMatch(/laneSpecHash\(lanePlan\.lanes\[/)
    expect(goSource).toMatch(/digestSpecHash\(lanePlan, id\)/)
  })
})

// ---------------------------------------------------------------------------
// Gate failures halt in yolo too. yolo already passes --approve to every
// gate (skips only the human hold), so a gate that still fails is a real
// structural failure (schema, zero lanes, missing artifact) — continuing
// past it produced runs that "completed" on a broken plan. The `!yolo &&`
// guard dates from when the verdict was an LLM echo; it is now the CLI's
// exit code (shared/gate.ts). Properties' gatePassed was ignored entirely.
// ---------------------------------------------------------------------------

describe('gate failures halt datum-go regardless of yolo', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('refine, plan, properties, validate and review halt on !gatePassed without a !yolo guard', () => {
    for (const phase of ['refine', 'plan', 'properties', 'validate', 'review']) {
      const block = goSource.slice(goSource.indexOf(`if (shouldRun('${phase}'`), goSource.indexOf(`haltedAt = '${phase}'`) + 40)
      expect(block, phase).not.toMatch(/!yolo && !lastResult\.gatePassed/)
      expect(block, phase).toMatch(/!lastResult\.gatePassed/)
      expect(block, phase).toMatch(new RegExp(`haltedAt = '${phase}'`))
    }
  })
})

// ---------------------------------------------------------------------------
// #368 — `datum gate review` (datum/gate.py) is now a real, passable gate
// (epic-scoped REVIEW-REPORT.md, no review-packets/unified.json
// requirement). The Review block must halt in every mode when the gate
// itself fails, keep its own separate canMerge check (which yolo may
// bypass), and only mark the phase complete when BOTH hold.
// ---------------------------------------------------------------------------

describe('Review block — gatePassed and canMerge both gate markPhaseComplete (#368)', () => {
  const goSource = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')
  const reviewBlock = goSource.slice(
    goSource.indexOf("if (shouldRun('review'"),
    goSource.indexOf("// Closeout"),
  )

  it('halts on !gatePassed unconditionally (no !yolo guard), same as the other phases', () => {
    expect(reviewBlock).not.toMatch(/!yolo && !lastResult\.gatePassed/)
    expect(reviewBlock).toMatch(/!lastResult\.gatePassed/)
    expect(reviewBlock).toMatch(/haltedAt = 'review'/)
  })

  it('keeps the existing canMerge log, still guarded by !yolo', () => {
    expect(reviewBlock).toMatch(/!yolo && !lastResult\.canMerge/)
    expect(reviewBlock).toMatch(/critical issues/)
  })

  it('only calls markPhaseComplete when both gatePassed and canMerge hold', () => {
    const markIdx = reviewBlock.indexOf("markPhaseComplete('review')")
    expect(markIdx).toBeGreaterThan(-1)
    // markPhaseComplete must sit in the final `else` branch, after both the
    // !gatePassed and the !yolo && !canMerge halt checks.
    const gatePassedIdx = reviewBlock.indexOf('!lastResult.gatePassed')
    const canMergeIdx = reviewBlock.indexOf('!yolo && !lastResult.canMerge')
    expect(gatePassedIdx).toBeGreaterThan(-1)
    expect(canMergeIdx).toBeGreaterThan(gatePassedIdx)
    expect(markIdx).toBeGreaterThan(canMergeIdx)
  })
})

// ---------------------------------------------------------------------------
// FLOW.md design principle 2 — the preflight-tool-check and
// preflight-gitignore agent responses used to default to {ok: true} on an
// unparseable result, silently treating a garbled response as "the check
// passed" for exactly the two preflights that exist to catch a stale/
// misdirected `datum` binary (#327) and a scratch-path .gitignore gap. Both
// must throw instead of defaulting to ok:true.
// ---------------------------------------------------------------------------

describe('datum-go — preflight checks use the strict parser', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('imports parseAgentJsonStrict', () => {
    expect(src).toMatch(/import \{[^}]*parseAgentJsonStrict[^}]*\} from '\.\/shared\/utils'/)
  })

  it('preflight-tool-check is parsed with parseAgentJsonStrict, not a lenient {ok:true} default', () => {
    expect(src).toMatch(/const toolCheck = parseAgentJsonStrict\(toolCheckText as string, 'preflight-tool-check'\)/)
  })

  it('preflight-gitignore is parsed with parseAgentJsonStrict, not a lenient {ok:true} default', () => {
    expect(src).toMatch(/const gitignoreCheck = parseAgentJsonStrict\(gitignoreText as string, 'preflight-gitignore'\)/)
  })
})

// ---------------------------------------------------------------------------
// A thrown child workflow (e.g. a parseAgentJsonStrict failure inside
// Refine/Plan/Review/Closeout) must not crash datum-go with no halt record
// and no summary — the exact regression already hit once for the docs child
// (wf_b1c88e09-036). Refine/Plan/Review route through the shared
// runPhaseWorkflow helper, which folds a thrown error into the existing
// gate-halt path; Closeout has no gate field so it gets its own try/catch.
// ---------------------------------------------------------------------------

describe('datum-go — child phase workflow failures are caught and halted, not left to crash the pipeline', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('defines runPhaseWorkflow wrapping workflow() in try/catch', () => {
    const fnIdx = src.indexOf('async function runPhaseWorkflow')
    expect(fnIdx).toBeGreaterThan(-1)
    const fnBody = src.slice(fnIdx, fnIdx + 500)
    expect(fnBody).toMatch(/try \{/)
    expect(fnBody).toMatch(/await workflow\(/)
    expect(fnBody).toMatch(/catch \(exc\)/)
    expect(fnBody).toMatch(/gatePassed: false/)
  })

  it('Refine, Plan and Review all call runPhaseWorkflow instead of a bare workflow() await', () => {
    expect(src).toMatch(/lastResult = await runPhaseWorkflow\(sk\('datum-refine'\), phaseArgs, 'refine'\)/)
    expect(src).toMatch(/lastResult = await runPhaseWorkflow\(sk\('datum-plan'\), phaseArgs, 'plan'\)/)
    expect(src).toMatch(/lastResult = await runPhaseWorkflow\(sk\('datum-review'\), phaseArgs, 'review'\)/)
  })

  it('Closeout has no gate field to fold into, so it wraps its own workflow() call in try/catch and halts explicitly', () => {
    const closeoutIdx = src.indexOf("shouldRun('closeout', 6)")
    const block = src.slice(closeoutIdx, closeoutIdx + 900)
    expect(block).toMatch(/try \{/)
    expect(block).toMatch(/await workflow\(\s*\{ scriptPath: sk\('datum-closeout'\) \}/)
    expect(block).toMatch(/\} catch \(exc\) \{/)
    expect(block).toMatch(/haltedAt = 'closeout'/)
  })
})

// ---------------------------------------------------------------------------
// FLOW.md §5 open item 3: the inline Act phase (actStartSteps, the chunked
// lane-plan relay, verifyLanePlanShape, the setup/lane/merge batch loop, docs,
// triage) runs inline in datum-go rather than through runPhaseWorkflow. A
// throw anywhere in there (lane_plan_relay_mismatch, context_relay_mismatch,
// a setup/lane/merge child throwing) used to end the whole workflow with an
// uncaught exception: no Act summary, no halt record, haltedAt unset, and
// pipeline-state left as it was. It must halt exactly like a failed lane
// does — same haltedAt = 'act', Act NOT marked complete — instead of crashing.
// ---------------------------------------------------------------------------

describe('datum-go — a throw inside the inline Act phase halts like a failed lane, not an uncaught exception', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')
  const actIdx = src.indexOf("shouldRun('act', 3)) {")
  const actEndIdx = src.indexOf("} else if (activePhases.includes('act' as Phase))")
  const actBlock = src.slice(actIdx, actEndIdx)

  it('wraps the Act body in a try/catch', () => {
    expect(actIdx).toBeGreaterThan(-1)
    expect(actEndIdx).toBeGreaterThan(actIdx)
    expect(actBlock).toMatch(/try \{/)
    expect(actBlock).toMatch(/\} catch \(exc\) \{/)
  })

  it('the catch logs act_phase_failed with the thrown message', () => {
    const catchIdx = actBlock.lastIndexOf('} catch (exc) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBody = actBlock.slice(catchIdx)
    expect(catchBody).toMatch(/act_phase_failed/)
    expect(catchBody).toMatch(/\(exc as Error\)\.message/)
  })

  it('the catch sets haltedAt = \'act\', the same identifier a failed lane halt uses, and does not call markPhaseComplete(\'act\')', () => {
    const catchIdx = actBlock.lastIndexOf('} catch (exc) {')
    const catchBody = actBlock.slice(catchIdx)
    expect(catchBody).toMatch(/haltedAt = 'act'/)
    expect(catchBody).not.toMatch(/markPhaseComplete\('act'\)/)
  })

  it('the catch sets lastResult carrying failed/failedLanes/error, the same shape the Act summary already reports', () => {
    const catchIdx = actBlock.lastIndexOf('} catch (exc) {')
    const catchBody = actBlock.slice(catchIdx)
    expect(catchBody).toMatch(/lastResult = \{[^}]*failed:[^}]*failedLanes:[^}]*\}/s)
  })

  it('the catch does not re-throw — the run must fall through to the normal halt reporting below', () => {
    const catchIdx = actBlock.lastIndexOf('} catch (exc) {')
    const catchBody = actBlock.slice(catchIdx)
    expect(catchBody).not.toMatch(/\bthrow\b/)
  })

  // Coarse guard, not a full parser: flags any `throw new Error` or bare
  // `throw` between the act-start batch and the end of the Act block that
  // sits OUTSIDE the try/catch — i.e. before the try opens or after the
  // catch closes. It cannot detect a throw nested inside a callback or a
  // helper defined elsewhere; it is only meant to catch the case this test
  // suite exists for (a throw statement written directly in the Act body).
  it('no throw remains in the Act block outside the try/catch', () => {
    const tryIdx = actBlock.indexOf('try {')
    const catchIdx = actBlock.lastIndexOf('} catch (exc) {')
    const catchCloseIdx = actBlock.lastIndexOf('}')
    expect(tryIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(tryIdx)
    const before = actBlock.slice(0, tryIdx)
    const after = actBlock.slice(catchCloseIdx + 1)
    expect(before).not.toMatch(/\bthrow\b/)
    expect(after).not.toMatch(/\bthrow\b/)
  })
})

// Phase review wf_9a69f891-462: a typo or case mismatch in args.phases
// silently dropped the phase and the pipeline continued as if it ran.
describe('datum-go — args.phases is validated against the known phases', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')
  it('throws invalid_phase naming the unknown entry, and lower-cases the rest', () => {
    expect(src).toMatch(/const activePhases: Phase\[\] = [\s\S]{0,400}invalid_phase:/)
    expect(src).toMatch(/\.map\(\(p\) => String\(p\)\.toLowerCase\(\)\)/)
  })
})
