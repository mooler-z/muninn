# 5. Authenticate the receiver, and discover its port

**Status:** accepted · 2026-08-17

Amends the receiver described in [ARCHITECTURE.md](../../ARCHITECTURE.md), which
specified a fixed port and localhost binding as the whole of its defence.

## Context

ARCHITECTURE.md says the receiver "listens on `127.0.0.1` on a fixed port.
Localhost only, never bound to `0.0.0.0` — the payload contains the working
directory and the agent's full closing message, which is private."

Binding to localhost is necessary and it is not sufficient. Two gaps showed up
as soon as the receiver was real:

**A web page can reach `127.0.0.1`.** Any site the user visits can `fetch` or
submit a form to a known local port. It cannot read the response without CORS,
but it does not need to — posting is enough to put a fabricated panel on screen.
For a tool whose entire value is that the user trusts what the panel says, a
stranger being able to write to it is the worst available bug. "Localhost only"
protects against the network; it does not protect against the browser.

**A busy port silently costs a summary.** The failure table promises the shim
spools when it cannot reach the app, but with a hardcoded port there is no way
to tell "the app is not running" from "the app is running somewhere else" — and
if another process holds 8787 first, the app has nowhere to listen and every
turn is spooled forever. The table's own row, "shim cannot reach app (port busy,
crash) → exit 0 silently", contradicts the promise two paragraphs above it that
nothing is lost.

## Decision

The app mints a random 32-byte token at startup, binds a port, and writes both
to `runtime.json` in its data directory with mode 0600. The shim reads that file
on every invocation and sends the token as `X-Muninn-Token`.

The receiver requires, in order: no `Origin` header, `POST /event`, a matching
token, `Content-Type: application/json`, and a body under 1 MiB.

The port is 8787 when it is free and an ephemeral one when it is not. Because
the shim learns the port from the file rather than assuming it, a collision
stops being an event at all.

## Reasoning

The `Origin` check is what actually closes the browser hole, and it is reliable
in a way an allowlist would not be. Browsers attach `Origin` to every
cross-origin request and script cannot remove it; our shim never sends one. Its
presence is therefore positive evidence that the caller is a web page, whatever
else the request claims. The token then handles everything that is not a
browser.

Requiring `application/json` costs nothing and rules out the form-encoded POST,
which is the one shape a page can send cross-origin without a preflight.

Writing the port to a file adds a small file read to the shim's hot path. That
is a few hundred microseconds against a 500 ms budget, and it buys the "nothing
is lost" promise back.

## Consequences

- The shim can no longer work without the app having run at least once. This is
  the same condition as before in practice — with no app there is nothing to
  deliver to — and it fails in the right direction: no file means spool.
- A stale `runtime.json` after a crash points at a dead port. The shim's connect
  fails inside its timeout and the payload spools, so the cost is one panel
  arriving at next launch rather than immediately.
- `runtime.json` is removed on a clean exit.
- The token is per-run, not persisted. Nothing needs it across restarts, and a
  secret with no lifetime is one fewer thing to leak.
- ARCHITECTURE.md's receiver section and failure table are updated to match.
