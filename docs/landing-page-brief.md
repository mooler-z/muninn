# Muninn — landing page brief

Everything needed to design and build a marketing site for Muninn, without
access to the app's source. The product exists and works; this describes what it
actually is and what it actually looks like, so the page can be honest.

Read this end to end before designing. Section 5 (the visual system) is the part
that makes the page look like the product rather than like a generic SaaS page,
and section 9 says what to avoid — it matters more than usual here, because the
whole product is an argument against the visual habits landing pages default to.

---

## 1. What Muninn is

A small macOS menu-bar companion for coding agents. When Claude Code finishes a
turn, Muninn opens a calm panel in the corner of the screen telling you what the
agent achieved, what it changed, what it says it verified, and what it would do
next — with a sound that will not make you jump.

It exists so you can walk away.

> In Norse myth Odin keeps two ravens. Huginn and Muninn fly out over the world
> each day and return at dusk to perch on his shoulders and tell him what they
> saw. Muninn is the one that carries memory.
>
> Pronounced **MOO-nin**.

**Tagline in use:** *Wake me when it's done.*

### The one-paragraph explanation

Claude Code fires a `Stop` hook when it finishes a turn and hands over a JSON
payload containing the agent's own closing message. Muninn registers a hook that
forwards that payload to a local receiver, parses a structured summary block out
of it, and shows a panel. No polling, no log parsing, no screen scraping, no
account, nothing leaves the machine.

---

## 2. Positioning

The category already has tools. Muninn is not competing with them, and the page
should say so plainly rather than implying they don't exist — the honesty is
part of the brand.

| Those tools answer | Muninn answers |
|---|---|
| Is it still running? | **What did it do?** |
| How many tokens have I spent? | **Do I need to do something?** |
| Which sessions are open? | **What is it going to do next?** |

**Muninn is not:**

- a usage or cost tracker
- a live session monitor
- a chat client — you never reply from Muninn; it carries one direction, agent → you
- a terminal scraper

You can reasonably run Muninn *alongside* a usage tracker. Adjacent, not
overlapping. That's a good, disarming thing to say on the page.

### The insight worth leading with

Agents got good enough to work unattended for ten or twenty minutes. The tooling
didn't keep up. Today you either sit watching a terminal scroll — which defeats
the point of an agent — or you wire up a notification that pings you and tells
you nothing, so you go back to the terminal anyway.

Muninn is the thing that tells you what happened.

---

## 3. Who it is for

Someone running a coding agent on a real task that takes five to thirty minutes.
They want to leave — read, watch something, cook — and come back informed
without replaying a terminal.

They are not looking for a dashboard. They look at Muninn a handful of times a
day, for thirty seconds each time. **The page should feel like it was made by
someone who respects that**, which mostly means: short, quiet, no growth-hacking.

### The job, in three questions

1. **Did it work?**
2. **Do I need to do something?**
3. **What is it going to do next?**

The panel answers all three without the user expanding anything. That's the
product claim, and it's a good structure for the hero section too.

---

## 4. Feature inventory

Everything below is built and working. Nothing here is aspirational.

### The panel

- Appears in the **top-right corner** when a turn ends. Never centre-screen,
  never covering what you're doing.
- **Never steals focus.** It appears while you are typing somewhere else and
  your keystrokes keep going where you sent them.
- 372px wide, sized to its content, one window ever.
- A quiet sound on arrival — soft attack, short, low-mid. A *different, quieter*
  sound when the agent is blocked and needs an answer, because being asked a
  question is less final than being finished.
- Header carries the **project name, git branch, agent, and time** — the things
  Muninn knows first-hand.
- If two agents finish at once they **queue** rather than stacking two windows,
  with `‹ 2 of 3 ›` paging. A pile of windows is the exact anxiety the tool
  exists to remove.
- Dismisses on its own countdown, or by the close button, or `Esc` once engaged.

### The summary contract

This is the actual moat and deserves real estate on the page. Muninn doesn't
guess what the agent did — it asks the agent to say, in a structured block the
agent writes itself at the end of its turn:

```markdown
```muninn
done: One sentence on what was achieved.
changed:
  - src/auth/session.ts — token refresh now retries once
verified: cargo test — 34 passed
next: wire the refresh into the middleware
blocked: need the staging API key to test end to end
explain: |
  A few paragraphs, for someone who wants to understand the work
  rather than only hear that it finished.
```
```

Only `done` is required. Anything that doesn't apply is left out — an empty
field is worse than no field.

If the agent writes no block at all, Muninn renders its closing message as
markdown instead. It never fabricates a summary; a missing one says *"finished,
no summary."*

### Two summaries, two moments

A distinctive feature worth its own section:

- **`done`** is for the glance — one sentence, readable in three seconds from
  across the room.
- **`explain`** is for the reader who wants to *learn from* the work: several
  paragraphs of prose on what the problem was, what changed, why that approach
  and not another, what was decided against.

The short one is on the panel. The long one lives in the **Details window**, so
the panel never becomes a wall of text. The point is that you can come back from
making coffee and actually understand the change, not just be told it landed.

### The honesty rule

`verified` is rendered as the agent's **claim** — quoted, and permanently
labelled `VERIFIED — REPORTED`. Muninn checked nothing itself, and somebody
stopped watching precisely so they could rely on it. This is enforced
typographically, not by convention (see §5.4).

That's a genuinely unusual product stance and should be on the page.

### Details window

Opens centred at half the screen, from a button on the panel. Carries the user's
original prompt, the full `explain` prose rendered as markdown, the file list,
and the claims. Markdown is rendered with raw HTML, images and unsafe URL
schemes stripped — the agent's output is untrusted text.

### History

Two levels: a list of **projects**, then that project's turns, newest first,
grouped by day. Reachable from the panel and from the menu-bar menu. Local to
the Mac; there is no account and nothing syncs.

### The waiting games — the surprising feature

The one that makes people smile, and worth building a section around.

Muninn's premise is that you walk away. But at *five* minutes leaving costs more
than it saves — too long to watch a log, too short to pick up anything that
needs loading into your head. That gap is otherwise unserved.

So when you submit a prompt, Muninn can open a small window with something to do
that asks nothing of you. When the turn finishes, the game **pauses and banks
your score**, and the summary takes over. The raven came back; nothing has to be
dismissed first.

Three of them:

1. **Muninn's flight** — the raven, drifting.
2. **Runner** — a side-scrolling endless runner, in Muninn's palette.
3. **Minesweeper 3D** — a 5×5×5 volume rather than a board. Every cell has up to
   **26 neighbours**, so a number means something quite different from the flat
   game. Drag to orbit, scroll to zoom. Cells are frosted glass with a grainy
   roughness map; the cell under your pointer takes the accent. Revealed empty
   cells vanish with a half-turn, staggered outward from the click so an opening
   *unfolds*. Hitting a mine flares the cell, sends a shell of light through the
   volume, rolls the whole cube, and surfaces the remaining mines in the wake —
   and only then does the card come up. There's a **disperse slider** that pulls
   the lattice apart so you can reach the twenty-seven cells a packed cube hides
   completely.

**Off by default.** It's a matter of taste, not correctness, and the product's
own rules say Muninn must not demand attention it wasn't asked for. Frame it as
*for people who would rather stay put than context-switch* — not as a feature
everyone gets.

Minesweeper 3D is the screenshot that will get shared. Give it room.

### Menu bar

Last summary, history, appearance (light / dark / system), mute, silent hours,
which waiting game, quit. No Dock icon.

### Privacy & footprint

- **Nothing leaves the machine.** No account, no cloud, no telemetry. The
  payload contains your working directory and your agent's full output; it stays
  on your Mac.
- The receiver binds to `127.0.0.1` only, requires a token written to a
  0600-mode file, and rejects any request carrying an `Origin` header — so a web
  page you visit can't post a fake panel to it.
- The hook shim is **zero-dependency** and hard-capped: whatever happens, it
  exits within 500ms so your agent never pauses for it. If Muninn isn't running,
  the payload spools to disk and the panel appears when you next launch.
- Built on Tauri, not Electron — it idles all day in a menu bar, so idle CPU
  should be indistinguishable from zero.

---

## 5. The visual system

This is the important part. Muninn is warm, dusk-coloured and quiet. It looks
like nothing else in developer tooling, which is almost entirely blue-black
terminals and neon gradients. **The site must look like the app.**

### 5.1 Palette

One warm hue family. Everything else is derived.

**Light — the panel at dusk in a bright room**

| Token | Value |
|---|---|
| background | `linear-gradient(168deg, #fdefe4 0%, #f6d8ce 100%)` |
| flat surface | `#fdefe4` |
| foreground | `#4a332b` |
| foreground 2 | `#8a6a5d` |
| foreground 3 | `#b08e80` |
| hairline | `rgba(130, 80, 58, 0.2)` |
| code background | `rgba(130, 80, 58, 0.1)` |
| **accent** | `oklch(0.60 0.15 38)` — a burnt terracotta |

**Dark — the default, and the one to lead with**

| Token | Value |
|---|---|
| background | `linear-gradient(168deg, #332320 0%, #2c1b20 100%)` |
| flat surface | `#2c1b20` |
| foreground | `#f5e7dd` |
| foreground 2 | `#cbab9d` |
| foreground 3 | `#9a7d71` |
| hairline | `rgba(245, 231, 221, 0.14)` |
| code background | `rgba(245, 231, 221, 0.1)` |
| **accent** | `oklch(0.80 0.11 45)` — the same hue, lifted |

The dark theme is **warm brown-plum, not black or navy**. That is the single
most identity-carrying decision in the product. Do not neutralise it toward grey
because it "reads cleaner" — it won't be Muninn any more.

**Both themes ship. The site should support both**, following
`prefers-color-scheme`, with an explicit toggle. The app has one; the page
having one is a small, appropriate wink.

### 5.2 The accent rule

**One accent, used for one thing at a time.**

Finishing successfully earns **no colour at all** — a check mark and a word in
ink. The accent appears only when the user is actually needed: `blocked` and
`needs-input`. Never a rainbow of statuses.

Status colour is **never used alone** — always paired with an icon *and* a word,
for colour-blind readers and for glanceability.

On the landing page this means: resist accenting every heading. Let the accent
mean something. One or two per screenful, maximum, on the things you actually
want clicked.

### 5.3 Shape, space, type

```css
--mn-r: 22px;        /* panel corner */
--mn-r-s: 10px;      /* inner elements */
--mn-panel-w: 372px;

--mn-sp-1: 4px;  --mn-sp-2: 8px;  --mn-sp-3: 12px;
--mn-sp-4: 16px; --mn-sp-5: 20px;

--mn-font-ui:    -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
--mn-font-serif: ui-serif, "New York", "Iowan Old Style", Palatino, Georgia, serif;
--mn-font-mono:  ui-monospace, "SF Mono", Menlo, Consolas, monospace;

--mn-fs-meta: 10.5px;  --mn-fs-label: 10px;  --mn-fs-note: 12px;
--mn-fs-body: 13.5px;  --mn-fs-lead: 19px;   --mn-fs-mono: 11px;
--mn-lh-body: 1.55;    --mn-lh-lead: 1.45;
```

System fonts throughout — it is a Mac app and should look native. The landing
page can go larger than these sizes (they're panel-scale), but keep the *ratios*
and keep the system stack. **Do not introduce a webfont.** If the page needs a
display face for the hero, use the serif stack — `ui-serif` / New York — which
already exists in the system and suits the mythological register.

Monospace is **only** for paths, commands and code fragments. Never for headings
or for atmosphere.

### 5.4 The two type registers — the core idea

This is the most distinctive thing about Muninn's interface and the page should
demonstrate it, not just describe it.

Everything on screen is in one of two registers, and they must never look alike:

```css
/* The agent talking. Light sentence type. Quoted wherever it names a
   check it claims to have run. */
.mn-voice {
  font-family: var(--mn-font-ui);
  text-wrap: pretty;
}

/* Something Muninn knows first-hand — project, branch, source, time,
   the status word. Tracked capitals. */
.mn-fact {
  font-family: var(--mn-font-ui);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
}

/* A claim is quoted by the stylesheet, not by the template, so a field
   can never be rendered as a claim and lose its quotation marks. */
.mn-claim::before { content: "\201C"; }
.mn-claim::after  { content: "\201D"; }
```

*"Tests pass"* reported by the agent and *tests pass* observed by Muninn are not
the same statement. One is a quotation; the other is a fact. Making that a pair
of classes rather than a per-element decision is what stops it eroding.

There is a third slot — unquoted tracked capitals, for something Muninn verified
itself — which is **deliberately reserved and unused**, because Muninn checks
nothing today.

**Use both registers on the page.** Section eyebrows and metadata in `.mn-fact`
tracked capitals; body copy in sentence type. It will immediately look like the
product.

### 5.5 The dichromatic shadow — the signature

Not a grey drop shadow. The panel sits in **coloured light**: a cool cast thrown
to the left, a warm one to the right, over a neutral mauve drop. The panel reads
as *lit*, not as a card cut out and pasted down.

```css
/* light theme, resting */
--mn-shadow:
  0 0 0 0.5px rgba(150, 88, 60, 0.2),
  inset 0 1px 0 rgba(255, 255, 255, 0.65),
  0 14px 36px rgba(141, 122, 140, 0.3),
  0 2px 10px rgba(141, 122, 140, 0.12),
  -11px 5px 26px rgba(90, 119, 148, 0.22),   /* cool, left  */
   11px 7px 29px rgba(217, 137, 160, 0.28);  /* warm, right */

/* dark theme, resting — pushed harder, there is more room against a dark field */
--mn-shadow:
  0 0 0 0.5px rgba(255, 200, 170, 0.22),
  inset 0 1px 0 rgba(255, 225, 205, 0.14),
  0 14px 36px rgba(109, 84, 98, 0.5),
  0 2px 10px rgba(109, 84, 98, 0.2),
  -11px 5px 28px rgba(90, 119, 148, 0.35),
   11px 7px 30px rgba(192, 64, 119, 0.35);
```

There is a stronger variant (`--mn-glow`) for hover/emphasis — same structure,
larger blurs, higher alphas, cool cast to `rgba(116,150,185,0.5)` and warm to
`rgba(203,80,130,0.55)` — and a `--mn-glow-soft` between the two for surfaces
large enough that the full glow becomes a haze rather than a lift.

**Rules learned the hard way:**

- Keep the cast colours *dusty*. An earlier attempt pushed the warm side to full
  chroma and got a hot magenta that had nothing to do with the rest of the
  panel. Chroma stays around 0.10; it must read as coloured light, not as pink.
- The larger the surface, the softer the glow. A full-bleed hero card with the
  strong glow becomes a haze around the whole viewport.
- Any element carrying this shadow needs real clearance around it — the shadow
  reaches ~66px at its widest. Clipped, it produces a hard rectangle, which is
  the one artefact that destroys the effect entirely.

### 5.6 Liquid glass — the button material

Every control in Muninn is this material. It's the thing to get right.

```css
.mn-glass {
  position: relative;
  isolation: isolate;
  border: 0;
  background: linear-gradient(
    180deg,
    var(--mn-glass-tint) 0%,
    color-mix(in oklab, var(--mn-glass-tint) 46%, transparent) 52%,
    color-mix(in oklab, var(--mn-glass-tint) 78%, transparent) 100%
  );
  box-shadow:
    inset 0  1px 0.5px var(--mn-glass-spec),          /* lit top edge   */
    inset 0 -7px 12px -9px var(--mn-glass-shade),     /* shaded bottom  */
    0 1px 1.5px  color-mix(in oklab, var(--mn-fg) 10%, transparent),
    0 6px 14px -7px color-mix(in oklab, var(--mn-fg) 16%, transparent);
  transition:
    background 160ms ease-out, box-shadow 160ms ease-out,
    color 140ms ease-out, transform 70ms ease-out;
}

/* The rim: a gradient ring, not a border colour — masked so only the
   one-pixel edge of the gradient survives. Brightest where it faces the
   light, fading round the far side. */
.mn-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    155deg,
    var(--mn-glass-spec) 0%,
    var(--mn-glass-rim) 34%,
    color-mix(in oklab, var(--mn-glass-rim) 25%, transparent) 62%,
    var(--mn-glass-rim) 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
  pointer-events: none;
}

.mn-glass:hover {
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--mn-glass-tint) 125%, white) 0%,
    color-mix(in oklab, var(--mn-glass-tint) 68%, transparent) 52%,
    color-mix(in oklab, var(--mn-glass-tint) 95%, transparent) 100%
  );
  box-shadow:
    inset 0  1px 0.5px var(--mn-glass-spec),
    inset 0 -7px 12px -9px var(--mn-glass-shade),
    0 2px 3px   color-mix(in oklab, var(--mn-fg) 12%, transparent),
    0 10px 20px -8px color-mix(in oklab, var(--mn-fg) 20%, transparent);
}

/* Pressed: the light moves to the *inside*. It stops being a raised thing. */
.mn-glass:active {
  transform: translateY(1px) scale(0.985);
  box-shadow:
    inset 0 2px 5px -1px var(--mn-glass-shade),
    inset 0 1px 0 color-mix(in oklab, var(--mn-glass-spec) 30%, transparent),
    0 1px 1px color-mix(in oklab, var(--mn-fg) 10%, transparent);
}
```

Glass tokens:

```css
/* light: the material holds a lot of light, so the fill carries it */
--light-glass-tint:  rgba(255, 255, 255, 0.5);
--light-glass-rim:   rgba(255, 255, 255, 0.55);
--light-glass-spec:  rgba(255, 255, 255, 0.95);
--light-glass-shade: rgba(126, 74, 52, 0.16);

/* dark: darker glass holds less, so the specular carries the edge instead */
--dark-glass-tint:  rgba(255, 238, 228, 0.1);
--dark-glass-rim:   rgba(255, 236, 224, 0.22);
--dark-glass-spec:  rgba(255, 244, 236, 0.5);
--dark-glass-shade: rgba(0, 0, 0, 0.38);
```

**Note there is no `backdrop-filter`, deliberately.** In the app it shimmered —
the panel breathes on a loop, so it repaints continuously, and every repaint
made the blur re-sample its backdrop. Little was lost: what actually reads as
glass is the gradient rim, the specular top edge and the depth below, and those
cost nothing per frame. On a landing page you *may* use `backdrop-filter` over
genuinely busy content (a screenshot, a gradient mesh), but over a smooth
background it adds nothing and should be left out.

**Shapes in use:**

- `.mn-round` — 36px circle, one icon. The footer controls.
- `.mn-step` — 26px circle, for `‹ ›` queue paging. Goes flat and rimless when
  disabled: no rim, no specular, nothing to press.
- `.mn-details` — a pill: `padding: 8px 14px 8px 11px`, `border-radius: 11px`,
  `font: 600 10px/1` with `letter-spacing: 0.16em`, uppercase, an icon at 8px
  gap. This is the primary button shape and the model for the site's CTA.

### 5.7 Icons

**Phosphor Icons**, regular or bold weight, matched to the text they sit beside.
Never an icon without a word next to it when it's carrying status.

### 5.8 The mark

A raven silhouette (`assets/muninn-raven.png` in the repo). In the app it is
used as a **CSS mask painted with `currentColor`**, so it takes the theme's ink
rather than being a fixed black bitmap that would vanish on dark:

```css
.mn-logo {
  display: block;
  height: 34px;
  aspect-ratio: 139 / 186;   /* the artwork's own — the box matches the drawing */
  -webkit-mask-image: url("muninn-raven.png");
          mask-image: url("muninn-raven.png");
  -webkit-mask-size: contain;
          mask-size: contain;
  -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
  background: currentColor;
}
```

Do the same on the page. It also means the mark can be tinted to the accent for
a single emphatic use in the hero.

### 5.9 Motion

Restrained, and always *because* something happened — never decoration.

- Transitions 70–160ms, `ease-out`. Presses are fastest.
- The panel arrives with a soft entrance and has a slow "breathing" glow at rest.
- Reveal and cascade animations in Minesweeper are ~450ms per element, staggered
  outward from the click, precisely so you can watch them.
- **No spinners. No progress bars. No animated number counters.** Nothing is
  happening — that is the point. The work is already done.
- Honour `prefers-reduced-motion` and cut all of it.

---

## 6. Suggested page structure

Short. Muninn's whole argument is that attention is expensive; a page that takes
ten minutes to scroll contradicts the product.

1. **Hero** — the mark, `Wake me when it's done.`, one sentence, download
   button, and **an actual panel** rendered live in HTML beside or below the
   copy (not a screenshot — build it from the real CSS in §5, it's a few divs
   and it will look better than any screenshot). Dark theme.

2. **The problem** — three lines. *You either watch the terminal scroll, which
   defeats the point, or you get a ping that tells you nothing, so you open the
   terminal anyway.*

3. **The three questions** — Did it work / Do I need to do something / What's
   next, each answered by a labelled region of the panel. A good place for an
   annotated diagram over the live panel from the hero.

4. **The summary contract** — the ```` ```muninn ```` block in a code panel, and
   the panel it produces beside it. *Muninn doesn't guess what your agent did.
   It asks.* This is the section that makes engineers trust it.

5. **Two summaries** — glance vs. learn. Panel on the left, Details window on
   the right.

6. **The honesty rule** — the `VERIFIED — REPORTED` label, big. Short copy:
   *Muninn quotes your agent. It never vouches for it.* This is a differentiator
   and it costs one screenful.

7. **While you wait** — the games. Lead with Minesweeper 3D; if the page can
   afford it, **embed a playable one**. It's Three.js, it's already written, and
   a landing page you can play is a landing page people send to each other. If
   embedding is too much, a looping video of the disperse slider and the
   detonation. Copy should keep the honest framing: *off by default, for people
   who'd rather stay put than context-switch.*

8. **Privacy & footprint** — four short claims: nothing leaves your Mac; no
   account; localhost-only, token-authenticated; your agent never waits more
   than 500ms for it.

9. **Install** — the hook snippet and the download. Two steps, visible without
   expanding anything.

10. **Footer** — the myth quote, the pronunciation, a link to the repo.

### Copy notes

- Voice: calm, plain, slightly literary. Short sentences. British-leaning
  spelling in the product docs.
- No exclamation marks. No "supercharge", "10x", "effortlessly", "game-changing".
- Say what it does not do — the "not a usage tracker / not a session monitor"
  framing is disarming and true, and engineers respond to it.
- The myth is an asset. Use it once, well, in the footer or the hero — not
  woven through every heading.

---

## 7. Assets available

- `assets/muninn-raven.png` — the mark, black silhouette, intended for masking
- `src-tauri/icons/` — app icons at 32/128/256, `icon.png` (1024), `tray.png`
- Live screens to capture: panel (completed / blocked / queued / raw-fallback),
  Details window, History, all three games, the menu-bar menu — each in light
  and dark

If a screenshot is used, it must include the shadow's full ~66px reach around
it, or the dichromatic glow will be cut square and the image will read as a
flat rectangle.

---

## 8. Facts to keep accurate

- macOS only today. Menu bar, no Dock icon. Built with Tauri.
- Claude Code is the supported integration. Codex is documented but unverified —
  don't claim it.
- The panel is 372px wide, 22px corner radius.
- Minesweeper 3D is 5×5×5 = 125 cells, 20 mines, up to 26 neighbours per cell.
- The first cell you open is always safe — mines are laid after the first click.
- The forwarding shim has zero dependencies and a hard 500ms exit.
- If Muninn isn't running the payload spools to disk and is never lost.

---

## 9. What not to do

The product is an argument against most landing-page defaults. Specifically:

- **No dark navy / terminal green / neon-on-black.** Warm dusk browns. This is
  the whole visual identity.
- **No animated statistics** — no counting-up numbers, no "12,483 turns
  summarised". The product explicitly bans animated counters.
- **No dashboard mockups, no charts, no graphs.** Muninn has none and showing
  them promises a different product.
- **No gamification framing** for the games — no streaks, no leaderboards, no
  "level up". They are something to do with your hands, not an achievement
  system.
- **No fake testimonials, no fabricated logo wall, no invented metrics.** The
  product's central claim is that it doesn't fabricate; a page that does
  undermines it in the most literal way possible.
- **No cookie-banner-and-tracker stack.** "No telemetry" is on the page; make it
  true of the page too.
- **No blue.** The only cool colour in the system is the left-hand shadow cast,
  and it's a shadow, not a colour you use.
- **Don't over-accent.** If the terracotta is on every heading it stops meaning
  "you are needed here", which is the only thing it means in the app.
