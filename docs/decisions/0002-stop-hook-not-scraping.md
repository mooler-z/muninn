# 2. Take the summary from the Stop hook, not the terminal

**Status:** accepted · 2026-08-17

## Context

Muninn needs the agent's closing message. Three ways to get it:

1. Scrape the terminal scrollback.
2. Read the session transcript file (`transcript_path`).
3. Take `last_assistant_message` from the `Stop` hook payload.

## Decision

Use the `Stop` hook payload. Treat the transcript as optional, late context
only. Never scrape.

## Reasoning

Scraping means parsing ANSI escapes out of a buffer we do not own, breaking
every time the agent's UI changes. It also cannot tell "finished" from "printed
something".

The transcript is the seductive wrong answer: it is a real file with real
content, but **it is written asynchronously and lags the live conversation**, so
at the instant the hook fires the final message may be absent. Claude Code's own
documentation says to prefer `last_assistant_message` for this reason. A tool
whose entire job is reporting the last message must not race the file that
contains it.

`last_assistant_message` is a supported field, delivered synchronously, exactly
when we need it.

## Consequences

- Muninn requires hook configuration; it cannot work by passive observation.
  Installation must therefore edit `settings.json`, merging carefully.
- Sources that do not expose the final message (possibly Codex) need a separate,
  worse path. Recorded in `docs/integrations/codex.md`.
