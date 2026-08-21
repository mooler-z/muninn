#!/bin/sh
# Make the panel appear, without waiting for an agent to finish.
#
#   tools/demo.sh              a completed turn with a full summary
#   tools/demo.sh blocked      blocked — takes the headline slot
#   tools/demo.sh raw          no muninn block, so the prose fallback
#   tools/demo.sh empty        finished with nothing to say
#   tools/demo.sh waiting      needs-input, with the quieter sound
#   tools/demo.sh queue        three at once, to see the pager
#
# The app must be running (`pnpm tauri dev`). Everything goes through the real
# shim, so this exercises the same path a real Stop hook does.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
shim="$root/target/release/muninn-forward"

[ -x "$shim" ] || {
  echo "building the shim first…" >&2
  (cd "$root" && cargo build --release -p muninn-forward)
}

send() { # send <kind> <message>
  printf '{"session_id":"demo","cwd":"%s","hook_event_name":"Stop","last_assistant_message":%s}' \
    "$root" "$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    | "$shim" --source claude-code --kind "$1"
}

full='Right, that is the phone verification done.

```muninn
done: Added phone-number verification to the signup flow and got the suite green.
changed:
  - apps/api/src/auth/verify.ts — new OTP issue and verify endpoints
  - apps/web/app/signup/page.tsx — phone step before the password screen
verified: 34 tests pass; sent an OTP to a real number against the sandbox.
next: Wire the rate limiter — sending is unbounded, so one number can be spammed.
risk: The OTP store is in-memory; a deploy wipes pending codes.
```'

blocked='```muninn
done: Added phone-number verification to the signup flow and got the suite green.
next: Wire the rate limiter once the key lands — sending is unbounded right now.
blocked: Needs a Twilio production key — the sandbox only sends to verified numbers.
```'

raw='Switched the exporter to stream rows instead of buffering the whole table —
memory stays flat around 60 MB on the four-million-row backfill.

The old path is still there behind `EXPORT_STREAMING=0` if anything looks off.

The nightly job needs the new IAM role before Thursday'"'"'s run.'

case "${1:-full}" in
  full)    send completed "$full" ;;
  blocked) send completed "$blocked" ;;
  raw)     send completed "$raw" ;;
  empty)   send completed "" ;;
  waiting) send needs-input "" ;;
  queue)
    send completed "$full"
    send completed "$blocked"
    send completed "$raw"
    ;;
  *) echo "unknown state: $1" >&2; exit 1 ;;
esac

echo "sent. The panel is top-right, under the menu bar."
