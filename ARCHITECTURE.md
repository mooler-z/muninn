# Architecture

## The shape of it

```
┌──────────────────┐   Stop hook fires,        ┌──────────────────┐
│  Claude Code /   │   payload on stdin        │  muninn-forward  │
│  Codex, working  │ ────────────────────────► │  (tiny shim)     │
│  in a terminal   │                           └────────┬─────────┘
└──────────────────┘                                    │ POST localhost
                                                        ▼
                                              ┌──────────────────┐
                                              │  Muninn app      │
                                              │  ─ receiver      │
                                              │  ─ normaliser    │
                                              │  ─ panel + sound │
                                              └──────────────────┘
```

Three pieces, deliberately small.

### 1. The shim (`muninn-forward`)

A single executable the agent invokes. It reads JSON on stdin and POSTs it to
the running app. If the app is not running it writes the payload to a spool
directory instead, so nothing is lost — the app drains the spool at next launch.

It must be fast and silent. It runs inside the agent's stop path; if it hangs,
the agent appears to hang. Hard timeout of 500 ms, exit 0 no matter what — a
watchdog thread enforces the budget rather than each step being trusted to be
quick, and a panic hook makes exit 0 true even when something goes wrong.

**It never parses the payload.** The source and kind go in the query string
(`POST /event?source=claude-code&kind=completed`) and the agent's stdin becomes
the request body untouched. Normalising, resolving the git branch and parsing
the summary all happen in the app, off the stop path. That is what lets the shim
have no dependencies at all, and it means a payload shape we have never seen
still arrives intact.

### 2. The receiver

Listens on `127.0.0.1` and nowhere else — the payload contains the working
directory and the agent's full closing message, which is private.

Localhost is necessary but not sufficient: a web page the user visits can also
reach `127.0.0.1`. So the receiver requires a per-run token, refuses anything
carrying an `Origin` header, and insists on `application/json`. The app publishes
the token and the port it actually bound to in `runtime.json`, which the shim
reads — so a busy port costs nothing rather than costing a summary. See
[ADR-0005](docs/decisions/0005-authenticating-the-local-receiver.md).

Normalises each source into one internal event:

```jsonc
{
  "source": "claude-code",
  "sessionId": "abc123",
  "cwd": "/Users/me/project",
  "project": "project",          // basename of cwd, for grouping
  "gitBranch": "main",           // when resolvable, read from .git/HEAD
  "kind": "completed",           // completed | needs-input | failed*
  "receivedAt": "2026-08-17T09:12:03Z",
  "summary": { /* see docs/summary-contract.md */ },
  "raw": "…the agent's closing message, verbatim…"
}
```

`raw` is always kept. If the structured parse fails, the panel renders `raw` as
markdown — a degraded panel is fine, an empty one is not.

\* `failed` is defined but nothing currently produces it: no Claude Code hook
event distinguishes a turn that failed from one that finished. It stays in the
enum so the panel's handling exists before a source that can report it does.

### 3. The panel

A window that appears, renders, plays a sound, and gets out of the way. See
[docs/design-principles.md](docs/design-principles.md) for the rules it obeys.

---

## Why not scrape the terminal

Because we do not have to. Claude Code's `Stop` hook hands over
`last_assistant_message` — the agent's own final text — directly on stdin. That
is a supported interface with a stable shape.

Scraping would mean parsing ANSI escape codes out of a scrollback buffer we do
not own, breaking on every UI change upstream. See
[ADR-0002](docs/decisions/0002-stop-hook-not-scraping.md).

## Why not read the transcript file

The `Stop` payload also carries `transcript_path`, pointing at the session's
`.jsonl`. It is tempting, and it is the wrong default: **the transcript is
written asynchronously and lags the in-memory conversation**, so at the moment
the hook fires the final message may not be in the file yet. Claude Code's own
documentation says to prefer `last_assistant_message` for exactly this reason.

The transcript remains useful for *context* — what happened earlier in the
session, which files were touched — and Muninn may read it lazily after the
panel is already on screen. It is never on the critical path.

## Why the agent writes the summary

Muninn could summarise the transcript itself with a model call. That would be
slower, cost money per completion, and produce a worse result — the agent that
did the work knows what it did and why, including what it decided not to do.

So Muninn asks the agent to close with a structured block, and parses that. When
the block is absent, it falls back to rendering the raw closing message. See
[ADR-0004](docs/decisions/0004-agent-authored-summaries.md).

## Failure modes, and what happens

| Failure | Behaviour |
|---|---|
| App not running when hook fires | Shim spools to disk; app drains on launch |
| Preferred port already taken | App binds an ephemeral one and publishes it; shim follows |
| Shim cannot reach app (crash, stale port) | Spool, then exit 0 silently — never block the agent |
| Receiver rejects the payload | Spool, so a bad token or a changed contract does not lose it |
| Summary block missing or malformed | Render `raw` as markdown, flag it quietly |
| Payload missing `last_assistant_message` | Show project + "finished, no summary" |
| Two agents finish at once | Queue panels; never stack windows |
| Very long summary | Panel scrolls; first screen must carry the outcome |
| Away for a fortnight, hundreds spooled | Replay the most recent 20; say how many were dropped |

Every one of these ends in the payload being spooled or shown, never dropped
silently. The three that matter most to the agent — receiver unreachable,
refusing, and hanging — have tests in
`crates/muninn-forward/tests/never_blocks_the_agent.rs` asserting exit 0 inside
the budget, because that failure is the one that would feel like Muninn broke
the user's agent.

## Platform

macOS first — it is where the author works and where the agent tooling is most
used. Linux second (`notify-send`, same shim). Windows last.

The panel is a native-feeling window, not a notification-centre toast: toasts
are capped in length and cannot render markdown, which defeats the entire point.
A toast may *accompany* the panel when the app is in the background.

## Stack

See [ADR-0003](docs/decisions/0003-tauri-over-electron.md). Short version: Tauri,
because this thing sits in your menu bar all day and a 200 MB idle Electron
process for a window you see six times a day is indefensible.
