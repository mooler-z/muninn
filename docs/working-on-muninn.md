# Working on Muninn — the operational notes

**Read this before changing anything in this repository.** It is how to build
it, how to see your change, and the constraints that are not obvious from the
code. Most of it was learned by getting it wrong first.

This is for people (and agents) working *on* Muninn. It is not
[MUNINN.md](../MUNINN.md), which is the file users drop into their own
projects.

[AGENTS.md](AGENTS.md) covers *why* the product is the way it is.
[ARCHITECTURE.md](ARCHITECTURE.md) covers how the pieces fit. This covers what
will waste your afternoon.

---

## 1. Building and running — read this first

**`cargo build --release` does not produce a working app.** It produces a
*development* binary whose webviews point at the Vite dev server on
`localhost:5183`. With no dev server running, every window loads nothing — and
because they are transparent and borderless, the result is an invisible,
always-on-top rectangle that swallows every click on the screen. That is not a
theory; it happened, and it locked the machine's UI until the process was
killed.

```sh
npx tauri build --bundles app          # the only build worth testing
"target/release/bundle/macos/Muninn.app/Contents/MacOS/muninn"
```

The mechanism is Tauri's `custom-protocol` feature: `cargo tauri build` passes
it, a bare `cargo build` does not, and without it `generate_context!` bakes in
`devUrl` instead of the embedded assets. `cargo build --release --features
custom-protocol` also works for a compile check, but prefer the bundle for
anything you intend to look at.

**Use `pnpm`, never `npm install`.** The lockfile here is `pnpm-lock.yaml`, and
there is an unrelated `package-lock.json` in the *parent* directory that npm
walks up to and resolves against — producing peer-dependency errors from a
project that has nothing to do with this one. `pnpm add <pkg>` works.

**Never build while a dev server is running.** `next build` or `tauri build`
will overwrite `.next` / `dist` underneath a live `next dev` or `vite`, and the
running server then serves a half-written tree and 500s. Stop the server first.

---

## 2. Seeing your change

The app has no CLI. You drive it by posting to its own receiver:

```sh
PORT=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/dev.muninn/runtime.json')))['port'])")
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/dev.muninn/runtime.json')))['token'])")

# A finished turn — shows the panel.
curl -X POST "http://127.0.0.1:$PORT/event?source=claude-code&kind=completed" \
  -H "X-Muninn-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"cwd":"/Users/me/proj","session_id":"x","last_assistant_message":"```muninn\ndone: something\n```"}'
```

`kind` is one of `completed`, `needs-input`, `failed`, `started` (arms the
waiting game). Two debug-only kinds exist so windows can be driven without
clicking — `notice` (corner notification) and `debug` (`open-history`,
`close-history`, `open-details`, `close-details`). **They are debug
affordances on a network-facing endpoint; strip them before release.**

**You cannot screenshot the app's windows headlessly.** They are Tauri windows.
Web pages *can* be checked — `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
--headless=new --screenshot=/tmp/x.png <url>` works and is the fastest way to
settle an argument about the landing page or admin portal.

For anything visual in the app, prefer building a **playground page** over
rebuilding and asking a human to judge 400ms in the corner of their screen.
`ui/animations.html` is the working example: it renders the real panel through
the real stylesheet with replay buttons and a speed slider. Iterating blind on
a visual thing is the single biggest time sink in this repo's history.

### Reading the log

The app writes to stderr; run it redirected to `/tmp/muninn.log`. Two traps:

- **Do not truncate the log with `: >` while the app holds the descriptor.**
  Writes continue at the old offset, the file becomes sparse, and `grep` then
  treats it as binary and prints nothing. Use `grep -a`, or restart the app.
- Frontend errors reach that log via the `report_error` command — every window
  installs `error` and `unhandledrejection` handlers that call it. A window
  with no console is otherwise silent.

---

## 3. Constraints that are not negotiable

**The transcript is never on the critical path** (ADR-0002). It is Claude
Code's file, it can be tens of megabytes, and reading it must never sit between
a turn ending and the panel appearing. `capture_prompt` reads it on a
background thread *after* the panel is up. Keep it that way.

**Windows are hidden, not destroyed.** Their frontend modules run exactly once,
at app start. Anything that must happen when a window is *shown* needs an event
from Rust — `muninn://details-opened`, `muninn://history-opened`,
`muninn://waiting`. Code placed at module top level will run once, hours before
the user sees the window.

**The waiting window is on probation.** It must call `waiting_ready` within four
seconds of opening or the app hides it again. That watchdog exists because a
transparent window that renders nothing is an invisible click-trap (see §1).
If you add a code path that renders the waiting window, it must reach that call.

**macOS will not place a window above the menu bar.** The panel's window top
sits at the menu bar's bottom edge, so `--mn-shadow-pad-top` (24px) is the
*entire* clearance the card has above itself. The arrival animation drops from
22px for that reason and cannot drop further without being clipped.

**Muninn is an `Accessory` app.** To hand focus back when closing a window, use
`NSApp.deactivate()` — not `hide()`. `hide()` returns `Ok` and changes nothing
for an accessory app, and it has a trap: a hidden application's windows never
appear again however many times `show()` is called.

**Tauri capabilities are silent when wrong.** A window missing from
`capabilities/panel.json` gets no `listen` and no error — events simply never
arrive. Add new windows to that list.

**CSP is strict.** `script-src 'self' 'wasm-unsafe-eval'` and
`worker-src 'self' blob:` — the WASM allowance exists for the chess engine.
Plain `script-src 'self'` blocks WebAssembly compilation outright.

---

## 4. Design rules the code enforces

Read [docs/design-principles.md](docs/design-principles.md) in full. The ones
that bite in code:

**Two type registers, and they must not blur.** `.mn-fact` is tracked capitals
for what Muninn knows first-hand; `.mn-voice` is sentence type for the agent's
words. A claim is quoted **by the stylesheet** (`.mn-claim::before`), never by
the template, so a claim can never be rendered and lose its quotation marks.
This survives into the history export too.

**One accent, meaning "you are needed."** Finishing successfully earns no
colour. Status colour never appears without an icon *and* a word.

**Animate transform and opacity. Never `height`.** Height is a layout property:
every frame relays the contents, and in this app it runs concurrently with the
window resizing, the summary streaming in, and the countdown redrawing. Four
things competing for the same frames cannot be made smooth. This was rebuilt
four times before landing on the compositor.

**Colours are authored in `oklch`.** Do not hand-parse hex — `#`-slicing the
accent yields `rgba(NaN, …)` and canvas APIs reject it. Resolve by painting one
pixel to a 1×1 canvas and reading it back; the browser knows every colour space
it accepts.

**Highlighting and any text-wrapping is done with DOM nodes**, never by
interpolating markup. The text is a project name, a user's prompt, or an
agent's output — none of it is ours to hand to `innerHTML`. Use a `TreeWalker`,
and collect the matching nodes *before* replacing any, or the walker walks into
its own output and loops.

---

## 5. The summary contract

[docs/summary-contract.md](docs/summary-contract.md) is the product's moat: the
value comes from shaping the agent's output at the source. The rule that
matters most:

**`explain` must carry the mechanism, not a narration.** The failure mode is
not an empty field — it is a full one restating `done` in more words. After
reading it, someone should be able to predict what the code does with an input
they have not seen and know where to look when it misbehaves. Name functions
and files, give the constraint that ruled out the alternative rather than a
preference, and say where the edges are. Length is not the measure.

`test/CLAUDE.md` is the shipped prompt fragment. Keep it and the spec in step.

---

## 6. Where things are

```
crates/muninn-core/     event shape, summary parser, paths   (pure, well tested)
crates/muninn-forward/  the hook shim — std only, zero deps, hard 500ms exit
src-tauri/src/          receiver, queue, panel, details, history, waiting,
                        notice, net, games, sound, tray
ui/src/                 panel, details, history, waiting + the games
ui/src/models/          dungeon GLBs for the maze
ui/public/engine/       Stockfish WASM (GPL-3 — see below)
site/                   landing page + admin portal (Next.js, deployed)
docs/decisions/         ADRs — several obvious approaches already rejected
```

`cargo test -p muninn --lib` and `npx tsc --noEmit` are both fast. Run them.

---

## 7. Open flags

- **Stockfish is GPL-3.** It is bundled for the chess game. Shipping a
  distributed binary that includes it very likely means Muninn must be GPL-3
  too. Decide deliberately before release; `js-chess-engine` is MIT if not.
- **The debug receiver kinds** (`notice`, `debug`) must be removed before
  release.
- **`docs/design-principles.md` §1 and §6 no longer match the build** — the
  sound repeats three times (at the owner's request, documented in `sound.rs`),
  and there are games. Update the docs or write ADRs.
- **Nothing in this repository is committed.** There is no git remote, and the
  deployed site is rsynced rather than cloned.
