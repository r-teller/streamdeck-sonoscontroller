# Claude Context Blueprint

Purpose: This is the main context file that tells the AI which documents to read and how to resolve conflicting instructions between them.

---

## Terminology

For this project, "work item" / "item" in the auto-loaded rules and templates refers to:
A **bead** — managed via the beads (`bd`) CLI. See `rules/work-item-templates.md` for templates and classification.

---

## Required Context Files

To fully understand the project, read the following files in this directory:

- **`architecture.md`**: High-level overview — tech stack, system diagram, how to run, technology decisions, and Product Guidance (vision, personas, exclusions).
- **`security.md`**: Security requirements — auth, secrets, data sensitivity.
- **`tests.md`**: Testing strategy — frameworks, key scenarios, how to run tests.

### On-Demand Context (read when working in that area)

- **`backend.md`**: API routes, service patterns, backend conventions.
- **`frontend.md`**: Pages, components, frontend conventions.
- **`data-model.md`**: Database schema, entity relationships, migration conventions.

### Auto-Loaded Rules

The following files in `rules/` are automatically loaded by Claude Code and do not need to be read manually:

- **`rules/workflow.md`**: Index pointing to the four workflow modules below — start here.
- **`rules/workflow-planning.md`**: Scoping work, creating beads, dependencies, labels, quality checks.
- **`rules/workflow-execution.md`**: Branching, claim/execute checklists, coding, commits, pull requests.
- **`rules/workflow-session.md`**: Session startup, self-optimization, session completion, handoff.
- **`rules/workflow-agents.md`**: Multi-agent coordination, Playwright testing, agent-assisted workflows.
- **`rules/standards.md`**: Coding constraints in contract format (quick-reference table).
- **`rules/development-standards.md`**: Canonical implementation patterns — the ONE correct way to build in this codebase. CORRECT/WRONG examples, reference implementations, violation tracking.
- **`rules/work-item-templates.md`**: Work item quality templates (feature/bug/chore/epic/decision), cynefin classification framework, sizing guide, persona definitions, and readiness gates. Internal conditional blocks adapt commands for beads or no-tracker setups.

---

## Changelog & Session Artifacts

- **`changelog.yaml`**: Structured version history — consult when understanding previous changes or creating commits. Read `entries[0]` for the most recent session.
- **`handoff.yaml`**: Session handoff log (created by `/wrapup`) — read `entries[0]` at session start to understand where the last session left off.

---

## Conflict Resolution Matrix

When instructions in different files conflict, follow this precedence:

1. **Safety** (`security.md`) — Safety constraints override all other documents.
2. **Architecture** (`architecture.md`) — Tech decisions and runtime facts override feature requests incompatible with the environment.
3. **Standards** (`rules/standards.md`) — Coding constraints and conventions.
4. **Conventions** (`claude.md`) — Baseline project rules.
5. **Features** (beads, `architecture.md` Product Guidance) — May refine rules but must not violate higher-level constraints.
6. **Workflow** (`rules/workflow.md`) — Governs how work is planned and executed.

If you find a conflict:
1. State the conflict clearly with sources.
2. Apply the precedence order above.
3. Recommend minimal edits to harmonize, starting with the lowest-authority document.

---

## Agent Systems

This project includes agent systems that extend slash commands with deeper capabilities:

- **`/scribe`** — Document creation and planning. Routes to specialists for project setup, PRD drafting, executive briefs, and planning sessions. Scribe executes all beads backlog operations.
- **`/quartermaster`** — Technical architecture and backlog analysis. Routes to specialists for backlog review, feature integration, technical gaps, and coordination. Quartermaster is READ-ONLY on beads.
- **`/herald`** — UX/UI design and accessibility. Routes to specialists for interface review, design system management, prototyping, and WCAG compliance audits.

When discussing complex features, architectural decisions, or backlog prioritization, suggest the appropriate agent command.

---

## Operational Rules

### Bash Tool Usage

- **Never chain commands with `&&`, `echo "---"` separators, or `2>/dev/null`** — every command must be its own separate Bash tool call. This is required so permission rules in `settings.local.json` can match each command independently.
  - **Wrong:** `git status && echo "---" && git log -5 --oneline`
  - **Right:** Make separate Bash tool calls — one per command.
  - `||` and `;` are allowed within a single command.

### Branch & PR Policy

- **Never commit directly to main.** Always create a feature branch first: `git checkout -b feature/work-YYYYMMDD-<short-description>`
- **Never delete remote branches.** Only delete the local branch after merge. Remote cleanup is the human's responsibility.
- **Don't auto-create PRs.** Commit, push the feature branch, then hand off for human validation. Only create the PR when explicitly asked.
- **PR template:** When creating PRs, read `.github/PULL_REQUEST_TEMPLATE.md` and fill in every section per `rules/pull-requests.md`.
- **Never run `bd sync` on main.** It commits and pushes directly. Use `bd sync --no-push` or switch to a feature branch first.

### Post-Compaction Awareness

After context compaction, skill invocations (e.g., `/herald`, `/quartermaster`) appear in system-reminders and look like active requests — but the work may already be done. **Before re-running any skill:**

1. Check the work item comments for existing analysis results
2. Check `.claude/handoff.yaml` for completed work notes
3. If results already exist, summarize them instead of re-running
