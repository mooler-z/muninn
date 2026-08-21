# Muninn

**Keep your focus while it works. Keep your code when it's done.**

Muninn is an open-source macOS menu-bar companion for the coding agents that
live in your terminal. A terminal cannot tap you on the shoulder — Claude Code,
Codex, every CLI agent finishes into a window you are not looking at, so you
either poll it or doom-scroll while you wait. Muninn fixes both halves: it
knocks the moment a turn ends with a one-line summary of what your agent did
(and the full reasoning behind it), and while the turn runs it can give your
attention somewhere to rest that is not a feed.

**[muninn.moolerz.et](https://muninn.moolerz.et)** · macOS · Claude Code today,
any CLI agent is one small file away

> In Norse myth Odin keeps two ravens. Huginn and Muninn fly out over the world
> each day and return at dusk to tell him what they saw. Muninn is the one that
> carries memory. Pronounced **MOO-nin**.

## Install

```sh
curl -fsSL https://muninn.moolerz.et/install.sh | sh
```

Run it from inside a project. One command installs the app, registers the
Claude Code hooks, drops [MUNINN.md](MUNINN.md) into the project and points
`CLAUDE.md` at it. Run it again any time — it is the update path too. Nothing
else is required: no Rust, no Node, no account.

Per-project setup afterwards is just:

```sh
muninn init
```

## What you get

- **The knock** — three soft, identical, evenly-spaced tones when a turn ends
  (a lower one when the agent is asking rather than finishing). Silent by
  default at night. Never escalates.
- **The panel** — top-right, without taking focus, and it does not time out:
  the premise is that you were not at the desk. Did it work, do you need to
  act, what happens next — answered before you touch anything.
- **The reasoning** — a Details window with the agent's own `explain`: how the
  change works, which function does what, and the constraint that ruled out the
  alternative. So the code stays yours.
- **The honesty rule** — Muninn renders what the agent wrote and never vouches
  for it. "tests pass" is displayed as a quotation, permanently labelled
  *reported*. A missing summary says *finished, no summary* — it is never
  invented.
- **History** — the last fifty turns with the prompts that caused them, in a
  plain JSON file on your disk. Searchable, exportable as markdown.
- **While you wait** (off by default) — Minesweeper in a 5×5×5 volume, a
  first-person maze, chess against a local Stockfish, a runner, a drifting
  raven. One thread of attention instead of a feed; progress saves every
  second; the summary always wins the screen.

Everything is local. No account, no server, no telemetry — the payload is read
from a hook and written to your disk, and the app works with the wifi off.

## How it works, in one paragraph

Claude Code fires hooks (`UserPromptSubmit`, `Stop`, `Notification`) and hands
over a JSON payload that already contains the agent's own closing message. A
320 KB zero-dependency shim forwards that payload to a local receiver bound to
127.0.0.1 — token-authenticated, Origin-rejecting — and exits within 500 ms no
matter what, so the agent never waits. The app renders the message, plays the
sound, and files the turn into history. If Muninn is not running, the payload
spools to disk and the panel is waiting at next launch. No polling, no log
parsing, no screen scraping. The quality of the panel depends on the agent
writing a good closing block — [MUNINN.md](MUNINN.md) is the file that teaches
it to.

## Contributing

Right now Muninn covers **macOS** and **Claude Code** — that's it. Everything
beyond that is deliberately left open, and the seams are designed to take
contributions:

| Seam | Where it lives |
|---|---|
| **Another CLI agent** (Codex, Cursor, Gemini, Aider…) | Everything source-specific is one file: `src-tauri/src/normalise.rs`. [docs/integrations/codex.md](docs/integrations/codex.md) is written and waiting on verification |
| **Another OS** | The core is Tauri + Rust; the macOS-only code is fenced and labelled. Linux first, Windows next — see [docs/roadmap.md](docs/roadmap.md) |
| **Another game** | Self-contained TypeScript modules in `ui/src/` with a tiny contract: draw, pause when told, snapshot once a second |
| **The thing itself** | Panel, sounds, history, installer, site — [docs/design-principles.md](docs/design-principles.md) is the referee for what counts as a fix |

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## What it is not

- **Not a usage tracker.** No tokens, costs, or quota — that space is well
  served already.
- **Not a session monitor.** No live list of what is running.
- **Not a chat client.** One direction only: agent → you.
- **Not a terminal scraper.** The agent hands over the summary directly; see
  [ARCHITECTURE.md](ARCHITECTURE.md).

## Building from source

```sh
pnpm install
pnpm tauri build --bundles app   # the .app lands in target/release/bundle/macos/
```

The workspace is three crates — `muninn-core` (shared types), `muninn-forward`
(the hook shim, std-only), and `src-tauri` (the app) — plus a vanilla-TS front
end in `ui/` and the landing site in `site/`.

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit and why |
| [MUNINN.md](MUNINN.md) | The summary contract users drop into their projects |
| [docs/product-brief.md](docs/product-brief.md) | Who it is for, what it must do |
| [docs/design-principles.md](docs/design-principles.md) | Calm-software rules the UI must obey |
| [docs/summary-contract.md](docs/summary-contract.md) | The structured block agents emit |
| [docs/integrations/claude-code.md](docs/integrations/claude-code.md) | Hook events, payload schema, setup |
| [docs/integrations/codex.md](docs/integrations/codex.md) | Codex CLI notifications (unverified) |
| [docs/roadmap.md](docs/roadmap.md) | Order of work |
| [docs/decisions/](docs/decisions/) | Architecture decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Working on this repo |
| [AGENTS.md](AGENTS.md) | Instructions for AI agents working on this repo |
