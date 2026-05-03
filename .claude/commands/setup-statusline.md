---
description: Set up a persistent context usage status line in Claude Code (one-time setup)
tier: scale
version: 1.0.0
created: 2026-03-21
changelog:
  - 1.0.0 (2026-03-21): Initial tiered version
---

# Status Line Setup

This command sets up a persistent status bar at the bottom of your Claude Code terminal that shows real-time token usage with color-coded warnings.

**This is a one-time setup** that applies to all your Claude Code sessions across all projects.

---

## What You'll Get

A status bar showing:
```
Opus 4.6 | feature/my-branch | Used: 143k/200k | 6% until compact | in:0k cache:143k out:0k
```

- **Green:** >40% until compact (comfortable)
- **Yellow:** 20-40% until compact (getting tight)
- **Red:** <20% until compact (autocompact imminent)
- **Branch:** current git branch in magenta (when in a git repo)

---

## Setup Process

### Step 1: Check Prerequisites

First, verify that `jq` is installed (required for JSON parsing):

```bash
which jq
```

If `jq` is not installed, inform the user:
- **macOS:** `brew install jq`
- **Linux:** `apt install jq` or `yum install jq`
- **Windows (WSL):** `apt install jq`

Do not proceed until `jq` is available.

### Step 2: Create the Status Line Script

Create the file `~/.claude/statusline.sh` with the following content:

```bash
#!/bin/bash
input=$(cat)
MODEL=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
CONTEXT_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
USAGE=$(echo "$input" | jq '.context_window.current_usage // null')
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
RESET="\033[0m"; DIM="\033[2m"; BOLD="\033[1m"
GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"; MAGENTA="\033[35m"
AUTOCOMPACT_BUFFER_PERCENT=22.5
if [ "$USAGE" != "null" ] && [ "$CONTEXT_SIZE" != "0" ]; then
    INPUT=$(echo "$USAGE" | jq '.input_tokens // 0')
    CACHE_CREATE=$(echo "$USAGE" | jq '.cache_creation_input_tokens // 0')
    CACHE_READ=$(echo "$USAGE" | jq '.cache_read_input_tokens // 0')
    OUTPUT=$(echo "$USAGE" | jq '.output_tokens // 0')
    CURRENT=$((INPUT + CACHE_CREATE + CACHE_READ))
    USABLE_CAPACITY=$(awk "BEGIN {printf \"%.0f\", $CONTEXT_SIZE * (100 - $AUTOCOMPACT_BUFFER_PERCENT) / 100}")
    FREE_UNTIL_COMPACT=$((USABLE_CAPACITY - CURRENT))
    [ "$FREE_UNTIL_COMPACT" -lt 0 ] && FREE_UNTIL_COMPACT=0
    PERCENT_UNTIL_COMPACT=$((FREE_UNTIL_COMPACT * 100 / USABLE_CAPACITY))
    if [ "$PERCENT_UNTIL_COMPACT" -lt 20 ]; then FREE_COLOR="${RED}${BOLD}"
    elif [ "$PERCENT_UNTIL_COMPACT" -lt 40 ]; then FREE_COLOR="${YELLOW}"
    else FREE_COLOR="${GREEN}"; fi
    printf "${DIM}${CYAN}%s${RESET} " "$MODEL"
    [ -n "$BRANCH" ] && printf "${DIM}|${RESET} ${MAGENTA}%s${RESET} " "$BRANCH"
    printf "${DIM}|${RESET} ${DIM}Used:${RESET} %dk/%dk " "$((CURRENT/1000))" "$((CONTEXT_SIZE/1000))"
    printf "${DIM}|${RESET} ${FREE_COLOR}%d%% until compact${RESET} " "$PERCENT_UNTIL_COMPACT"
    printf "${DIM}| in:%dk cache:%dk out:%dk${RESET}" "$((INPUT/1000))" "$(((CACHE_CREATE+CACHE_READ)/1000))" "$((OUTPUT/1000))"
else
    printf "${DIM}${CYAN}%s${RESET}" "$MODEL"
    [ -n "$BRANCH" ] && printf " ${DIM}|${RESET} ${MAGENTA}%s${RESET}" "$BRANCH"
    printf " ${DIM}| Context: Ready${RESET}"
fi
```

Make it executable:
```bash
chmod +x ~/.claude/statusline.sh
```

### Step 3: Update Claude Code Settings

Read the existing `~/.claude/settings.json` file (if it exists).

Add or update the `statusLine` block:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 0
  }
}
```

**Important:** Preserve any existing settings (like `hooks`, `permissions`, etc.) when updating the file.

### Step 4: Confirm Success

Tell the user:

"Status line has been set up successfully!

**What was installed:**
- Created `~/.claude/statusline.sh` - the script that generates the status display
- Updated `~/.claude/settings.json` - configured Claude Code to use the script

**Next step:** Restart Claude Code to see the status line.

**Why this helps:** The status line shows you how much context remains before autocompact triggers. This helps you:
- Know when to start a fresh session
- Avoid losing important context to autocompact
- Stay aware of token usage as you work

**To verify it's working:** After restarting, you should see a status bar at the bottom of your terminal. Run `/context` to compare the percentages.

**To uninstall:** See `docs/statusline-guide.md` for removal instructions."

---

## If Already Installed

Check if `~/.claude/statusline.sh` already exists. If so, ask the user:

"The status line script already exists. Would you like to:
1. **Update it** - Replace with the latest version
2. **Skip** - Keep the existing installation"

If they choose to update, overwrite the script and settings.
