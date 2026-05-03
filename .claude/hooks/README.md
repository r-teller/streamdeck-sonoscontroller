# Hooks

Shell scripts that integrate with Claude Code's hook system for session tracking and effort measurement.

## Setup

Add this to `.claude/settings.local.json` to register the hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/session-start.sh"
      }]
    }]
  }
}
```

## Available Hooks

### session-start.sh

Fires on every session start (new session, resume, /clear, compaction). Injects the session ID and transcript path into Claude's context so token tracking knows where to read.

### token-tracking.sh

Measures token usage per work item by scanning the session transcript. Works with any tracker — pass any unique ID (bead ID, manual label).

```bash
# Start tracking when you claim a work item
.claude/hooks/token-tracking.sh start <work-id> <transcript-path>

# Check progress mid-work
.claude/hooks/token-tracking.sh status <work-id> <transcript-path>

# Done — get final report
.claude/hooks/token-tracking.sh stop <work-id> <transcript-path> --json

# See all tracked items
.claude/hooks/token-tracking.sh list
```

The transcript path is injected by `session-start.sh` at the beginning of each session.

## How It Fits Into the Workflow

1. `/gogogo` or `/leroy` starts a session — `session-start.sh` injects session ID + transcript path
2. When you claim a work item, Claude runs `token-tracking.sh start <id> <transcript>`
3. Work happens normally
4. `/wrapup` runs `token-tracking.sh stop <id> <transcript> --json` and records the effort in `handoff.yaml`
5. Over time, effort data helps calibrate the sizing guide in `rules/work-item-templates.md`
