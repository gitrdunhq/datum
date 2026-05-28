# Diagram Legibility & Layout Guide

Mermaid renders in a fixed viewport. A diagram that looks clean at 8 nodes becomes illegible at 20 — nodes compress, labels truncate, edges cross. The fix is structural: break large diagrams into a hierarchy of smaller, focused ones, and choose layout direction intentionally.

## When to Split

Split when ANY of these apply:

| Signal | Threshold | Action |
|--------|-----------|--------|
| Node count | > 12 | Split into Overview + Detail layers |
| Edge crossings | > 3 visible | Flip layout direction first, then split |
| Subgraph nesting | > 2 levels | Extract deepest subgraph as its own diagram |
| Hub node connections | > 4 edges from one node | Give that node its own detail diagram |
| Label truncation | Any label gets cut | Diagram is too compressed — split or flip direction |

## The Overview → Detail Pattern

Every complex system gets two layers:

1. **Overview** (max 8 nodes) — the 30,000-foot view. Shows main components and primary relationships only. No internal details.
2. **Detail diagrams** — one per major component or concern. Shows the internals.

Label each overview node with its detail diagram filename so readers can navigate.

```mermaid
graph LR
    User[👤 User] --> LB[🌐 Load Balancer<br/>see: 02-lb-detail]
    LB --> API[⚙️ API Gateway<br/>see: 03-api-detail]
    API --> Auth[🔐 Auth Service<br/>see: 04-auth-detail]
    API --> Orders[📋 Order Service<br/>see: 05-orders-detail]
    API --> Payments[💰 Payment Service<br/>see: 06-payments-detail]
```

## Layout Direction Selection

The content should drive the direction, not the other way around. When edges are crossing frequently, changing direction often resolves 80% of the visual noise before any restructuring is needed.

| Content type | Direction | Why |
|---|---|---|
| Process flows, state machines | `TD` | Time flows downward; mirrors natural reading of sequences |
| Pipelines, data flows | `LR` | Matches the input → transform → output mental model |
| Organizational hierarchies | `TB` | Root at top; matches org chart conventions |
| Side-by-side comparisons | `LR` | Items align horizontally for easy scanning |
| API call sequences | Use sequence diagram | Mermaid sequence diagrams handle back-and-forth better than flowcharts |

You can also set direction per subgraph — `direction LR` inside a `TD` parent is useful for horizontal steps within a vertical flow:

```mermaid
flowchart TD
    subgraph Pipeline
        direction LR
        A[📥 Ingest] --> B[⚙️ Transform] --> C[📤 Load]
    end
    Pipeline --> Monitor[📊 Monitor]
```

## Subgraph Rules

- **Group by boundary**: deploy boundary, trust boundary, team ownership, or lifecycle phase
- **Max 6–7 nodes per subgraph** — beyond this, either nest a subgraph or split into a separate diagram
- **Max 2 nesting levels** — a third level of nesting is always harder to read than a separate diagram
- **Name subgraphs clearly** — the subgraph label is the first thing the reader sees; make it unambiguous

```mermaid
graph TB
    subgraph "🌐 Public Layer"
        direction LR
        CDN[☁️ CDN] --> LB[🌐 Load Balancer]
    end
    subgraph "⚙️ Application Layer"
        direction LR
        API[⚙️ API] --> Cache[⚡ Redis]
        API --> Worker[🔄 Worker]
    end
    subgraph "💾 Data Layer"
        direction LR
        DB[(💾 Postgres)] --- Archive[🧊 Archive]
    end
    LB --> API
    API --> DB
```

## Node Design for Readability

- **Label length**: 3–4 words max. Break longer labels with `<br/>`
- **Shapes carry meaning** — use them consistently:

| Shape | Syntax | Use for |
|-------|--------|---------|
| Rectangle | `[Label]` | Process, service, action |
| Round rect | `(Label)` | Start/end terminal |
| Diamond | `{Label}` | Decision, condition |
| Cylinder | `[(Label)]` | Database, storage |
| Circle | `((Label))` | Event, trigger |
| Stadium | `([Label])` | Subprocess, named flow |

- **Avoid abbreviations** unless universal in the domain — `Auth Svc` saves 3 characters but loses clarity for anyone outside the team

## Edge Reduction Techniques

Before restructuring, ask whether an edge can be implied by position:

1. **Sequential nodes** — if A always flows to B, layout adjacency makes the arrow obvious; the edge is noise
2. **Bidirectional flows** (A ↔ B) in a flowchart — this is usually a sequence diagram in disguise; switch diagram types
3. **Hub nodes** (6+ connections from one node) — the hub needs its own detail diagram; the overview just shows it as a single box

## Splitting a Large Diagram: Before and After

**Before** — 18-node monolith, unreadable:

```mermaid
graph TB
    User --> LB --> API --> Auth --> UserDB
    API --> Orders --> OrderDB
    API --> Payments --> PayGW --> Stripe
    Orders --> Queue --> Notifier --> Email --> SMTP
    Notifier --> SMS --> Twilio
    API --> Cache
    Auth --> Cache
```

**After** — 3 diagrams, each readable:

**Diagram 1 — System Overview (6 nodes):**
```mermaid
graph LR
    User[👤 User] --> API[⚙️ API Gateway]
    API --> Auth[🔐 Auth]
    API --> Orders[📋 Orders + Notify]
    API --> Payments[💰 Payments]
```

**Diagram 2 — Orders & Notifications:**
```mermaid
graph TD
    subgraph "📋 Order Flow"
        direction LR
        API[⚙️ API] --> Orders[📋 Order Svc]
        Orders --> OrderDB[(💾 Orders DB)]
    end
    subgraph "📨 Notification Flow"
        direction LR
        Orders --> Queue[📬 Queue]
        Queue --> Notifier[🔄 Notifier]
        Notifier --> Email[📧 Email Svc]
        Notifier --> SMS[📲 SMS Svc]
    end
```

**Diagram 3 — Payments & Auth:**
```mermaid
graph TD
    subgraph "💰 Payment Flow"
        direction LR
        API[⚙️ API] --> PaySvc[💰 Payment Svc]
        PaySvc --> PayGW[🔌 Gateway]
        PayGW --> Stripe[☁️ Stripe]
    end
    subgraph "🔐 Auth Flow"
        direction LR
        API --> Auth[🔐 Auth Svc]
        Auth --> UserDB[(💾 Users DB)]
        Auth --> Cache[⚡ Cache]
    end
```

## Linking Diagrams Together (The Puzzle-Piece Pattern)

Mermaid has no native `include` or embed, but two features combine to give you navigable, drill-down diagrams.

### Option A: `click href` — any node, any diagram type

Turn any node into a link to its detail diagram. Works in GitHub wikis, GitLab, Obsidian, MkDocs, Notion, and any renderer that enables Mermaid interactions.

```mermaid
graph LR
    User[👤 User] --> API[⚙️ API Gateway]
    API --> Auth[🔐 Auth Service]
    API --> Orders[📋 Order Service]
    API --> Payments[💰 Payment Service]

    click Auth "diagrams/auth-detail.md" "Drill into Auth Service"
    click Orders "diagrams/orders-detail.md" "Drill into Order Service"
    click Payments "diagrams/payments-detail.md" "Drill into Payment Service"
```

Each overview box is a clickable entry point. The detail diagram can itself have `click href` links going deeper. This is the literal puzzle-piece pattern — overview → detail → sub-detail.

**Tooltip syntax variants:**
```
click NodeId "url"                          # basic link
click NodeId "url" "tooltip text"           # with hover tooltip
click NodeId "url" "tooltip text" _blank    # opens in new tab
click NodeId href "url" "tooltip"           # class diagram syntax
```

### Option B: C4 Diagrams — Mermaid's built-in drill-down model

C4 is a first-class Mermaid diagram type designed specifically for hierarchical decomposition. The three levels map directly to "puzzle pieces":

| Level | Syntax | Shows |
|-------|--------|-------|
| Context | `C4Context` | System and its users/external dependencies |
| Container | `C4Container` | Internal apps, databases, services |
| Component | `C4Component` | Code-level components inside one container |

**C4Context (overview — the outer puzzle):**
```mermaid
C4Context
    title Internet Banking — System Context
    Person(customer, "Banking Customer", "Has personal bank accounts")
    System(banking, "Internet Banking System", "View accounts, make payments")
    System_Ext(email, "E-mail System", "Sends confirmation emails")
    System_Ext(mainframe, "Mainframe Banking", "Core banking data")

    Rel(customer, banking, "Uses")
    Rel(banking, email, "Sends emails via", "SMTP")
    Rel(banking, mainframe, "Reads/writes", "XML/HTTPS")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

**C4Container (drill into the system — inner puzzle pieces):**
```mermaid
C4Container
    title Internet Banking — Container Diagram
    Person(customer, "Banking Customer")
    Container_Boundary(banking, "Internet Banking System") {
        Container(spa, "Single Page App", "React", "Customer-facing UI")
        Container(api, "API Application", "Node.js", "Business logic")
        ContainerDb(db, "Database", "PostgreSQL", "Accounts, transactions")
    }
    System_Ext(mainframe, "Mainframe Banking")

    Rel(customer, spa, "Uses", "HTTPS")
    Rel(spa, api, "Calls", "JSON/HTTPS")
    Rel(api, db, "Reads/writes", "SQL")
    Rel(api, mainframe, "Uses", "XML/HTTPS")
```

**Use C4 when:** the system has clear architectural layers (user-facing → services → data). Use `click href` when you're decomposing a single large flowchart or deployment diagram into focused sub-diagrams.

## Per-Diagram Config with `%%{init}%%`

Add an `%%{init}%%` directive as the first line of any diagram to control rendering without needing external CSS or Typora settings. This is standard Mermaid — works in GitHub, Obsidian, MkDocs, VS Code, and Typora alike.

### Flowchart curve (biggest legibility win)

`basis` curves smooth out edges so they naturally separate from each other. In a dense diagram, switching from the default `linear` to `basis` can eliminate most of the visual crossing noise without changing any node layout.

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}}}%%
graph LR
    A[⚙️ Auth] --> B[💾 UserDB]
    A --> C[⚡ Cache]
    D[⚙️ Orders] --> B
    D --> E[📬 Queue]
```

| Curve | Shape | Best for |
|-------|-------|----------|
| `linear` | Straight lines | Simple, small diagrams |
| `basis` | Smooth splines | Dense diagrams with many edges — **default recommendation** |
| `natural` | Natural splines | Medium complexity |
| `step` | Right-angle steps | Hierarchies, org charts, decision trees |

### Theme (per diagram)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#90EE90', 'primaryTextColor': '#1a3300', 'lineColor': '#333'}}}%%
graph TD
    A[Start] --> B[Process] --> C[End]
```

Available themes: `base`, `default`, `dark`, `forest`, `neutral`, `night`

Use `base` + `themeVariables` when you need precise color control without `classDef` on every node.

### Sequence auto-numbering

```mermaid
%%{init: {'sequence': {'showSequenceNumbers': true}}}%%
sequenceDiagram
    Client->>API: Request
    API->>DB: Query
    DB-->>API: Result
    API-->>Client: Response
```

## Mindmap — Use Instead of Deep Flowcharts

When information is hierarchical (concepts branching into sub-concepts, feature trees, knowledge maps), a mindmap is almost always more readable than a flowchart. It uses a radial tree layout designed for exactly this shape of data.

```mermaid
mindmap
  root((🏗️ API Gateway))
    Auth
      JWT Validation
      OAuth2 Flow
      Rate Limiting
    Routing
      Load Balancing
      Circuit Breaker
      Retry Policy
    Observability
      📝 Logging
      📊 Metrics
      🚨 Alerting
```

**Use mindmap instead of flowchart when:**
- The diagram would have more than 3 levels of nesting
- Information is purely hierarchical (no cross-connections needed)
- You're mapping concepts, features, or a knowledge domain
- The flowchart version would require more than 15 nodes

**Mindmap syntax rules:**
- Indentation = hierarchy level
- `root((text))` for the center node (circle)
- `[text]` for rectangular nodes, `(text)` for rounded, `((text))` for circle
- No arrows — structure is implied by indentation

## Invisible Spacer Nodes (Last Resort)

When Mermaid compresses nodes and labels overlap, invisible spacers can force breathing room — but this is a workaround, not a design choice. If spacers are needed, the diagram should be split instead.

```mermaid
graph TB
    A[Real Node A] --> _spacer1[ ]
    _spacer1 --> B[Real Node B]
    style _spacer1 fill:none,stroke:none,color:none
```

## Quick Decision Checklist

Before finalizing any diagram:

- [ ] Node count ≤ 12?
- [ ] Edge crossings ≤ 3?
- [ ] Subgraph nesting ≤ 2 levels?
- [ ] No hub node with > 4 connections?
- [ ] Labels visible without truncation?
- [ ] Layout direction matches data flow direction?
- [ ] Each subgraph has a clear, unambiguous name?

If any box is unchecked, apply the relevant technique from this guide before saving.
