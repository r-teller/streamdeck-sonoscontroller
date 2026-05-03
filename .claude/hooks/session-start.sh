#!/bin/bash
# =============================================================================
# session-start.sh — Inject session ID into Claude's context
# =============================================================================
#
# PURPOSE
#   Runs on the SessionStart hook event to inject the session ID into Claude's
#   conversation context. This is minimal metadata needed for session tracking.
#
# HOW IT WORKS
#   Claude Code fires SessionStart and pipes a JSON object to stdin containing:
#     { "session_id": "uuid", "transcript_path": "...", "cwd": "...", ... }
#
#   This script extracts session_id and transcript_path, echoing them to stdout
#   (injected into context). Claude can then pass transcript_path to
#   token-tracking.sh for per-work-item effort tracking.
#
# FIRES ON
#   - New session startup
#   - Session resume (claude --resume)
#   - After /clear
#   - After context compaction
#
# REGISTRATION (in .claude/settings.local.json)
#   "hooks": {
#     "SessionStart": [{
#       "hooks": [{
#         "type": "command",
#         "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/session-start.sh"
#       }]
#     }]
#   }
#
# DEPENDENCIES
#   - jq (JSON processing)
#
# =============================================================================

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // ""')

# Inject into Claude's context (SessionStart stdout -> context)
echo "Session ID: $SESSION_ID"
if [ -n "$TRANSCRIPT" ]; then
    echo "Transcript: $TRANSCRIPT"
fi
