# 4. The agent writes its own summary

**Status:** accepted · 2026-08-17

## Context

The panel needs a structured, readable summary. Either Muninn generates it from
the transcript with a model call, or the agent emits it as part of its turn.

## Decision

The agent writes it, in a fenced `muninn` block. See
`docs/summary-contract.md`. Muninn parses that block, and falls back to
rendering the raw closing message when it is missing or malformed.

## Reasoning

The agent that did the work knows what it did, what it chose not to do, and what
it is unsure about. A summariser reading the transcript afterwards is guessing
at intent from artefacts.

A separate model call would also add latency at exactly the wrong moment, cost
money per completion, and introduce a second thing that can be wrong.

## Consequences

- Muninn's quality depends on a prompt fragment the user must install. This is a
  real onboarding cost and the installer must handle it.
- Output quality varies by agent and by model.
- **The fallback path is not optional.** Many turns will not carry the block, and
  a panel that renders nothing in that case is broken. Raw markdown is always
  better than empty.
- `verified` is agent-claimed, not observed. The UI must not present it as
  verification Muninn performed — see `docs/design-principles.md`.
