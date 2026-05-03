# Workflow: Session Lifecycle

Purpose: How to start a session, reflect on completed work, and hand off cleanly.

> **Terminology for this project:**
> "Work item" / "item" / "issue" throughout this file refers to a **bead** — managed via the beads (`bd`) CLI.

Use this file at the **beginning and end** of every session. It covers startup
orientation, self-optimization after completing work, and clean handoff. Do not
use this file for implementation details — see `workflow-execution.md` for
branching, commits, and claim/execute checklists.

> **New to beads?** Start with just two commands: `bd create "task description"` to capture work and `bd close <id>` when it's done. The full workflow below is where you'll end up, but you don't need all of it on day one.

---

## Session Startup

On session start, orient yourself with the current work state.

```bash
bd quickstart            # Onboard to beads (first time)
bd ready --json          # Get unblocked work as structured data
bd list --status open    # See all open issues
bd stale --days 7        # Find neglected issues
```

Review the output to understand:
- What work is ready to be claimed
- What's currently in progress (may need continuation)
- Any blockers or dependencies


### First-Time Setup (Optional)

Install Claude Code hooks for automatic context refresh:

```bash
bd setup claude          # Global installation
bd setup claude --project  # Project-only
bd setup claude --check  # Verify status
```

---

## Self-Optimization Routine

After completing significant work, analyze if patterns should be captured.

### Analyze

Review the work just completed:
- Did the user correct your approach?
- Did you discover undocumented conventions?
- Did a command need extra flags?

### Capture Follow-ups

If you identify improvements or follow-up work:

```bash
bd create "Update [file] to document [pattern]" --type enhancement
bd create "Add [convention] to project guidance" --type docs
```

### Compare

Check against current `.md` context files (AGENTS.md, workflow files, etc.).

### Recommend

If a documentation update is warranted, propose the specific edit:
- **Proposed Change:** Exact text to add/remove/change
- **Reasoning:** How this improves future interactions
- **Risk:** Any new burden this introduces

It is perfectly acceptable to find no patterns worth capturing. Improve slowly and iteratively.

---

## Session Completion

Before ending a work session, complete ALL steps:

1. **File items** for any remaining or discovered work
2. **Run quality gates** (tests, linters, builds) if code changed
3. **Close completed items** via `bd close <id>`
4. **Push the feature branch:**
   ```bash
   git push -u origin <branch-name>
   ```
5. **Create PR if work is complete** (see `workflow-execution.md`: Pull Requests)
   - Include all completed items in the PR description
   - Distinguish planned items from items created during development
6. **If work continues next session:**
   - Leave branch open, push current state
   - Document progress in commit messages
7. **Hand off** - provide context for next session
8. **Write handoff note** — Run `/wrapup` to create a structured handoff at `.claude/handoff.yaml`. The next session's `/gogogo` or `/leroy` will read this to orient quickly.
