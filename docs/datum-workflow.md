# DATUM Workflow

## Pipeline Overview

```mermaid
flowchart TD
    %% ── Node Declarations ──
    Start(["⚡ datum go"])
    BranchCheck{"🔐 On main/master?"}
    CreateBranch["🔀 Create datum/epic-N branch"]
    SelfCheck["🧪 Self-Check Contracts"]
    HaltCheck["❌ HARD STOP — Assets Drifted"]
    ReadState["💾 Read State + Detect Language"]

    DetectEntry{"📋 Detect Entry Point"}
    OfferInit["⚙️ Offer datum init"]

    Refine["📝 Refine — TICKET to SPEC + QUESTIONS.md"]
    RefineGate{"🔐 Refine Gate"}
    Classify{"📊 Classify — Patch/Feature/System"}

    Plan["📋 Plan — SPEC to TASKS (+ units for System)"]
    PlanGate{"🔐 Plan Gate + Overconfidence Check"}

    Triage{"📊 Triage — Deepen or Skip?"}
    Deepen["🔍 Deepen — Codebase Evidence Gathering"]

    Properties["🛡️ Properties — SAFETY, LIVENESS, INVARIANT"]
    Architect["🏗️ Architect Gate — ADR + C4"]

    Act["⚙️ Act — Red-Green-Refactor"]

    Validate["🧪 Validate — Full Test Suite"]
    Review["🔍 Review — Multi-Domain"]
    CreatePR["📤 Create PR"]

    MergeGate{"🔐 Merge — ALWAYS required"}
    PRComments["💬 PR Comments — Triage + Fix"]
    Merged["✅ PR Merged"]

    Closeout["📊 Closeout — Retro + Tag"]
    Done(["✅ Done"])

    %% ── Flow ──
    Start --> BranchCheck
    BranchCheck -->|Yes| CreateBranch --> SelfCheck
    BranchCheck -->|No| SelfCheck
    SelfCheck -->|Fail| HaltCheck
    SelfCheck -->|Pass| ReadState
    ReadState --> DetectEntry

    DetectEntry -->|"TICKET.md found"| Refine
    DetectEntry -->|"SPEC.md found"| Plan
    DetectEntry -->|"TASKS.md found"| Act
    DetectEntry -->|"PR URL"| PRComments
    DetectEntry -->|"Nothing"| OfferInit

    Refine --> RefineGate
    RefineGate -->|Pass| Classify --> Plan
    RefineGate -->|"Gaps found"| Refine

    Plan --> PlanGate
    PlanGate -->|Approved| Triage
    PlanGate -->|Rejected| Plan

    Triage -->|"Complex"| Deepen --> Properties
    Triage -->|"Trivial"| Properties

    Properties --> Architect --> Act

    Act --> Validate --> Review --> CreatePR --> MergeGate
    MergeGate -->|Approved| Merged
    MergeGate -->|"Comments"| PRComments
    PRComments --> MergeGate

    Merged --> Closeout --> Done

    %% ── Styles ──
    classDef startEnd fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    classDef gate fill:#FFD700,stroke:#B8860B,stroke-width:2px,color:black
    classDef phase fill:#90EE90,stroke:#2E7D2E,stroke-width:2px,color:darkgreen
    classDef error fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef neutral fill:#F0F0F0,stroke:#000,stroke-width:2px,color:black

    class Start,Done startEnd
    class BranchCheck,DetectEntry,RefineGate,Classify,PlanGate,Triage,MergeGate gate
    class Refine,Plan,Deepen,Properties,Architect,Act,Validate,Review,CreatePR,PRComments,Closeout,Merged phase
    class HaltCheck error
    class SelfCheck,ReadState,CreateBranch,OfferInit neutral
```

## Act Phase Detail — Per-Lane Pipeline

```mermaid
flowchart TD
    %% ── Node Declarations ──
    ActStart(["⚡ Act Phase Begins"])
    StartQueue["⚙️ Start Commit Queue"]
    StartDrift["🔍 Start Spec Drift Detector"]

    Skeleton["🏗️ Skeleton Preflight — Generate Test Scaffolding"]
    Red["🔴 RED Agent — Write Failing Tests Only"]
    Green["🟢 GREEN Agent — Make Tests Pass"]
    Refactor["🔵 REFACTOR Agent — Clean Up + Proof-of-Work"]
    Adversarial["🟡 Adversarial Agent — Try to Break It"]

    LaneDone["✅ Lane Complete — Commit"]

    FailCheck{"❌ Lane Failed?"}
    Classify["📊 Classify Failure"]
    EnvFix["🔧 ENVIRONMENTAL — Fix in Place"]
    RetryLadder["🔄 REASONING — Retry Ladder"]
    HardStop["🚨 HARD STOP — Surface to Human"]
    Exhausted["⏹️ 3x Exhausted — Human Decides"]

    SecSidecar["🛡️ datum-security Sidecar — STRIDE + Secrets"]
    DocSidecar["📝 datum-docs Sidecar — Inline Docs"]

    AllDone(["✅ All Lanes Complete"])

    %% ── Main Lane Flow ──
    ActStart --> StartQueue & StartDrift
    StartQueue --> Skeleton
    Skeleton --> Red --> Green --> Refactor --> Adversarial
    Adversarial --> LaneDone

    %% ── Failure Handling ──
    Red & Green & Refactor -.-> FailCheck
    FailCheck -->|Yes| Classify
    Classify -->|ENV| EnvFix -->|"Retry, counter unchanged"| Red
    Classify -->|REASONING| RetryLadder -->|"Retry budget left"| Red
    Classify -->|HARD_STOP| HardStop
    RetryLadder -->|"3x exhausted"| Exhausted

    %% ── Sidecars ──
    StartDrift -.-> SecSidecar & DocSidecar

    LaneDone --> AllDone

    %% ── Styles ──
    classDef startEnd fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
    classDef red fill:#ffc9c9,stroke:#e03131,stroke-width:2px,color:darkred
    classDef green fill:#b2f2bb,stroke:#2f9e44,stroke-width:2px,color:darkgreen
    classDef blue fill:#a5d8ff,stroke:#1971c2,stroke-width:2px,color:darkblue
    classDef yellow fill:#FFD700,stroke:#B8860B,stroke-width:2px,color:black
    classDef error fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
    classDef sidecar fill:#d0bfff,stroke:#7048e8,stroke-width:2px,color:darkblue
    classDef neutral fill:#F0F0F0,stroke:#000,stroke-width:2px,color:black

    class ActStart,AllDone startEnd
    class Red red
    class Green,LaneDone green
    class Refactor,Skeleton blue
    class Adversarial yellow
    class FailCheck,HardStop,Exhausted error
    class SecSidecar,DocSidecar sidecar
    class StartQueue,StartDrift,Classify,EnvFix,RetryLadder neutral
```

## Phase Summary

| Phase | Input | Output | Gate |
|-------|-------|--------|------|
| **Branch Guard** | Current branch | Feature branch `datum/epic-N` (auto-incremented) | Hard — auto-creates branch |
| **Discovery** | CURRENT_STATE.md | Orientation context + `docs/LANDSCAPE.md` (optional) | — |
| **Refine** | `docs/epics/$BRANCH/TICKET.md` | `SPEC.md` (with Assumption Audit + Classification Metadata) + `QUESTIONS.md` | Skippable in yolo |
| **Classify** | SPEC.md Classification Metadata | Pipeline shape: Patch→Express, Feature→Standard, System→Extended | Auto (user override at Plan gate) |
| **Plan** | SPEC.md | `TASKS.md` + `tasks.json` + `lane-plan.json` (+ units for System-tier) | **Always required** + overconfidence gate |
| **Triage** | TASKS.md | `.datum/routing.json` (`deepen` or `properties`) | **Always required** — never skipped |
| **Deepen** | TASKS.md + codebase (GitNexus-first) | `## Research Findings` appended to TASKS.md | Skipped if Triage routes to `properties` |
| **Properties** | SPEC + TASKS (+ findings if deepened) | `docs/epics/$BRANCH/PROPERTIES.md` | Skippable in yolo (skipped for Patch tier) |
| **Architect** | Properties | ADRs + C4 diagrams | Blocks if significant decisions lack ADRs |
| **Act** | TASKS + PROPERTIES | Committed code per lane | Retry ladder per lane |
| **Validate** | All lanes complete | Test results | Skippable in yolo |
| **Review** | Test-passing code | Review packets | Max 3 satisfaction iterations |
| **PR + Merge** | Review-passing code | Merged PR | **Always required** |
| **PR Comments** | PR feedback | Addressed comments | Re-validates after fixes |
| **Closeout** | Merged PR | RETRO.md + git tag + solutions | Automatic |
