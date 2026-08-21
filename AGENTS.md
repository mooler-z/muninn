# Working on Muninn

Instructions for AI agents (and humans) contributing to this repository.

## What this project is

A desktop companion that tells you what your coding agent achieved while you
were away. Read [README.md](README.md) and
[docs/product-brief.md](docs/product-brief.md) before changing anything.

## The one thing to keep in mind

**The user is not watching.** They stepped away deliberately. Every decision —
sound design, panel timing, how much text — follows from that. If a change makes
sense only for someone staring at the screen, it is wrong for this project.

## Before you write code

0. Read [docs/working-on-muninn.md](docs/working-on-muninn.md). It is how to
   build and actually see your change, and it will save you an afternoon —
   `cargo build --release` does **not** produce a working app.
1. Check [docs/decisions/](docs/decisions/) — several obvious-looking approaches
   were already considered and rejected, with reasons.
2. If you are about to contradict an ADR, that is allowed, but write a new ADR
   superseding it rather than quietly diverging.
3. Interfaces to Claude Code and Codex change. **Verify payload shapes against
   the live tool before relying on a field**, even one documented here. Anything
   marked UNVERIFIED must be confirmed before it is implemented.

## Hard rules

- **The shim must never block the agent.** It runs in the stop path. Hard
  timeout, always exit 0, never write to stdout.
- **The receiver binds to `127.0.0.1` only.** Payloads carry the user's working
  directory and the agent's full output. Nothing leaves the machine.
- **No telemetry.** Not opt-out; absent.
- **The raw fallback is not optional.** Any change to summary parsing must keep
  the path where the block is missing or malformed and the raw message renders
  anyway.
- **Never present agent claims as Muninn's own verification.** See
  [docs/design-principles.md](docs/design-principles.md) §5.

## Style

- Prose in docs, not bullet soup. Full sentences.
- Comments explain *why*, never *what*. If a decision looks strange, the comment
  says what breaks without it.
- No dependency without a reason that survives being asked "what does this cost
  us at idle?"

## Testing

Anything touching the shim needs a test that it exits 0 and within budget when
the receiver is unreachable, refusing connections, and hanging. That failure
mode is the one that would make Muninn feel like it broke the user's agent, and
it is the reason they would uninstall it.
