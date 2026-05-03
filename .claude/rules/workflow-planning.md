# Workflow: Planning

Purpose: How to scope, structure, and track work items.

> **Terminology for this project:**
> "Work item" / "item" / "issue" throughout this file refers to a **bead** — managed via the beads (`bd`) CLI.

Use this file when **scoping new work** — breaking features into items, setting
priorities, linking dependencies, and capturing user-requested work mid-session.
Do not use this file for implementation steps — see `workflow-execution.md` for
branching, coding, and commits.

---

## Break Work into Issues

Create **fine-grained** issues for each discrete piece of work. Smaller issues = better agent decisions and cheaper sessions.

```bash
bd create "Implement auth endpoint" --type feature
bd create "Add auth tests" --type task
bd create "Update API docs for auth" --type chore
bd create "Fix login crash" --type bug -p 0
```

## Issue Types

| Type | Use For |
|------|---------|
| `bug` | Defects, errors, crashes |
| `feature` | New functionality |
| `task` | General work items |
| `epic` | Large initiatives (parent of multiple issues) |
| `chore` | Maintenance, docs, cleanup |

## Priority Levels

Set priority with `-p` flag (0 = most urgent):

| Priority | Meaning | Example |
|----------|---------|---------|
| `-p 0` | Critical | Production down, security issue |
| `-p 1` | High | Blocking other work |
| `-p 2` | Medium | Normal feature work (default) |
| `-p 3` | Low | Nice to have |
| `-p 4` | Backlog | Future consideration |

```bash
bd create "Security vulnerability" --type bug -p 0
bd update AES-42 --priority 1  # Escalate priority
bd list --priority-min 0 --priority-max 1  # Show P0-P1 only
```

## Issue Granularity

Keep issues atomic and completable in a single focused session:
- **Too big:** "Implement user authentication system"
- **Right size:** "Add JWT token validation middleware"
- **Right size:** "Create login API endpoint"
- **Right size:** "Add password hashing utility"

## Issue Dependencies

Link related issues to build a dependency graph:

```bash
# Create a blocking dependency
bd create "Fix database connection" --blocks AES-42

# Create a child issue (subtask)
bd create "Add input validation" --parent AES-40

# Link discovered work to its origin
bd create "Fix flaky test in auth" --discovered-from AES-42
```

## User-Requested Work During Sessions

When the user requests new features, enhancements, or changes during an active session, **capture them as work items before implementing**:

### Recognition Triggers

Create new work items when user requests contain:
- New functionality ("add stacking", "implement X")
- Enhancements to existing features ("update X to support Y")
- Multiple distinct items ("do A and B")
- Scope expansion beyond current issue

### Linking Strategy

| Scenario | Flag | Example |
|----------|------|---------|
| Enhancement to in-progress work | `--parent <current-id>` | Stacking is child of power-up system |
| Related but independent feature | `--discovered-from <current-id>` | Bug found while working |
| Extends a closed issue | `--discovered-from <closed-id>` | New capability for shipped feature |
| Completely new work | (no flag) | Unrelated feature request |

### Workflow

1. **Pause implementation** - Don't start coding new requests immediately
2. **Create work item(s)** - One per discrete piece of work
3. **Link appropriately** - Use the linking strategy above
4. **Confirm with user** - Show created items before proceeding
5. **Mark in_progress** - Then begin implementation

```bash
# User asks: "update power-ups to support stacking with v1/v2/v3 levels"
# While working on: AES-42 (power-up spawn system)

bd create "Implement Shield stacking (v1/v2/v3)" --type feature --parent AES-42
bd create "Implement Rapid-fire stacking (v1/v2/v3)" --type feature --parent AES-42
```

### Exception: Trivial Changes

Skip work item creation for:
- Typo fixes
- Minor tweaks ("make it blue instead of green")
- Clarifications of existing issue scope

## Labels

Tag work items for filtering and organization:

```bash
bd create "Add dark mode" --type feature -l "frontend,ui"
bd label add AES-42 "urgent" "needs-review"
bd label remove AES-42 "urgent"
bd list --label "frontend"           # Issues with this label
bd list --label-any "frontend,backend"  # OR matching
```

## Issue Naming Convention

Use clear, action-oriented titles:
- `Implement [component/feature]`
- `Add [functionality] to [area]`
- `Fix [bug description]`
- `Update [docs/config] for [change]`

## View the Work Queue

```bash
bd list                    # All issues
bd ready --json            # Unblocked work (structured)
bd show <id>               # Issue details
bd dep tree <id>           # View dependency graph
```

## Filtering Issues

```bash
bd list --status open --type bug       # Open bugs
bd list --title-contains "auth"        # Search by title
bd list --no-assignee                  # Unclaimed work
bd list --created-after 2025-01-01     # Recent issues
bd list --label "frontend" --priority-max 1  # Combine filters
```

## Work Item Quality

Before marking a work item as ready, apply the **self-sufficiency test**: could a fresh session read this item's description and implement it without any additional codebase research or verbal context? If not, enrich the description with more detail.

For formal templates, cynefin classification, and sizing guidance, see `rules/work-item-templates.md`.
