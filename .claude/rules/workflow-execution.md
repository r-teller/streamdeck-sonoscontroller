# Workflow: Execution

Purpose: How to implement work — branching, claiming work items, writing code, committing, and creating pull requests.

> **Terminology for this project:**
> "Work item" / "item" / "issue" throughout this file refers to a **bead** — managed via the beads (`bd`) CLI.

Use this file **during implementation**. It is the primary reference while you
are actively writing code. It covers the claim/execute checklists, branching
conventions, commit standards, and pull request creation. Do not use this file
for scoping or planning work — see `workflow-planning.md` for that.

---

## Branching Strategy

All work is done on feature branches that are merged to `main` via pull request.

### Branch Naming Convention

Create branches with a unique work ID and short description:

```
<type>/<work-id>-<short-description>
```

Types: `feature`, `fix`, `chore`, `docs`, `refactor`

Work ID format: `work-YYYYMMDD-HHMM` (timestamp-based, or sequential number)

Examples:
- `feature/work-20260323-canvas-engine`
- `fix/work-20260323-collision-bug`
- `chore/work-20260323-cleanup-imports`

### Starting a Work Session

1. **Create the work branch:**
   ```bash
   # Generate a unique work ID (use timestamp or sequential number)
   WORK_ID="work-$(date +%Y%m%d-%H%M)"
   git checkout -b feature/${WORK_ID}-<description>
   ```

2. **Associate work items with this branch:**
   - Update items to `in_progress` as you work on them
   - Any new issues discovered during work are linked via `bd create ... --discovered-from <current-id>`

### During Development

- Make atomic commits as work progresses
- Reference work items in commit messages with `Closes: <id>` (or the item's title for `none`)
- Create new work items for bugs/gaps discovered during development

---

## Claim and Execute

### Start Checklist — before writing any code:

- [ ] Item is `triage:ready` (if not, enrich first)
- [ ] `bd update <id> -s in_progress` (skip if plan-only refinement — item stays open)
- [ ] Verify Effort Forecast exists on the item (see below)
- [ ] Read item description (`bd show <id>`) and capture: `priority`, `parent_epic`, `bead_created_at`, `discovered_from`
- [ ] Load context files referenced in the item

> **STOP.** Do not open any file for editing until every box above is checked.
> Every item is a command — if you can't copy-paste it, the checklist is broken.

### Verify Effort Forecast

Before transitioning to implementation, verify the work item has a **per-phase** Effort Forecast. Per-phase estimates that sum to a total give clean apples-to-apples comparison at close time.

1. Read the work item's description (`bd show <id>` for beads) and check for the `Effort Forecast:` section. It must list each expected phase (typical: plan, implement, test) plus a Total line.
2. If missing or single-number-only (e.g. item created before this convention), add a per-phase forecast now:
   ```bash
   bd comments add <id> "Effort Forecast (revised):
   - Plan: ~N turns, ~N tokens (rationale: e.g. reads 2 files for context)
   - Implement: ~N turns, ~N tokens (rationale: type+size historical average)
   - Test: ~N turns, ~N tokens (rationale: e.g. pytest + likely 1-2 fix iterations)
   - Total: ~N turns, ~N tokens
   - Confidence: low/medium/high"
   ```


### End Checklist — after all Acceptance Criteria checklist items pass:

- [ ] Tests written per item's Testing Strategy — diff each listed test case against actual test files before closing
- [ ] Automated verification passes (pytest, linter, type checker)
- [ ] Manual verification of each Acceptance Criteria item confirmed
- [ ] `bd close <id>`
- [ ] Commit includes `Closes: <id>` in message (for `none`: reference the item's title or stable identifier)


**When presenting a plan to the user**, include claim as step 0 and
close with effort as the final step. Plans without these steps are
incomplete.

---

## Issue Statuses

| Status | Meaning |
|--------|---------|
| `open` | Ready to start (default) |
| `in_progress` | Currently being worked on |
| `blocked` | Waiting on dependency or external factor |
| `deferred` | Postponed for later |
| `closed` | Completed |

## Execution Order

When implementing features, follow this order to minimize rework:

1. **Schema/data model** — migrations, model definitions
2. **API/service layer** — endpoints, route handlers
3. **Business logic** — service functions, validation
4. **Tests** — unit, integration, E2E
5. **Documentation** — update context files, API docs
6. **Frontend/UI** — consume the API, build the interface

## Handling Blocked Work

If work is blocked by an external factor:

```bash
bd update AES-42 --status blocked
bd comments add AES-42 "Waiting on API team for endpoint spec"
# Issue won't appear in `bd ready` until unblocked
bd update AES-42 --status open  # Unblock when ready
```

## Reopening Closed Issues

```bash
bd reopen AES-42 --reason "Bug reappeared after deploy"
```

## During Execution

- Execute each item in logical order
- Create commits as work progresses (see Commits section below)
- **Verify before closing:** After implementing an item, run the verification steps from its Acceptance Criteria and Testing Strategy sections before marking it done. At minimum:
  1. Run the project's test suite (if tests exist)
  2. Run the type checker / linter (if applicable)
  3. Manually verify each Acceptance Criteria checklist item can be confirmed
  4. If any check fails, fix the issue before closing the item
- Close items only after verification passes
- If blocked, set status to `blocked` and add a comment explaining why

## Work Discovery

When you discover unrelated issues during execution (broken tests, bugs, tech debt), **capture them immediately** rather than ignoring:

```bash
bd create "Fix broken auth tests" --type bug --discovered-from <current-bead-id>
bd create "Refactor duplicated validation logic" --type chore --discovered-from <current-bead-id>
```

**`--discovered-from` is required for all bugs.** It traces the defect back to the item whose implementation introduced it. For features and chores, `--discovered-from` is recommended but optional.

**Validate type matches description** before confirming with user:
- `bug`: fixes broken behavior ("Fix X", "X doesn't work", "X times out")
- `feature`: adds new capability ("Add X", "Implement X")
- `chore`: maintenance, no behavior change ("Clean up X", "Rename X", "Upgrade X")
- `decision`: investigates open question ("Investigate X", "Spike: X")
If the user says "create a chore" but it's fixing a failure, classify as `bug` and confirm.


## On Failure

If work fails:
1. Do not close the item
2. Add context via `bd comments add <id> "Error: [description]"`
3. Create follow-up items if needed
4. Seek user guidance before continuing

---

## Commits

When work results in code changes:

### Commit Message Style

Follow Conventional Commits format:

```
feat: add user login button
fix: resolve null pointer in auth handler
docs: update API documentation for auth endpoints
refactor: extract validation logic to shared module
```

### Link to Items

Reference the work item in commits when applicable:

```bash
git commit -m "feat: add login button

Closes: AES-42"
```

### Sync with Git

After completing work:

```bash
git add <specific-files>
git commit -m "feat: [description]"
bd sync
git push
```

> Always stage specific files. Avoid `git add .` — it can accidentally stage secrets, binaries, or temporary files.

### Changelog

After completing a set of features, update `changelog.yaml`.

---

## Pull Requests

When the feature branch is ready for merge:

1. **Push the branch:**
   ```bash
   git push -u origin <branch-name>
   ```

2. **Create PR using the project template:**
   ```bash
   gh pr create --title "<type>: <description>"
   ```
   Read `.github/PULL_REQUEST_TEMPLATE.md` and fill in all sections per `rules/pull-requests.md`. The `gh` CLI auto-populates the body from the template when it exists.

3. **Request human review:** After creating the PR, always request human review before merging. **NEVER merge PRs to main without explicit human approval.**

4. **Merge strategy:** Once approved, squash and merge to keep `main` history clean
