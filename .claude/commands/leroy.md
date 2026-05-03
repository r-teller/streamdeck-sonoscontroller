---
description: Lightweight session startup — env check, git status, navigator subagent for context-efficient orientation
tier: scale
version: 2.2.0
created: 2026-03-21
changelog:
  - 2.2.0 (2026-04-25): Add worked_beads object schema reference in step 1b (metrics:on block)
  - 2.1.0 (2026-04-25): Cynefin column unconditional in work table; coordinate-phase tracking in metrics:on blocks
  - 2.0.0 (2026-03-21): Full rewrite — env checks, session tracking, structured output formatting, post-selection planning
  - 1.0.0 (2026-03-21): Initial tiered version
allowed-tools: Task
---

## Leroy — Token-Efficient Session Startup

Like `/gogogo` but keeps context files out of the main window. The navigator subagent reads everything and returns a summary with recommendations.

**When to use `/leroy` vs `/gogogo`:**
- `/leroy` — focused work, shorter sessions, context-conscious
- `/gogogo` — deep sessions, exploratory work, full context wanted

---

### 0. Status Line Check (First Time Only)

Check if the context status line is configured by checking if `~/.claude/statusline.sh` exists.

**If the file does NOT exist**, offer to set it up:

"I noticed you don't have the context status line configured yet. This shows you real-time token usage at the bottom of your terminal, helping you stay aware of context limits before autocompact triggers.

Would you like me to set it up now? (This is a one-time setup that works across all projects.)"

- **If yes:** Follow the setup process from `/setup-statusline`
- **If no:** Continue with the session startup

**If the file already exists**, skip this step silently and continue.

---

### 1. Quick Environment Check

Read the **Environment Health Checks** table from `.claude/architecture.md` (the "How to Run" section). Run each check command and compare against the expected output.

For each service:
- If healthy: note briefly (e.g., "Backend: healthy")
- If unhealthy or not running: warn with the service name and status
- If the check command fails entirely: note the service is not reachable

Report all results in a compact block before continuing. Do not auto-start services without asking.

If `architecture.md` doesn't have an Environment Health Checks table, fall back to basic checks:
- `curl -s http://localhost:8000/health || echo "not running"` (common backend)
- `docker ps --format "table {{.Names}}\t{{.Status}}"` (Docker services)
- `test -f .env && echo "exists" || echo "missing"` (env file)

And suggest the user add the table to architecture.md for future sessions.

### 1b. Initialize Session Tracking

Create the session tracker JSON for this working session. The session ID is
injected by the session-start hook (visible in context). The transcript path
follows the pattern `~/.claude/projects/{project-hash}/{session_id}.jsonl`.

**Create session tracker** at `.claude/tmp/{session_id}.json` using the Write tool:

```json
{
  "schema_version": 1,
  "session_id": "{session_id}",
  "tracking_mode": "leroy",
  "started": "{UTC ISO8601 timestamp}",
  "branch": "{current git branch}",
  "transcript": "{transcript path from context}",
  "worked_beads": [],
  "compactions": []
}
```


This file is gitignored (`.claude/tmp/.gitignore` excludes `*.json`).

### 2. Git Status Check

- Run `git status` and `git log -5 --oneline` as **two separate sequential Bash tool calls** (never chain with `&&`)
- **If on `main`:** Pull latest with `git pull`, then create a feature branch before any work begins
  - Branch naming: `feature/work-YYYYMMDD-<short-description>`
  - **NEVER commit work directly to `main`** — all work must go through a feature branch + PR
- **If on a feature branch:** Check if it's up to date with origin, pull if needed
- **If there are uncommitted changes:** Ask the user what to do:
  - Commit them now (with a message)
  - Stash them for later
  - Continue without committing

### 3. Session Orientation (Navigator Subagent)

Delegate orientation to the navigator subagent to keep file reads out of the main context window:

Use `Task(subagent_type="navigator")` with prompt:
"Run session orientation for /leroy startup. Follow the procedure in your agent spec exactly — read handoff.yaml, changelog.yaml, run bd commands, and return ALL 7 output checklist sections as raw structured data."

The navigator reads handoff, changelog, and work item state in its own context. Main context only sees the returned summary.

**After the navigator returns, validate and format:**

**Step 3a — Validate.** Check the raw output contains all 7 required section headers:

1. `## 1. Last Handoff`
2. `## 2. Recent Work`
3. `## 3. Epic Health`
4. `## 4. In Progress`
5. `## 5. Ready to Start`
6. `## 6. Load Into Main Context`
7. `## 7. Recommended Work`

If any section is missing, note it when presenting to the user:
"Navigator did not include [section] — may need to check manually."

**Step 3b — Format and present.** Convert the navigator's raw output into formatted tables for the user:

**Last Handoff** — render as a summary block:
```
**Last Session:** [branch] — [focus]
Completed: [work item IDs]. Next: [next_steps or "all done"].
```

**Recent Work** — render inline:
```
**Recent:** v[version] — [summary]
```

**Epic Health** — render as a table:
```
| Epic | Progress | Remaining |
|------|----------|-----------|
| [name] | [N]% ([X]/[Y]) | [Z] items |
```
Sort by completion % descending. Highlight any epic at 80%+ as near-complete.

**In Progress** — render as a table (or "None"):
```
| Item | Type | Description |
|------|------|-------------|
```

**Ready to Start** — render as a table with effort columns:
```
| Pri | Item | Type | Cynefin | ~Turns | Description |
|-----|------|------|---------|--------|-------------|
```
Show `??` for beads missing effort forecasts. Show triage state (`ready`, `triaged`, `backlog`, or `unlabeled` for legacy beads without triage labels). Show Cynefin domain from `cynefin:*` label (or `--` if unclassified). Beads labeled `cynefin:disorder` should be flagged with a warning — they need classification before claiming.

**Recommended Work** — render as numbered options for user selection:
```
1. **Continue:** [item-id] — [title] (if in-progress work exists)
2. **Close out:** [epic name] — [remaining item IDs]
3. **Next up:** [item-id] — [title]
```

**Load Into Main Context** — do not display to user; hold for Step 3e.

**Step 3c — Ask and select.** Ask what the user would like to work on:
   - Continue: [in-progress item if any]
   - Close out: [near-complete epic with specific remaining items]
   - Next up: [top ready item]
   - Something else — describe what you'd like to do

**Step 3d — Plan selected work.** After the user selects beads to work on:

- Gather bead metadata: run `bd show <id>` for each selected bead.
- Call navigator dispatcher with bead IDs + metadata:
  ```
  Task(subagent_type="navigator") with prompt:
  "Route to the appropriate specialist for these beads: [IDs].
  Bead metadata:
  [paste full bd show output for each bead]"
  ```
- Navigator auto-routes to survey (complex/multi-bead) or maintenance (simple/chore).
- Present the returned plan to the user.


**Step 3e — Claim and track.** After the plan is presented and user confirms (and coordinate tracking is stopped if applicable):

- For each bead: verify `bd state <id> triage` returns `ready` or has no triage label (legacy). If `backlog` or `triaged`, complete triage first per workflow.md.
- For each bead: `bd update <id> -s in_progress`
- Read ONLY the context files recommended by the navigator specialist in its output.
- Confirm: "Beads claimed, tracking active. Ready to implement."
