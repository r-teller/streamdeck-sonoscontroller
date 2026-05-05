# Development Standards

Purpose: Canonical patterns for this codebase. This file is auto-loaded into every session — follow these patterns as you write code. When no pattern exists for what you're building, define one here as part of the implementation.

> This is not a reference doc you consult before coding. It's a contract that's always in context. As you write code, the patterns below are the ones you follow. If you're about to write something and there's no pattern for it, that's a signal to add one.

---

## How This Works

This file is in `rules/` — Claude Code loads it into every conversation automatically.

**When a standard exists:** Follow it. Don't invent a variation. The pattern is in your context — use it.

**When a standard exists but doesn't fit:** Flag it to the user. Either the standard needs updating or this is a justified exception. Don't silently deviate.

**When no standard exists:** You're building something new. Before (or as part of) implementing:
1. Write the CORRECT/WRONG pattern in this file
2. Point to the code you're writing as the reference implementation
3. Then continue building

The standard and the implementation happen together — not as separate steps. The code you're writing IS the first reference implementation.

---

## 0. Architecture Decisions

Locked decisions that apply across the entire codebase. Revisit only with explicit justification.

### 0.1 [Decision Name]

**Standard: [One-sentence rule.]**

[2-3 sentence rationale — why this choice, what alternatives were rejected, when to revisit.]

| Component | Choice | Rationale |
|-----------|--------|-----------|
| _[e.g., Protocol]_ | _[e.g., REST/JSON only]_ | _[e.g., Single SPA → single API, no need for GraphQL]_ |

---

## 1. Route Layer Standards

Routes are orchestration only — validate input, call service, return response. No business logic, no DB queries, no file I/O.

### 1.1 [Pattern Name]

**Standard: [Rule.]**

```python
# CORRECT
@router.get("/{item_id}", response_model=ItemResponse)
def get_item(item_id: UUID, auth: Auth, db: DbSession) -> ItemResponse:
    item = service.get_item(db=db, user_id=auth.user_id, item_id=item_id)
    return ItemResponse.model_validate(item)

# WRONG — [explain what's wrong]
@router.get("/{item_id}", response_model=ItemResponse)
def get_item(item_id: UUID, auth: Auth, db: DbSession) -> ItemResponse:
    # NO — business logic in route
    item = db.query(Item).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(404)
    return ItemResponse(id=item.id, name=item.name)
```

**Reference implementation:** `_[file:line]_`

**Current violations:** _[list files that don't follow this yet, or "None"]_

---

## 2. Service Layer Standards

Services own business logic, access control, and data operations. Every service function verifies access before touching data.

### 2.1 [Pattern Name]

**Standard: [Rule.]**

```python
# CORRECT
def create_item(db: Session, user_id: UUID, data: ItemCreate) -> Item:
    require_write_access(db, user_id, data.parent_id)
    item = Item(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

# WRONG — [explain what's wrong]
```

**Reference implementation:** `_[file:line]_`

---

## 3. Schema / Model Standards

How data shapes are defined, validated, and converted.

### 3.1 [Pattern Name]

**Standard: [Rule.]**

```python
# CORRECT
# ...

# WRONG
# ...
```

---

## 4. Frontend Standards

Component patterns, state management, and UI conventions.

### 4.1 [Pattern Name]

**Standard: [Rule.]**

```tsx
// CORRECT
// ...

// WRONG
// ...
```

---

## 5. Data Layer Standards

Migrations, queries, and schema evolution.

### 5.1 [Pattern Name]

**Standard: [Rule.]**

```sql
-- CORRECT
-- ...

-- WRONG
-- ...
```

---

## 6. Testing Standards

How tests are structured, named, and what they cover.

### 6.1 Mock `@elgato/streamdeck` in any test that imports a plugin module

**Standard: Any test file that imports — directly OR transitively — from `src/modules/common/sdConnect.js`, `src/modules/common/streamdeck.js`, or any `src/modules/plugin/*.js` MUST stub `@elgato/streamdeck` with `vi.mock` BEFORE the first import that could reach the SDK.**

The `@elgato/streamdeck` package eagerly reads `manifest.json` from `process.cwd()` at module evaluation time. Vitest runs from repo root (cwd ≠ bundle dir), so the read fails and the test file fails to load with `Failed to read manifest.json as the file does not exist.` The error message does NOT name the offending import — track it via the stack trace.

Transitive imports are easy to miss. A test file that doesn't reference `@elgato/streamdeck` directly can still hit the trap if any module in its import graph reaches `sdConnect.js`. This bit me twice in Phase 3: once writing `lifecycle.test.js`, and again when `renderDedupe.js` (a new dependency of `lifecycle.js`) added a transitive `sdConnect` import — the lifecycle test passed at write time and broke a session later.

```js
// CORRECT — stub before importing modules that may reach the SDK
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("@elgato/streamdeck", () => ({ EventEmitter }));

import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle.js";

// WRONG — no stub; import chain reaches @elgato/streamdeck and fails at load
import { describe, it, expect, vi } from "vitest";
import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle.js";
// Error: Failed to read manifest.json as the file does not exist.
```

**Reference implementation:** `tests/unit/streamdeck.test.js:1-6` (canonical pattern); `tests/unit/lifecycle.test.js:1-7`, `tests/unit/renderDedupe.test.js:1-8`, `tests/unit/sonosActions.test.js:1-7` (reuse).

**Future improvement:** A vitest `setupFiles` entry that mocks `@elgato/streamdeck` globally for unit tests would eliminate the per-file ceremony. Filed in `enhancements.md`.

---

## 7. Error Handling Standards

How errors are raised, caught, and communicated to users.

### 7.1 [Pattern Name]

**Standard: [Rule.]**

---

## Tracking Violations

When you find code that doesn't follow a standard:

1. **Don't fix it ad-hoc** — inconsistent partial fixes are worse than consistent violations
2. **Log it** as a "Current violations" note under the relevant standard
3. **Create a remediation entry**:
   Create a bead for remediation: `bd create "Remediate [standard] violations in [area]" --type chore`
4. **Batch the fix** — fix all violations of one standard together, not one at a time

---

## Adding New Standards

New standards are created during implementation, not before it. When you're writing code and no pattern exists:

1. **Write the code** — this becomes the first reference implementation
2. **Add the standard here** — CORRECT example is the code you just wrote, WRONG example is the obvious alternative you avoided
3. **Point to the file** — the reference implementation is the code from step 1
4. **Check for existing violations** — if older code does it differently, log the violations

Standards can also be promoted from `rules/standards.md` Candidate Rules when they've been validated with CORRECT/WRONG examples.

---

## When This File Changes

- **During implementation:** You're writing new code and no pattern exists → add the pattern as you build
- **During /wrapup retro:** "What should never happen again?" → new standard with the bad pattern as WRONG
- **During /quartermaster tech-review:** Audit finds inconsistency → standardize the better approach
- **When a pattern drifts:** You notice two services doing the same thing differently → pick the better one, standardize, log violations

This file grows with the codebase. If the codebase hasn't taught you anything new, there's nothing to add.
