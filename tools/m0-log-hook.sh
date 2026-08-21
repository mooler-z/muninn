#!/bin/sh
# M0 — prove the payload. See docs/roadmap.md.
#
# Registered as a Claude Code `Stop` hook, this appends each hook payload to
# captures/ so the roadmap's questions can be answered against real sessions:
# is last_assistant_message always populated, how long are real closing
# messages, and does the hook add perceptible latency.
#
# It parses nothing. Every payload is written verbatim to its own file, so this
# script cannot mangle a payload it does not understand, and the whole thing
# stays a few milliseconds of shell. Analysis happens offline in m0-report.sh.
#
# It obeys the same contract the real shim will: never write to stdout (Claude
# Code interprets hook stdout), and always exit 0 (a notification shim must
# never look like a failure to the agent).

set -u

# Resolve relative to the script, not the cwd — the hook runs wherever the
# agent happens to be working.
dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 0
out="$dir/captures"

mkdir -p "$out" 2>/dev/null || exit 0

# Second resolution plus pid is enough: two turns cannot finish in the same
# second in the same process.
cat > "$out/$(date -u +%Y%m%dT%H%M%SZ)-$$.json" 2>/dev/null

exit 0
