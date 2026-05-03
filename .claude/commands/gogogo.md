---
description: Full session startup — loads context, checks handoff, shows work item health and available work
tier: scale
version: 1.2.0
created: 2026-03-21
changelog:
  - 1.2.0 (2026-04-25): Add coordinate-phase tracking step 8.5 for multi-bead selections; wrap token-tracking in metrics:on blocks
  - 1.1.0 (2026-03-21): Add tracker-conditional blocks, env health check table
  - 1.0.0 (2026-03-21): Initial tiered version
---

# /gogogo — Full Session Startup

Complete session initialization with full context loading and work item tracking.

## Steps

### 0. Status Line Check
- Check if `~/.claude/statusline.sh` exists
- If missing, offer to set it up for session status tracking

### 1. Environment Setup

Read the **Environment Health Checks** table from `.claude/architecture.md` (the "How to Run" section). Run each check command and compare against the expected output.

For each service:
- If healthy: note briefly
- If unhealthy or not running: warn and offer to start it using the commands in "Local Development"
- If the check command fails: note the service is not reachable

If `architecture.md` doesn't have an Environment Health Checks table, fall back to checking common ports (3000, 5173, 8000, 8080) and suggest adding the table.

### 1b. Initialize Session Tracking

Create the session tracker JSON for this working session. The session ID is
injected by the session-start hook (visible in context). The transcript path
follows the pattern `~/.claude/projects/{project-hash}/{session_id}.jsonl`.

**Create session tracker** at `.claude/tmp/{session_id}.json` using the Write tool:

```json
{
  "schema_version": 1,
  "session_id": "{session_id}",
  "tracking_mode": "gogogo",
  "started": "{UTC ISO8601 timestamp}",
  "branch": "{current git branch}",
  "transcript": "{transcript path from context}",
  "worked_beads": [],
  "compactions": []
}
```

This file is gitignored (`.claude/tmp/.gitignore` excludes `*.json`).
If the session-start hook didn't inject a session ID, skip this step (ad-hoc session).

### 2. Git Status
- Run `git status` and `git log -5 --oneline` as **two separate sequential Bash tool calls** (never chain with `&&`)
- **If on `main`:** Pull latest with `git pull`, then create a feature branch before any work begins
  - Branch naming: `feature/work-YYYYMMDD-<short-description>`
  - **NEVER commit work directly to `main`**
- **If on a feature branch:** Check if it's up to date with origin, pull if needed
- If uncommitted changes exist, ask whether to stash, commit, or continue
- If behind remote, run `git pull --rebase`

### 3. Load Project Context
Read these files and hold key details in context:
- `.claude/claude.md` — project identity and conventions
- `.claude/architecture.md` — system overview, tech stack, product guidance, how to run
- `.claude/security.md` — security constraints and practices
- `.claude/tests.md` — testing strategy and patterns

On-demand context (read when working in that area):
- `.claude/backend.md` — backend structure, patterns, and conventions
- `.claude/frontend.md` — frontend structure, patterns, and conventions
- `.claude/data-model.md` — data model, schemas, and relationships

> Note: Files in `rules/` (workflow.md, standards.md, work-item-templates.md) are auto-loaded by Claude Code and do not need manual reads.

If any file is missing, note it but continue.

### 4. Check Handoff
- Read `.claude/handoff.yaml` if it exists
- Summarize the last session's state: what changed, what's left, any gotchas
- If no handoff exists, note this is a fresh start

### 5. Summarize Changelog
- Read `.claude/changelog.yaml` and summarize the 5 most recent entries
- Note any patterns (e.g., lots of bug fixes, new feature streak)

### 6. Work Item Status
- Run `bd epic status` to see epic health and completion percentages
- Run `bd list -s in_progress` to see current work items
- Run `bd ready` to see available work items
- Note any epics nearing completion — these are candidates for close-out

### 7. Environment Check
- Verify `.env` files exist (`.env`, `.env.local`, `.env.development`, etc.)
- Do NOT read or display contents — just confirm presence
- If missing, warn that environment setup may be needed

### 8. Present Options

Output a structured summary:

```
Session ready! Here's what I found:
- **Last session:** [Summary from handoff.yaml]
- **Recent work:** [Summary from changelog]
- **Epic health:** [Summary from bd epic status]
- **In progress:** [Any in-progress beads]
- **Ready to start:** [Available beads from bd ready]

What would you like to work on?
1. Continue: [in-progress bead if any]
2. Close out epic: [epic near completion if any]
3. Next up: [top bead from bd ready]
4. Something else - describe what you'd like to do
```

Wait for the user to choose before proceeding.


### 9. Claim and Track

Once the user selects work:
- Claim it: `bd update <id> --status in_progress`
