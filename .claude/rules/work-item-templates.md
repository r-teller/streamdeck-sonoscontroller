# Work Item Templates

Purpose: Standardized templates for feature, bug, chore, epic, and decision (spike) work items. Each section has a **contract** defining its purpose, required content, what's "not sufficient", and a concrete example. Templates must be filled before an item can reach `triage:ready`.

> **Terminology for this project:**
> "Work item" / "item" throughout this file refers to a **bead** — managed via the beads (`bd`) CLI.
>
> The classification framework (cynefin, sizing, persona, readiness) and templates are universal. Where commands or behavior differ between beads and a no-tracker setup, this file uses `<!-- tracker:beads -->` / `<!-- tracker:none -->` blocks. The bootstrap script strips the inactive blocks during project setup.

---

## Type Classification Guide

Every work item must have a type assigned during triage. The `task` type is for quick capture only — all items should be reclassified before reaching `triage:ready`.

| Type | When to Use | Template | Example |
|------|-------------|----------|---------|
| **feature** | Adds new user-facing capability | Small/Medium/Large | Add search filters, notification center |
| **bug** | Fixes broken behavior | Bug | Null pointer in list endpoint |
| **chore** | Maintenance: setup, config, tests, upgrades, refactors, audits | Chore | Upgrade dependency CVE, add CI pipeline, add unit tests |
| **epic** | Groups related items into a cohesive deliverable | Epic | Epic: User Dashboard |
| **decision** | Investigates architectural uncertainty, produces recommendation (spike) | Decision (Spike) | Evaluate caching strategy, auth provider selection |
| **task** | Quick capture only — reclassify during triage | None | quick capture (`bd todo add "..."` for beads, or a brief note in handoff.yaml for none) |

**Triage rule:** No item should remain `type: task` after triage. Reclassify to feature, bug, chore, or decision based on the work involved. If it produces a deliverable the user sees, it's a feature. If it fixes something broken, it's a bug. If it's maintenance or operational work, it's a chore. If it investigates an open question and produces a recommendation, it's a decision.

---

## Size Classification Guide

| Tier | Scope | Typical Turns | File Count | Examples |
|------|-------|---------------|------------|----------|
| **Small** | Single layer (backend OR frontend), no new models | ~10-25 | 1-3 | Add field to existing model, new enum value, schema fix, single GET endpoint, UI tweak with API call |
| **Medium** | Two layers (e.g. backend + frontend, or model + API), may have migration | ~25-60 | 4-10 | New CRUD endpoint set, new UI component with API client, new model + service + routes |
| **Large** | Full stack (model + migration + API + frontend + integration), new entity | ~50-120 | 10+ | New entity with CRUD + page, multi-model feature with UI, new pipeline stage end-to-end |

**Feature sizing:** Count layers touched (data model, API, frontend). 1 = small, 2 = medium, 3+ = large. When in doubt, size up.

**Cross-cutting exception:** Changes that touch shared infrastructure (auth middleware, event bus, schema registries, plugin systems) always size as Medium+ due to contract dependencies.

**Decomposition rule:** If estimated turns exceed 120 or file count exceeds 20, the item **must** be decomposed into smaller items under an epic before implementation. A single item should represent work completable in one focused session. Use the Epic template to create the parent, then create child items at Small/Medium/Large size. If scope is uncertain, create a Spike first to de-risk before decomposing.

**Label requirement:** Every work item must have a `size:small`, `size:medium`, or `size:large` label.

Apply via `bd label add <id> size:<tier>`.

This enables filtering and effort reporting.

---

## Persona Definitions

Every work item must identify its intended audience. This drives acceptance criteria framing, UAT scenarios, and enables filtering via `persona:*` labels.

| Persona | Slug (for labels) | Description |
|---------|--------------------|-------------|
| **End User** | `persona:end-user` | The person using the product to accomplish their goals. |
| **Administrator** | `persona:administrator` | Manages the platform — security, configuration, compliance. |
| **System** | `persona:system` | No human actor — automated processes, background jobs, pipeline. |
| **Developer** | `persona:developer` | The contributor — tooling, CI/CD, DX, infrastructure. |
| **API Consumer** | `persona:api-consumer` | External integrator using the API programmatically. |

**Rules:**
- Every work item gets 1+ `persona:*` labels matching the audiences above
- Primary persona listed first in the description section
- Each persona listed must have at least one AC item under its heading
- System-only items (pipeline/infra) use `System` or `Developer`

---

## Cynefin Domain Classification (Agentic Execution Context)

Every work item must be classified into a Cynefin domain during triage. In an agentic development context, domains map to **specification completeness, unknowns, blast radius, and scope of change** rather than organizational complexity. The classification drives how much guardrailing an item needs before an agent session can safely execute it.

The purpose of classification is not descriptive. It is operational: it defines what kind of execution is safe.

### Fast Path

Use this shorthand first:

- **Disorder**: The item does not contain enough detail to classify safely. Enrich first.
- **Clear**: Spec is complete, path is known, one existing pattern applies, and wrong output is quickly caught.
- **Complicated**: Spec is complete, but safe execution requires significant context loading or expert pattern matching.
- **Complex**: Known unknowns exist. The item must produce findings that reshape downstream work.
- **Chaotic**: Unknowns or wrong assumptions would create high-blast-radius damage. Decompose before execution.

### Domain Definitions

| Domain | Slug | Agent Interpretation | Response Model |
|--------|------|---------------------|----------------|
| **Clear** | `cynefin:clear` | Spec is complete. Agent follows one established pattern. No material design decisions remain. Wrong output is quickly caught by tests, lint, or obvious review. | Execute directly. No exploration needed. |
| **Complicated** | `cynefin:complicated` | Spec is complete, but safe execution requires loading substantial context across multiple files, layers, or contracts before acting. The path is knowable, but not obvious. | Read context first, then execute safely. Agent must understand all referenced files before editing any. |
| **Complex** | `cynefin:complex` | **Known unknowns exist.** The item cannot be completed safely without first producing findings, validating assumptions, or resolving an open decision. Those findings may reshape downstream items. | Probe first, capture findings, then re-scope or decompose. Primary output is findings, validated assumptions, or a branch-level prototype. |
| **Chaotic** | `cynefin:chaotic` | **Wrong assumptions would create high-blast-radius damage**, or the execution surface is too wide for safe single-pass agent execution. The danger is not urgency; it is an agent confidently acting on a flawed mental model where recovery is expensive. | Do not assign to an unsupervised agent session. Decompose before execution (see Chaotic Response Model below). |
| **Disorder** | `cynefin:disorder` | The item cannot be classified because it lacks enough detail. An agent session would fill gaps with hallucinated assumptions. This is the most dangerous state because it can look ready while being under-specified. | Block from execution. Enrich until classifiable. Cannot advance past `triage:backlog`. |

### Clear with Contract Risk

Some items are mechanically simple but touch shared contracts: migrations, CHECK constraints, shared types, route signatures, protocol definitions, or base classes.

These remain `cynefin:clear` **only if every contract value and required literal is explicitly spelled out in the item description** — the agent is copying, not deciding.

They become `cynefin:complicated` when the agent must derive contract details from surrounding code, docs, or behavior.

### Classification Decision Tree

**Precedence:**
1. Disorder overrides all — if the item lacks enough detail to classify, stop here.
2. If unresolved upstream findings are required, do not classify as Clear or Complicated.
3. Complex overrides the blast-radius matrix when known unknowns exist.
4. Use blast radius to distinguish Clear / Complicated / Chaotic only after the above are ruled out.

Apply in order. Stop at the first match:

1. **Can you identify specific gaps in the description that the agent would need to invent answers for?** If you can't tell → `disorder`. If no gaps, continue to Q3.
2. **Does the item depend on upstream findings (spike, decision, research item) that haven't been captured yet?** Check for phrases like:
   - "depends on spike"
   - "per investigation"
   - "TBD after research"
   - "after decision item closes"
   - "based on findings from X"
   If yes AND the upstream is still open → the item cannot be classified as `cynefin:clear` or `cynefin:complicated`. Classify as if the dependent sections were blank. A detailed spec built on unresolved assumptions is not a detailed spec. Findings captured in upstream comments or descriptions do not satisfy this check — they must be copied into *this* item's description or explicitly stubbed with bounded assumptions. The test is: can a fresh session classify this item without reading any other item?
3. **If the agent guesses wrong on any gaps, does the damage cascade?** (Bad migration, broken shared contract, roughly 3+ downstream items affected, irreversible external state) → `chaotic`. Decompose or add human gate.
4. **Do the gaps require producing findings that reshape other items?** (Format discovery, architectural decision, approach evaluation) → `complex`. Must use spike/decision template or have explicit fallback plan.
5. **Is the spec complete but requires loading significant context (roughly 5+ files, cross-layer contracts, pattern matching against reference implementations) before the agent can execute safely?** → `complicated`.
6. **Can a fresh agent session execute this cold from the item's description alone, following one existing pattern, with wrong output caught by tests and rollback trivial?** → `clear`.

### Blast Radius Assessment

The key distinction between Complicated and Chaotic is not effort. It is **cost of being wrong**.

Assess blast radius using two dimensions: cascade scope AND change surface area.

**Contract-bearing files** are files that define an interface consumed by other code: migrations, schemas, protocol/base classes, API route signatures, shared type definitions. Stub files, test files, documentation, and seed content are **non-contract** and don't count toward the matrix. When in doubt, ask: "if this file is wrong, does anything else break?"

**Hard rule:** Always use contract-bearing file count, never total file count, for blast-radius classification. An item touching 30 stub files and 0 contracts is clear. An item touching 10 total files with 8 contracts is complicated or chaotic depending on cascade scope.

#### Cascade Scope

| Cascade | Indicator | Domain Implication |
|---|---|---|
| **Contained** | Wrong output breaks only this item's tests. Git reset fully reverses. | Clear or Complicated — safe for agent execution |
| **Local** | Wrong output breaks 1-2 adjacent items or requires a follow-up fix commit. | Complicated — agent can execute but review before merge |
| **Wide** | Wrong migration, wrong shared contract, wrong data shape consumed by 3+ items. Reversal requires counter-migration or multi-file fixup. | Chaotic — decompose, add human gate, or promote to spike first |

#### Change Surface Area

Thresholds below are heuristics, not hard cutoffs. The number of contract-bearing files and layers touched amplifies blast radius. A spec gap in a 3-file item is recoverable; the same gap in a 15-file item compounds across every file that built on the wrong assumption.

| Contract-Bearing Files | Layers Touched | Risk Amplifier |
|---|---|---|
| 1-3 | 1 | Low — wrong assumption affects a small surface. Easy to review and revert. |
| 4-10 | 2 | Medium — wrong assumption in layer 1 propagates to layer 2. Agent may build internally-consistent-but-wrong code across both layers. |
| 10+ | 3+ | High — wrong assumption in the data model cascades through API, service, and frontend. Each layer reinforces the error. Review cost scales non-linearly. |

**Combined assessment:** Use this matrix only after ruling out Disorder and Complex. An item's effective risk is `cascade scope × change surface area`:

```
                  Contract-Bearing Files
                  1-3      4-10      10+
Cascade  ┌────────┬─────────┬─────────┐
Contained│ clear  │ complic.│ complic.│
         ├────────┼─────────┼─────────┤
Local    │complic.│ complic.│ CHAOTIC │
         ├────────┼─────────┼─────────┤
Wide     │complic.│ CHAOTIC │ CHAOTIC │
         └────────┴─────────┴─────────┘
```

Tie-breaker: when deciding between Complicated and Chaotic, classify by the cost of being wrong, not the effort required to do the work.

### Chaotic Response Model

Chaotic items cannot reach `triage:ready`. They must be decomposed first.

**Chaotic should be rare.** Before classifying an item as chaotic, verify it isn't better classified as disorder (under-specified — enrich it) or complex (unresolved discovery — spike it). In practice, most items that initially appear chaotic turn out to be disorder once you check for missing file paths, or complicated once you count contract-bearing files instead of total files.

The decomposition strategy depends on the *source* of chaos:

**Chaotic from size** (wide cascade × high file count, but spec is complete): Decompose by layer or component boundary into roughly 2-4 complicated items. Each child should touch one layer and stay under roughly 10 contract-bearing files. No spike needed — the knowledge exists, the scope is just too wide for safe single-pass execution. Human review required before merge.

**Chaotic from gaps** (unknown unknowns × high file count): Decompose into a Complex probe (spike) that resolves the unknowns, then Complicated implementation items. Do not start implementation until the probe completes.

### Disorder Exit Criteria

Before reclassifying out of disorder, the item must have:
- Changes Needed section with file paths (if implementation work)
- A clear approach or decomposition plan (if scope is uncertain)
- All upstream dependencies resolved or explicitly stubbed
- Any findings from referenced spikes/decisions copied into this item's description

If only file paths are missing, a single enrichment pass (grep the codebase, fill Changes Needed) is sufficient. If the approach itself is unclear, a planning session or spike is needed first.

Disorder is not about what the *team* knows — it's about what the *item description contains*. If the knowledge exists but isn't in the description, the item is in disorder.

### Examples

**Clear:** A migration adds a CHECK constraint. The item description includes exact table name, column name, allowed values, reference migration, and test updates. The agent is copying explicit values, not deriving them. → `cynefin:clear`

**Complicated:** A new service implementation follows an existing pattern but requires coordinated edits across config, service layer, serializer, API wiring, and integration tests. The description names every file and the reference implementation. → `cynefin:complicated`

**Complex:** An item says "implement field mapping after determining source field semantics" and the field semantics are not yet known. The work must first produce findings that determine the implementation shape. → `cynefin:complex`

**Disorder:** An item has polished AC and a clear description but does not name the files to change, does not capture upstream findings it references, and does not specify which pattern to follow. It looks complete but requires invention. → `cynefin:disorder`

**Chaotic:** An item proposes a migration plus shared schema, service, and API changes across many downstream consumers. The spec is mostly complete, but a wrong assumption would require counter-migration and multi-layer repair. Blast radius is too high for safe execution in a single pass. → `cynefin:chaotic`

### Label Application

```bash
# Apply during triage, after type and size classification
bd label add <id> cynefin:complicated

# Reclassify when new information changes the domain
bd label remove <id> cynefin:complicated
bd label add <id> cynefin:complex
bd comments add <id> "Cynefin reclassified: complicated → complex. Reason: spike findings invalidated the assumed API shape; Changes Needed now has open questions."
```

### Domain-Specific Triage Expectations

| Domain | Template Expectation | Effort Confidence | Agent Guardrails |
|--------|---------------------|-------------------|-----------------|
| **Clear** | Full template, all sections concrete | High — use historical averages | None — execute freely |
| **Complicated** | Full template, Changes Needed names specific files + patterns | Medium — historical avg × 1.2-1.5x | Read all referenced files before editing. Review before merge. |
| **Complex** | Decision/Spike template; features need Scope Boundaries + time box or fallback | Low — range estimate, cite uncertainty | Primary output is findings, validated assumptions, or a branch-level prototype. Do not merge production implementation until unknowns are resolved. |
| **Chaotic** | Cannot reach `triage:ready`. Decompose into smaller items first. | N/A — forecast after decomposition | Not safe for unsupervised agent execution. Requires decomposition and human checkpoint. |
| **Disorder** | Stub only. Cannot advance past `triage:backlog`. | N/A — cannot estimate | Block from execution entirely. |

### Domain Transitions

Items move between domains as work progresses:

- **Disorder → any**: Enough detail is added to classify safely. Always the first transition.
- **Chaotic → Complex + Complicated**: Decompose into probe (complex) + implementation (complicated), or split by layer into smaller complicated items.
- **Complex → Complicated**: Spike completes, findings captured. Child items start as complicated.
- **Complicated → Complex**: Mid-implementation discovery invalidates the approach. Pause, reclassify, spike.
- **Clear → Complicated**: A supposedly mechanical change reveals hidden contract derivation, hidden dependencies, or cross-layer coupling.

Log every transition (with the reason) on the work item — `bd comments add` for beads, or a description note for `none`. This builds a learning corpus for improving classification accuracy over time.

---

## Triage State Progression

When stubbing out an entire backlog upfront (e.g., populating a new project with all planned features), items move through three triage states as detail accumulates. **Not every item needs to be fully spec'd at creation time.**

| Triage State | When | What's required | TBDs allowed? |
|---|---|---|---|
| **`backlog`** | Initial stubbing — you know this work exists but details depend on earlier phases | Stub template: Title + Summary + Persona + Phase | Yes — expected and normal |
| **`triaged`** | Shaped — earlier phases have landed enough decisions to size and sequence this | Summary filled, **dependencies formalized (graph for beads via `bd dep add`; not just prose)**, size estimated, type classified | Some — in implementation details only |
| **`ready`** | Fully spec'd — a fresh session can implement this cold | Full template, no TBDs, passes self-sufficiency test | No — all sections complete |

### How it works in practice

1. **Project kickoff:** Stub all known work as `backlog` items using the Stub Template below. Group into phases on the parent epic.
2. **Phase boundaries:** As Phase N completes, review Phase N+1 items. Enrich with decisions that just landed. Promote to `triaged` when sized.
3. **Sprint planning:** Pull `triaged` items, fill remaining sections, run the Readiness Checklist. Promote to `ready`.
4. **Implementation:** Only claim `ready` items. If an item isn't ready, enrich it — don't start guessing.

```bash
# Stub phase — create with minimal info
bd create "User notification preferences" --type feature --parent <epic-id>
bd set-state <id> triage=backlog

# Shape phase — add detail as earlier work resolves unknowns
bd update <id> --design "## Approach\n..."
bd label add <id> size:medium
bd set-state <id> triage=triaged

# Ready phase — full spec, no TBDs
bd update <id> --acceptance "- [ ] GET /preferences returns current settings\n- [ ] PUT /preferences updates and persists"
bd set-state <id> triage=ready
```

---

## Stub Template

Use this when populating a backlog upfront. Intentionally minimal — just enough to capture intent and sequence. Items created with this template start at `triage:backlog`.

```text
## Summary
[One sentence: what this will do and why it matters.]

## Persona
Primary: [End User | Administrator | Developer | System]

## Phase
[Which phase/epic this belongs to and rough sequencing.]
Depends on: [list item IDs or "Phase 1 completion" — or "none" if independent]

## Open Questions
- [What needs to be decided before this can be fully spec'd?]
- [What earlier work will inform the approach here?]

## Rough Size Estimate
[S / M / L / Unknown] — [one-line rationale or "too early to size"]
```

> **Do not** fill in Changes Needed, Acceptance Criteria, or Effort Forecast at stub time. Those sections require decisions that haven't been made yet. Filling them with guesses creates false confidence.

---

## SMALL Feature Template — Section Contracts

### Summary
> **Purpose:** Establish what's being built and why in one glance.<br>
> **Required:** What the feature does + why it's needed. Reference prior art or the prompting work item that triggered it.<br>
> **Not sufficient:** Just a title restatement ("Add the thing")<br>

**Example:**
```
Add `item_count` computed field to CategoryResponse so the list view can show
a badge without an extra API call. Prompted by PROJ-142 (Category Items feature)
which needs count-on-load.
```

### Persona
> **Purpose:** Identify who this feature/fix is for so AC and UAT are framed correctly.<br>
> **Required:** Primary persona + optional secondary. Must match `persona:*` labels on the item.<br>
> **Not sufficient:** Omitting this section or writing "everyone"<br>

**Example:**
```
Primary: End User
Secondary: System (background job uses item_count for digest emails)
```

### Changes Needed
> **Purpose:** Scope the work to specific files so the implementer doesn't have to search.<br>
> **Required:** File path, action (Create/Edit), and what changes in each file.<br>
> **Not sufficient:** "Update the backend" or "Change the model"<br>

**Example:**
```
| File | Action | What Changes |
|------|--------|-------------|
| `backend/api/categories/schemas.py` | Edit | Add `item_count: int = 0` to CategoryResponse |
| `backend/api/categories/routes.py` | Edit | COUNT query + model_copy(update={}) in get_category |
```

### Acceptance Criteria
> **Purpose:** Define "done" -- testable, checkable items grouped by persona.<br>
> **Required:** Checklist format (`- [ ]`). Grouped under persona headings matching the Persona section. Each persona must have at least one item. Include regression check.<br>
> **Not sufficient:** Vague items ("it works", "tests pass") without specifying what works or which tests. Ungrouped flat list when multiple personas apply.<br>

**Example:**
```
### End User
- [ ] GET /categories/{id} response includes `item_count` integer field
- [ ] item_count = 0 for categories with no items
- [ ] item_count reflects actual count after adding/deleting items

### System
- [ ] Existing tests pass (no regressions)
```

### Effort Forecast
> **Purpose:** Enable planning and track estimation accuracy over time.<br>
> **Required:** Per-phase breakdown (plan / implement / test, plus discover/fix when applicable), each with turns and output tokens and a one-line rationale; a Total line summing the phases; and a confidence level.<br>
> **Not sufficient:** "Should be quick"; a single combined turn count with no phase breakdown; phases without rationale; total that doesn't match the sum of phases.<br>
> **Why per-phase:** The token-tracking hook records per-phase actuals; comparing a single-number forecast against per-phase actuals (or vice versa) produces misleading 3-25× false-overrun signals. Per-phase forecasts that sum to a total give clean apples-to-apples comparison.<br>

**Example:**
```
- Plan: ~3 turns, ~1500 tokens (read 2 files for context)
- Implement: ~8 turns, ~3500 tokens (similar to proj-x08.3 — schema fix, 2 files)
- Test: ~2 turns, ~600 tokens (pytest only, low iteration risk)
- Total: ~13 turns, ~5600 tokens
- Confidence: medium (comparable prior items exist; impl phase historical avg was 7.5t / 4573 tok)
```

---

## MEDIUM Feature Template — Section Contracts

*Includes all Small sections, plus the following:*

### API Contract
> **Purpose:** Define the interface so implementer doesn't make endpoint design decisions.<br>
> **Required:** Method, path, status codes, request body shape, response shape, error responses. For every path parameter (e.g., `{id}`), verify the caller's data context provides that value — if not, document the prerequisite fetch or schema change needed. Omit if frontend-only.<br>
> **Not sufficient:** "CRUD endpoints for items", just a path without request/response shapes, or referencing endpoints without verifying the caller has all required path/query parameters available from its current data context.<br>

**Example:**
```
| Method | Path | Status | Description |
|--------|------|--------|-------------|
| GET | `/projects/{pid}/milestones` | 200 | List milestones |
| POST | `/projects/{pid}/milestones` | 201 | Create milestone |

Request (POST): { title: string, due_date: date, status: string }
Response: { id: UUID, project_id: UUID, title: string, due_date: date, status: string, created_at: datetime }
Errors: 404 (project not found), 403 (write access required), 422 (validation)
```

### Frontend Component
> **Purpose:** Define what the UI looks like and where it lives so the implementer doesn't make design decisions.<br>
> **Required:** Component name + path, parent page, UI pattern (Sheet/Dialog/inline/page), integration point in parent, key interactions. Include a11y requirements if UI is interactive. Omit if backend-only.<br>
> **Not sufficient:** "Add a button" or "Show the data in a table"<br>

**Example:**
```
- Component: `MilestoneTimelineDialog` in `components/dialogs/MilestoneTimelineDialog.tsx`
- Parent page: `ProjectDetail.tsx`
- UI pattern: Dialog (modal)
- Integration point: "Milestones" button in project detail header, after "Edit"
- Key interactions: Paginated list, click row to view details, delete with confirmation
- Responsive: Dialog goes full-width on mobile (max-w-lg on desktop)
- A11y: aria-label on trigger button, focus trap in dialog, Escape to close
```

### Scope Boundaries
> **Purpose:** Prevent scope creep by explicitly stating what's NOT included.<br>
> **Required:** At least one "Not in scope" or "Deferred" item. If truly nothing is excluded, state "Full scope -- no exclusions."<br>
> **Not sufficient:** Omitting this section entirely.<br>

**Example:**
```
- Not in scope: Bulk milestone import (separate work item)
- Not in scope: Gantt chart visualization (deferred to PROJ-XXXX)
- Deferred: Export to CSV
```

### Patterns to Reuse
> **Purpose:** Point the implementer to existing code to follow, preventing reinvention and ensuring consistency.<br>
> **Required:** At least 2 concrete references with file paths. Cover auth, service pattern, and frontend client/component pattern as applicable.<br>
> **Not sufficient:** "Follow existing patterns" without specifying which files.<br>

**Example:**
```
- Auth + access control: `get_membership()` + `require_write_access()` from `api/projects/service.py`
- Service pattern: `api/projects/comments/service.py` (recent, clean CRUD)
- Frontend API client: `projectCommentsApi` in `services/api.ts` (list/create/update/delete shape)
- Dialog pattern: `TaskEditDialog.tsx` for modal with form + cancel/save
```

### Testing Strategy
> **Purpose:** Define what testing is expected so it's not an afterthought.<br>
> **Required:** Which service functions need unit tests, what manual verification to perform.<br>
> **Not sufficient:** "Add tests" without specifying what's tested.<br>

**Example:**
```
- Unit tests: `test_milestone_service.py` -- create, list, delete, access control (readonly blocked)
- Manual: Create milestone via UI, verify it appears in list, delete with confirmation, verify count updates
- Regression: `pytest tests/ -q` all pass, `npx tsc --noEmit` clean
```

---

## LARGE Feature Template — Section Contracts

*Includes all Medium sections, plus the following. Existing Medium sections are expanded:*

### Summary (expanded)
> **Required (large):** Also include context on why this approach was chosen over alternatives, and reference any prior items that were reverted or superseded.<br>

**Example:**
```
Add a comments system to projects -- any project can have user-created comments.
Projects are the core entity; tasks and milestones are child views.

A prior approach proposed task-level comments, but that was reverted because the
task PATCH endpoint is deprecated and returns 409 for archived tasks.
This project-level approach avoids that dependency.
```

### Data Model
> **Purpose:** Eliminate ambiguity on schema -- implementer should not make column-level decisions.<br>
> **Required:** Table name, every column with type/nullable/description, FK targets with cascade rules, indexes, and design decisions explaining non-obvious choices.<br>
> **Not sufficient:** "New table for comments" or "Standard fields plus content column"<br>

**Example:**
```
New `project_comments` table:

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID PK | no | Primary key |
| project_id | UUID FK -> projects.id (CASCADE) | no | Parent project |
| content | Text | no | Free-form comment body |
| created_by_user_id | UUID | no | Auth provider sub claim (immutable) |
| updated_by_user_id | UUID | yes | Set on edit, null until first edit |

Indexes: project_id (explicit, for query performance)

Design decisions:
- `content` as Text -- unbounded but validated at API layer (max 5000 chars)
- CASCADE on FK -- comments are owned by the project lifecycle
- UUID only for user IDs -- display name resolution deferred
```

### API Contract (expanded for large)
> **Required (large):** All endpoints with full request/response schemas, error response table with status/condition/detail, and access control summary.<br>

**Example (additions beyond medium):**
```
### Error Responses
| Status | Condition | Detail |
|--------|-----------|--------|
| 403 | Readonly member | "Write access required" |
| 404 | Project not found | "Project {id} not found" |
| 404 | Comment not found | "Comment {id} not found" |
| 422 | Content too long | "Content must be <= 5000 characters" |

### Access Control
- Read (GET list): membership required
- Write (POST, PATCH, DELETE): non-readonly role
- created_by_user_id: set from auth.user_id, immutable
- updated_by_user_id: set from auth.user_id on PATCH
```

### Frontend Component (expanded for large)
> **Required (large):** Also include state management, props/callbacks, empty state description, loading state, and error handling pattern.<br>

**Example (additions beyond medium):**
```
- State management: local state (useState) -- sheetOpen, itemCount, items array
- Props: projectId, open, onOpenChange, onCountChange callback
- Empty state: MessageSquare icon + "No comments yet" + "Add a comment to this project."
- Loading state: Loader2 spinner centered in sheet body
- Error handling: useToast() -- destructive variant for failures, default for success
  - Create fail: "Failed to add comment"
  - Update fail: "Failed to update comment"
  - Delete fail: "Failed to delete comment"
```

### File Manifest
> **Purpose:** Complete inventory of every file touched -- implementer can plan the work sequence and estimate accurately.<br>
> **Required:** Every file with action (Create/Edit) and one-line purpose. Group by layer (backend/frontend/infra).<br>
> **Not sufficient:** "Several new files in the API directory" or listing only new files without edits.<br>

**Example:**
```
### Backend (new)
| File | Purpose |
|------|---------|
| `backend/models/comment.py` | ORM model |
| `backend/alembic/versions/20260302_*.py` | Migration |
| `backend/api/comments/schemas.py` | Pydantic schemas |
| `backend/api/comments/service.py` | Business logic |
| `backend/api/comments/routes.py` | API routes |

### Backend (edit)
| File | What Changes |
|------|-------------|
| `backend/models/__init__.py` | Register Comment model |
| `backend/api/__init__.py` | Mount comments router |
| `backend/api/projects/schemas.py` | Add comment_count field |

### Frontend (new)
| File | Purpose |
|------|---------|
| `frontend/src/components/CommentsSheet.tsx` | Sheet UI component |

### Frontend (edit)
| File | What Changes |
|------|-------------|
| `frontend/src/types/index.ts` | Comment types, comment_count on Project |
| `frontend/src/services/api.ts` | commentsApi client |
| `frontend/src/pages/ProjectDetail.tsx` | Comments button + Sheet integration |
```

### Verification & UAT
> **Purpose:** Numbered test plan that can be followed step-by-step to verify the feature end-to-end.<br>
> **Required:** Numbered steps covering: happy path, error case, persistence, edge case. Include both automated checks and manual browser verification. Include UAT scenarios for user-facing features.<br>
> **Not sufficient:** "Test it in the browser" or "Run the tests"<br>

**Example:**
```
### Automated
1. `npx tsc --noEmit` -- TypeScript clean
2. `pytest tests/ -q` -- all pass, no regressions

### Manual E2E
3. Navigate to Project detail page
4. Click Comments button -> Sheet opens with empty state
5. Type comment -> click Add -> comment appears in list, badge shows "1"
6. Click Edit -> modify text -> Save -> content updated, "edited" indicator shows
7. Click Delete -> confirmation dialog -> confirm -> comment removed, badge disappears
8. Refresh page -> verify badge count persists from API

### UAT Scenarios
#### End User
9. I can add a comment to a project and find it later
10. With multiple comments, the most recent comment appears first

#### End User (Readonly)
11. I cannot create/edit/delete comments (403 returned)

### Edge Cases
12. Create comment with max length (5000 chars) -> succeeds
13. Submit empty comment -> button disabled, cannot submit
14. Delete last comment -> empty state reappears
```

### Deferred Work
> **Purpose:** Explicitly list future work that depends on this feature but is out of scope.<br>
> **Required:** Each item with work item ID (or "create new item") and one-line description. Note what can be reused.<br>
> **Not sufficient:** Omitting this section when there's obvious follow-on work.<br>

**Example:**
```
- PROJ-201: Task page comments indicator (reuses CommentsSheet, no schema changes)
- PROJ-202: Milestone page comments indicator (same component)
- PROJ-150: Show creator/editor display names (needs auth provider user lookup)
```

### Testing Strategy (expanded for large)
> **Required (large):** Separate unit, integration (if applicable), and manual sections. Name the test file and specific functions to test.<br>

**Example:**
```
### Unit Tests
- `tests/unit/comments/test_service.py`:
  - test_create_comment_sets_created_by_user_id
  - test_update_comment_sets_updated_by_user_id
  - test_delete_comment_removes_from_db
  - test_readonly_user_blocked_from_write_ops
  - test_list_comments_ordered_by_created_at_desc

### Manual
- Full E2E via browser (see Verification & UAT above)

### Regression
- `pytest tests/ -q` -- all existing tests pass
- `npx tsc --noEmit` -- TypeScript clean
```

---

## BUG Template — Section Contracts

### Summary
> **Purpose:** Identify the defect at a glance.<br>
> **Required:** Observable symptom + user impact + affected feature/endpoint.<br>
> **Not sufficient:** "Auth is broken"<br>

**Example:**
```
GET /projects returns 500 when a project has no tasks assigned. Affects all users
viewing project lists -- page fails to load entirely. Introduced after PROJ-112
date parsing change.
```

### Persona
> **Purpose:** Identify who is affected by the bug.<br>
> **Required:** Primary persona experiencing the defect + optional secondary.<br>
> **Not sufficient:** Omitting this section.<br>

**Example:**
```
Primary: End User (project list page fails to load)
Secondary: System (task aggregator crashes on null input)
```

### Steps to Reproduce
> **Purpose:** Enable anyone to see the bug.<br>
> **Required:** Numbered steps from clean state to broken behavior, environment details if relevant.<br>
> **Not sufficient:** "Click the button and it breaks"<br>

**Example:**
```
1. Login as testuser
2. Navigate to "Acme Corp" workspace
3. Create a project -- do NOT add any tasks
4. Navigate to Projects list page
5. Observe: 500 error, page blank. Console shows: TypeError: Cannot read property 'total' of null
```

### Root Cause Hypothesis
> **Purpose:** Focus investigation before coding starts.<br>
> **Required:** Specific hypothesis naming file/function + confidence level + how to confirm/disprove.<br>
> **Not sufficient:** "Something is wrong with the backend"<br>

**Example:**
```
- Hypothesis: `_build_task_summary()` in `tasks/aggregator.py` assumes
  `task_json` is always populated, but projects without tasks have null.
  The route calls aggregator unconditionally.
- Confidence: high (stack trace points to aggregator.py:142)
- Confirm: Add a project with no tasks, check if aggregator receives None
- Disprove: If aggregator receives valid dict and still fails, issue is downstream
```

### Files to Investigate
> **Purpose:** Scope the search so the implementer doesn't have to grep blindly.<br>
> **Required:** 2+ file paths with what to check in each.<br>
> **Not sufficient:** "Check the backend"<br>

**Example:**
```
| File | What to Check |
|------|---------------|
| `backend/api/projects/routes.py` | Does list_projects call aggregator for all projects or only those with tasks? |
| `backend/tasks/aggregator.py:142` | Does _build_task_summary guard against None input? |
| `backend/api/projects/schemas.py` | Is task_summary Optional in ProjectResponse? |
```

### Fix Approach
> **Purpose:** Define the fix before coding -- prevents exploratory yak-shaving.<br>
> **Required:** Concrete plan (file + change) OR "TBD after investigation" -- TBD blocks `triage:ready`.<br>
> **Not sufficient:** "Fix the bug"<br>

**Example:**
```
Guard in routes.py list_projects: skip aggregator call when project.task_json is None.
Return task fields as null/defaults in response. Do NOT fix in aggregator
(aggregator should assume valid input; the route should filter).

| File | Change |
|------|--------|
| `backend/api/projects/routes.py` | Add `if project.task_json:` guard before aggregator call |
| `backend/api/projects/schemas.py` | Ensure task fields are Optional with defaults |
```

### Acceptance Criteria
> **Purpose:** Define "fixed" -- testable items grouped by persona, including regression prevention.<br>
> **Required:** Checklist format (`- [ ]`). Grouped under persona headings. Original bug fixed + regression test + no regressions.<br>
> **Not sufficient:** "Bug is fixed"<br>

**Example:**
```
### End User
- [ ] GET /projects returns 200 when mix of projects with and without tasks
- [ ] Projects without tasks show null/default task fields (not 500)
- [ ] Projects with tasks still show full task data (no regression)

### System
- [ ] Regression test: test_list_projects_with_taskless_project added
- [ ] `pytest tests/ -q` all pass
```

### Effort Forecast
> **Purpose:** Enable planning -- bugs have higher uncertainty than features.<br>
> **Required:** Per-phase breakdown (plan / implement / test, plus discover when root cause is uncertain), each with turns and output tokens, plus a Total line. Bug ranges should widen the test phase to account for fix-iterations.<br>
> **Not sufficient:** "Should be quick"; single combined turn count; total that doesn't match the sum.<br>

**Example:**
```
- Plan: ~2 turns, ~1000 tokens (read failing test + suspected file)
- Discover: ~3 turns, ~1500 tokens (verify root cause hypothesis if needed; otherwise 0)
- Implement: ~5-8 turns, ~2500 tokens (null guard, 2-3 files; similar to PROJ-112 ~10 turns)
- Test: ~3-5 turns, ~1000 tokens (regression test + pytest; allow for 1-2 fix iterations)
- Total: ~13-18 turns, ~6000 tokens
- Confidence: medium-high (stack trace is clear, but need to verify no other callers)
```

---

## CHORE Template — Section Contracts

### Summary
> **Purpose:** Justify the maintenance work -- why now, not later.<br>
> **Required:** What maintenance + why now (trigger: tech debt, lint, deprecated dep, doc drift).<br>
> **Not sufficient:** "Clean up the code"<br>

**Example:**
```
Remove deprecated PATCH endpoint and all references. Triggered by:
(1) endpoint returns 409 for all active records since PROJ-95, (2) new code
keeps accidentally calling it, (3) it's documented as deprecated
but still importable. Removing it prevents future bugs.
```

### Persona
> **Purpose:** Identify who benefits from this maintenance work.<br>
> **Required:** Primary persona. Chores are often `Developer` or `System`.<br>
> **Not sufficient:** Omitting this section.<br>

**Example:**
```
Primary: Developer (removes dead code that causes confusion)
Secondary: System (eliminates deprecated endpoint from routing)
```

### Changes Needed
> **Purpose:** Scope the work to specific files or patterns.<br>
> **Required:** File paths + actions; pattern descriptions OK for bulk changes (e.g. "all files importing X").<br>
> **Not sufficient:** "Clean up imports across the codebase"<br>

**Example:**
```
| File | Action | What Changes |
|------|--------|-------------|
| `backend/api/items/routes.py` | Edit | Remove `patch_item` route function |
| `backend/api/items/service.py` | Edit | Remove `update_item` service function |
| `backend/api/items/schemas.py` | Edit | Remove `ItemUpdate` schema |
| `frontend/src/services/api.ts` | Edit | Remove `updateItem` from itemsApi |
| `frontend/src/components/ItemDetail.tsx` | Edit | Remove edit button and handler |
```

### Scope Boundaries
> **Purpose:** Prevent "while I'm here" growth -- chores are magnets for creep.<br>
> **Required:** At least one explicit boundary + completion condition.<br>
> **Not sufficient:** Omitting this section entirely.<br>

**Example:**
```
- In scope: Remove PATCH endpoint, service, schema, frontend caller, and edit UI
- NOT in scope: Removing the entire items module (GET/POST/DELETE stay)
- NOT in scope: Adding new functionality to replace PATCH
- Completion condition: No remaining imports of ItemUpdate or updateItem;
  `grep -r "patch_item\|update_item\|ItemUpdate" backend/ frontend/` returns empty
```

### Effort Forecast
> **Purpose:** Enable planning.<br>
> **Required:** Per-phase breakdown (plan / implement / test), each with turns and output tokens, plus a Total line. Chores often skim on plan (low context-loading) and test (mostly type-check or grep verification).<br>
> **Not sufficient:** "Should be quick"; single combined turn count; total that doesn't match the sum.<br>

**Example:**
```
- Plan: ~2 turns, ~800 tokens (skim affected files)
- Implement: ~6 turns, ~2500 tokens (5 files, all deletions; comparable to PROJ-95.3 ~12 turns)
- Test: ~2 turns, ~600 tokens (grep + tsc/pytest, no fix iterations expected)
- Total: ~10 turns, ~3900 tokens
- Confidence: high (purely removal, no new logic)
```

---

## EPIC Template — Section Contracts

Epics are parent items that group related work into a cohesive deliverable. They are **not** directly implementable — all work happens in child items.

### Summary
> **Purpose:** Define the initiative and its business value at a glance.<br>
> **Required:** What capability is being delivered, why it matters, and how it relates to the product vision. Reference any prior epics or decisions that led to this one.<br>
> **Not sufficient:** Just a title restatement or a list of child items.<br>

**Example:**
```
Build a policy-based notification system. Users can configure notification
rules targeting event types, channels, and frequency. Tracks delivery
status with retry logic for failed sends.

Prompted by user research showing 70% of users want proactive alerts.
Depends on Epic A (Event Bus) for reliable event delivery.
```

### Persona
> **Purpose:** Identify who this epic ultimately serves.<br>
> **Required:** Primary persona. Epics often serve End User but may serve Developer (infra epics) or System (pipeline epics).<br>
> **Not sufficient:** Omitting this section.<br>

**Example:**
```
Primary: End User (receives notifications about relevant events)
Secondary: Developer (notification engine is extensible for future channel types)
```

### Success Criteria
> **Purpose:** Define "done" for the epic — when can it be closed?<br>
> **Required:** 3-6 measurable outcomes that indicate the epic is complete. These are higher-level than individual child item ACs. Include both functional and non-functional criteria where applicable.<br>
> **Not sufficient:** "All child items are closed" (that's a tautology). Vague goals like "notifications work."<br>

**Example:**
```
- Users can create notification rules targeting event types with
  configurable channels (email, in-app, webhook)
- Notification history view displays delivery status with retry counts
  and timestamp of last attempt
- Failed notifications retry with exponential backoff and surface
  permanent failures to the user
```

### Decomposition
> **Purpose:** Outline the child items and their sequencing so the full scope is visible.<br>
> **Required:** List of child items (or planned items) grouped by phase/convoy if applicable. Note dependencies between children. If children don't exist yet, describe them with enough detail to create.<br>
> **Not sufficient:** No children listed. Or children listed without dependency/sequencing information.<br>

**Example:**
```
### Phase 1 — Core (no dependencies)
- PROJ-xyz1: Notification model + CRUD API (size:medium)
- PROJ-xyz2: Notification rules model + relationships (size:medium)

### Phase 2 — Delivery (depends on Phase 1)
- PROJ-xyz3: Channel dispatch + retry engine (size:large)
- PROJ-xyz4: Notification history API endpoint (size:medium)

### Phase 3 — Frontend (depends on Phase 2)
- PROJ-xyz5: Notification preferences page + rule builder (size:large)
- PROJ-xyz6: Notification history view + status badges (size:large)

### Phase 4 — Polish
- PROJ-xyz7: Digest mode (batch notifications) (size:small)
- PROJ-xyz8: Webhook channel integration (size:medium)
```

### Scope Boundaries
> **Purpose:** Prevent epic scope creep — what's explicitly excluded from this initiative.<br>
> **Required:** At least 2 "NOT in scope" items and what's deferred to future epics.<br>
> **Not sufficient:** Omitting this section.<br>

**Example:**
```
- NOT in scope: SMS channel (requires third-party integration, separate epic)
- NOT in scope: AI-powered notification content generation
- NOT in scope: Cross-workspace notification routing
- Deferred to future epic: Push notifications (requires mobile app)
```

### Dependencies
> **Purpose:** Identify blockers and prerequisites so the epic can be sequenced correctly.<br>
> **Required:** List upstream dependencies (other epics, infrastructure, external). State "None" if truly standalone.<br>
> **Not sufficient:** Omitting this section when dependencies exist.<br>

**Example:**
```
- Depends on: PROJ-abc (Epic A: Event Bus) — reliable event delivery
  required for notification triggers
- Depends on: Email service configured with SMTP credentials
- No external dependencies
```

---

## DECISION (Spike) Template — Section Contracts

Use a `decision` type for spikes — they map to Architecture Decision Records (ADR). Add a `spike` label for filtering.

Create with `bd create -t decision` and label via `bd label add <id> spike`.

Spikes are time-boxed deep research items that de-risk implementation by identifying architectural patterns or resolving critical design decisions. They produce **knowledge artifacts** (findings, architectural recommendations, proof-of-concept), not production code. Use a spike when the implementation approach is genuinely unknown — not for straightforward "how do I call this API" questions.

### Summary
> **Purpose:** Define what architectural uncertainty or critical decision is blocking progress.<br>
> **Required:** The specific architectural question or design decision that needs resolving. Reference the parent item or epic that's blocked. State why the answer requires deep research (not answerable from existing docs/code alone) and what's at risk if the wrong approach is chosen.<br>
> **Not sufficient:** "Research how to do X" without stating what's architecturally uncertain. Operational questions that can be answered by reading docs.<br>

**Example:**
```
Investigate whether the ORM's computed property can support real-time
period enumeration without N+1 queries. Blocked: PROJ-xyz
(weekly periods) needs to enumerate periods efficiently but it's unclear
if the current monthly pattern scales to weekly granularity (52 periods/year
vs 12).

Can't be answered from docs alone — need to benchmark actual query
performance with representative data volume.
```

### Persona
> **Purpose:** Identify who benefits from the spike's findings.<br>
> **Required:** Usually `Developer` or `System`. Spikes rarely serve End User directly.<br>
> **Not sufficient:** Omitting this section.<br>

**Example:**
```
Primary: Developer (needs to choose implementation approach)
```

### Questions to Answer
> **Purpose:** Enumerate the specific architectural questions or design decisions the spike must resolve. This is the spike's "acceptance criteria."<br>
> **Required:** Numbered list of concrete questions focused on architectural patterns, technology choices, or design trade-offs. Each question should be answerable with a clear recommendation and rationale. Include how you'll answer each (prototype, benchmark, architecture review, competitive analysis).<br>
> **Not sufficient:** Open-ended "explore the space" without specific questions. Operational questions answerable by reading docs. Single vague question like "how should we do this?"<br>

**Example:**
```
1. Can the monthly enumeration be generalized to weekly without
   breaking the existing monthly path? (Method: prototype + unit test)
2. Does weekly aggregation handle year boundaries correctly in
   the database? (Method: SQL experiment with Dec/Jan data)
3. What's the query performance impact of 52 periods vs 12?
   (Method: benchmark with 10K records over 1 year)
4. Should weekly labels use ISO week numbers or date ranges?
   (Method: review comparable products, user expectation research)
```

### Time Box
> **Purpose:** Prevent spikes from becoming open-ended research projects.<br>
> **Required:** Maximum turns and a hard stop condition. If the time box expires without answers, document what's known and what remains uncertain.<br>
> **Not sufficient:** No time limit, or "as long as it takes."<br>

**Example:**
```
- Maximum: 30 turns
- Hard stop: If no clear answer by turn 25, document findings and
  recommend smallest viable experiment for the next spike
```

### Output Artifacts
> **Purpose:** Define what the spike produces — knowledge must be captured, not just discovered.<br>
> **Required:** List of concrete deliverables. At minimum: findings summary written to the spike item's description. May include: proof-of-concept code (in a branch, not merged), benchmark results, decision record, updated descriptions for blocked items.<br>
> **Not sufficient:** "We'll know more after the spike" without specifying where findings are recorded.<br>

**Example:**
```
- Findings summary: Written to this item's description (replace this section)
- Proof-of-concept: Branch spike/weekly-period-poc (not merged)
- Benchmark results: Query timings in item comments
- Decision: Update PROJ-xyz description with chosen approach
- If approach rejected: Create alternative item with new approach
```

### Scope Boundaries
> **Purpose:** Keep the spike focused — research expands to fill available time.<br>
> **Required:** What's in scope for this spike and what's explicitly NOT. The spike should NOT produce production code.<br>
> **Not sufficient:** Omitting this section.<br>

**Example:**
```
- In scope: Prototype period enumeration, benchmark queries, document findings
- NOT in scope: Production implementation (that's PROJ-xyz)
- NOT in scope: Frontend changes or UI prototyping
- NOT in scope: Migration scripts
```

### Effort Forecast
> **Purpose:** Enable planning.<br>
> **Required:** Turns, tokens, confidence, rationale. Spikes have inherently lower confidence.<br>
> **Not sufficient:** "Should be quick"<br>

**Example:**
```
- Estimated turns: ~15-25
- Estimated output tokens: ~2000
- Confidence: low (research by nature — may surface new questions)
- Rationale: 3-4 questions, each needs ~5 turns of investigation + writeup
```

---

## Readiness Checklist (gate before `triage:ready`)

Before a work item can be set to `triage:ready`, verify:

- [ ] **Type classified:** Not `task` — reclassified to feature, bug, chore, or decision
- [ ] **Template filled:** Correct template (feature S/M/L, bug, chore, epic, or decision/spike) used
- [ ] **Size labeled:** `size:small`, `size:medium`, or `size:large` label applied (`bd label add` for beads; for `none`, record size in description or project board)
- [ ] **Cynefin classified:** `cynefin:*` label applied. `cynefin:disorder` items cannot reach `triage:ready` — enrich until classifiable. `cynefin:chaotic` items cannot reach `triage:ready` — decompose first (see Chaotic Response Model). Complex items must have a time box or fallback plan.
- [ ] **Layers identified:** One or more `layer:*` labels applied: `layer:frontend`, `layer:backend`, `layer:data`, `layer:infra`, `layer:workflow`. Must match the files listed in Changes Needed.
- [ ] **Persona identified:** Persona section filled, `persona:*` labels applied, matches AC grouping
- [ ] **No TBDs:** All required sections have real content (exception: bug Fix Approach at `triage:triaged`)
- [ ] **Section contracts met:** Each section meets "Required" bar, not "Not sufficient"
- [ ] **Hazard check done:** Per workflow.md Pre-Implementation Hazard Check
- [ ] **Acceptance criteria:** Specific, testable, checklist format with `- [ ]`
- [ ] **Regression test:** Bug templates include regression test in acceptance criteria
- [ ] **Scope boundaries:** Defined for medium+ features and all chores
- [ ] **A11y considered:** If UI touched, aria labels and keyboard behavior specified
- [ ] **Effort forecast:** Per-phase breakdown (plan/implement/test minimum + Total + Confidence) with rationale per phase. Comparable prior item referenced where helpful. Single-number forecasts (no phase breakdown) are not sufficient — see the Effort Forecast template contract above.
- [ ] **Dependencies formalized:** Every "blocks on", "depends on", or "requires" claim in the description has a corresponding formal dependency entry. **Beads:** use `bd dep add <id> --blocked-by <upstream>` and verify with `bd dep tree <id>` — the visual tree must match the prose. **None:** track dependencies in handoff.yaml `next_steps` order. Prose dependencies that aren't formalized are a defect — `bd ready` (or the equivalent review of handoff.yaml) will surface the item while its prerequisites are still open, and any coordinator picking it up will hit the missing upstream mid-implementation. Run a quick audit: scan the description for the words "blocks", "depends", "requires", "after", "prerequisite" — every match should resolve to a formal dependency entry OR be reworded as informational ("works best alongside X" instead of "depends on X").
- [ ] **Upstream dependencies resolved:** If the item references findings from an open spike, decision, or research item, those findings must be captured in this item's description or explicitly stubbed with bounded assumptions — not just referenced. A spec built on unresolved upstream assumptions is not ready.
- [ ] **Lint passes:** `bd lint` for beads (no warnings); for `none`, manually verify required sections per templates above.
- [ ] **Priority set:** Confirmed (not default without consideration)
- [ ] **Epic assigned:** Parent epic linked or justified standalone

---

## Self-Sufficiency Test

The ultimate quality check for any work item:

> **Could a fresh session read this item's description (`bd show <id>` for beads, or your project's tracking doc for `none`) and implement the work without any additional codebase research or verbal context?**

If the answer is "no," the item needs more detail before it's ready. Fix the description, not the session.
