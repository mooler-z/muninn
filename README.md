# Muninn

**Wake me when it's done.**

Muninn is a small desktop companion for coding agents. When Claude Code or Codex
finishes working, Muninn opens a calm panel telling you — in a format built for
reading, not scrolling — what the agent achieved and what it plans to do next,
accompanied by a sound that will not make you jump.

It exists so you can walk away. Read something, watch something, make coffee.
Muninn brings word back.

> In Norse myth Odin keeps two ravens. Huginn and Muninn fly out over the world
> each day and return at dusk to perch on his shoulders and tell him what they
> saw. Muninn is the one that carries memory.
>
> Pronounced **MOO-nin**.

---

## Why this exists

Agents got good enough to work unattended for ten or twenty minutes at a time.
The tooling did not keep up. Today you either sit and watch a terminal scroll —
which defeats the point — or you wire up a notification that pings you and tells
you nothing, so you go back to the terminal anyway to find out what happened.

There are already good tools that tell you an agent *stopped*. There is nothing
that tells you what it *did*, in a form you would actually want to read.

Muninn is the second thing.

## What it is not

- **Not a usage tracker.** It does not care about tokens, costs, or quota. That
  space is well served ([Usagebar](https://usagebar.com/),
  [ClaudeBar](https://github.com/tddworks/ClaudeBar), and others).
- **Not a session monitor.** It does not show you a live list of what is
  running. [cc-status-bar](https://github.com/usedhonda/cc-status-bar) and
  [so-agentbar](https://sotthang.github.io/so-agentbar/) do that well.
- **Not a chat client.** You do not reply from Muninn. It carries one direction:
  agent → you.
- **Not a terminal scraper.** See [ARCHITECTURE.md](ARCHITECTURE.md) — the agent
  hands us the summary directly.

## How it works, in one paragraph

Claude Code fires a `Stop` hook when it finishes a turn, and passes a JSON
payload on stdin that already contains `last_assistant_message` — the agent's
own closing summary. Muninn registers a hook that forwards that payload to a
local receiver, renders the message as markdown in a panel, and plays a quiet
sound. No polling, no log parsing, no screen scraping.

The quality of the panel therefore depends on the agent writing a good closing
message. Muninn ships a prompt fragment that asks it to — see
[docs/summary-contract.md](docs/summary-contract.md).

## Status

Pre-alpha. Documentation first; no code yet.

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit and why |
| [docs/product-brief.md](docs/product-brief.md) | Who it is for, what it must do |
| [docs/design-principles.md](docs/design-principles.md) | Calm-software rules the UI must obey |
| [docs/summary-contract.md](docs/summary-contract.md) | The structured block agents should emit |
| [docs/integrations/claude-code.md](docs/integrations/claude-code.md) | Hook events, payload schema, setup |
| [docs/integrations/codex.md](docs/integrations/codex.md) | Codex CLI notifications (unverified) |
| [docs/roadmap.md](docs/roadmap.md) | Order of work |
| [docs/decisions/](docs/decisions/) | Architecture decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Working on this repo |
| [AGENTS.md](AGENTS.md) | Instructions for AI agents working on this repo |
