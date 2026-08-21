# The summary contract

Muninn's panel is only as good as the agent's closing message. This page defines
the block we ask agents to end their turns with, and how Muninn parses it.

## The block

Agents are asked to close each turn with a fenced block tagged `muninn`:

````markdown
```muninn
done: Added phone-number verification to the signup flow and got the test suite green.
changed:
  - apps/api/src/auth/verify.ts — new OTP issue/verify endpoints
  - apps/web/app/signup/page.tsx — phone step before email step
verified: 34 tests pass; manually sent an OTP to a real number and it arrived
next: Wire the rate limiter — currently unbounded, so the endpoint is abusable
blocked: Need a Twilio production key; the sandbox only sends to verified numbers
explain: |
  Signup used to take an email address and trust it. Anyone could type
  someone else's and get an account.

  Now the flow issues a six-digit code to the phone first and only creates
  the account once that code comes back. Two pieces do the work:

  - `verify.ts` issues codes and checks them, holding them in memory with a
    ten-minute expiry
  - the signup page asks for the phone number before the password, so a
    failed verification costs the user nothing

  The rate limiter is the obvious gap — nothing stops the same number being
  sent a hundred codes.
```
````

Every field is optional except `done`. Fields:

| Field | Meaning | Panel treatment |
|---|---|---|
| `done` | One sentence: what was achieved | Headline. Must stand alone. |
| `changed` | Files or areas touched, each with a short why | Collapsed list |
| `verified` | What was actually checked, and how | Green check row — **claims only, no inference** |
| `next` | What the agent would do next | Body |
| `blocked` | What it cannot proceed without | Amber row, sorts to the top |
| `risk` | Anything the user should look at sceptically | Amber row |
| `explain` | **How the thing now works**, at length | Details window only |

## Why there are two summaries

`done` and `explain` are the same turn written for two different moments.

`done` is for the glance: one sentence, read in three seconds from across the
room, answering only "did it work". Design principle §2 gives the panel's first
screen to that and nothing else.

`explain` is for the other case — the user who wants to follow the work rather
than just be told it finished, and who would otherwise have to read the whole
transcript to find out what changed and why. It is prose, it is markdown, and it
is several paragraphs. It never appears on the panel; the details window is
built around it.

Written as a `|` block, so its paragraphs, lists and code survive. Every other
field is a sentence and gets folded onto one line, which would turn a piece of
writing into a run-on paragraph.

### `explain` must carry the mechanism

The failure mode is not an empty `explain`. It is a full one that says nothing:
a paragraph restating `done` in more words, a tour of which files were touched,
a note that the approach was chosen because it was simpler. All true, all
narration, and none of it leaves the reader able to reason about the code.

**Say how it works.** After reading it, someone should be able to predict what
the code does with an input it has not seen, and know where to look when it
misbehaves. Concretely, an `explain` that is doing its job answers:

- **What the thing does now, step by step** — the path through the code, in
  order, in the terms the code uses. Name the functions and the files. "The
  worker walks text nodes and wraps matches" beats "highlighting was added".
- **The load-bearing decision, and what breaks without it** — not "I chose X
  because it is cleaner", but the constraint that ruled out the alternative.
  "String replacement would have put untrusted HTML through `innerHTML` and
  would miss a match straddling a tag" is a reason; "cleaner" is a preference.
- **Where the edges are** — what it does not handle, what happens on the
  failure path, what an unusual input does.

Length is not the measure. Three sentences of mechanism beat five paragraphs of
narration; the test is whether the reader could now change the code.

**Two shapes to avoid:**

| Narration — not this | Mechanism — this |
|---|---|
| "Refactored the search to be more robust." | "Matches are collected before any replacement: swapping nodes while the `TreeWalker` is mid-traversal makes it loop over its own output." |
| "Added caching to speed things up." | "The resolved colour is memoised per string, so the accent is read from a 1×1 canvas once per session rather than every frame." |
| "Fixed the animation glitch." | "`height` is a layout property, so every frame relaid the contents while the window was also resizing. Transform and opacity go to the compositor and touch neither." |

This is the whole reason the field exists. A user who wanted to know only that
the work finished already read `done` and closed the panel.

### And name the concept, so something transfers

Mechanism explains *this* code. It is not the same as teaching. Someone who
reads twenty summaries and comes away knowing twenty diffs has learned nothing
usable on a project the agent was not part of — and the details window exists
because the user said they wanted to learn what was going on rather than keep
prompting blind.

So where the work rests on a named technique — an algorithm, a data structure,
a platform API, a well-known failure mode — it is named, with one line on what
it is for. A handle to look up, not a tutorial:

> The cascade is a **flood fill**, breadth-first rather than recursive so each
> cell carries its distance from the click and the reveal can be staggered by
> it.

The test is whether it would still be true in a different codebase. "We collect
nodes before replacing them" is about this function; "mutating a collection
while iterating it invalidates the iterator" is about programming. The second
is the one worth writing down.

Skipped when there is nothing to name. A config change does not need a concept
attached, and inventing one teaches the reader to skim past the field.

## Why a fenced block rather than prose

Because the panel has to render the same shape every time. Free-form prose
varies wildly in length and structure; you cannot build a scannable UI on it.
A fence is trivially detectable, survives markdown rendering, and is ignorable
by anything that does not understand it.

It also fails gracefully: if the agent writes the block badly, we still have the
whole message to fall back on.

## Parsing rules

1. Find the **last** ```` ```muninn ```` fence in `last_assistant_message`.
2. Parse as YAML-ish key/value; a value may be a scalar or a `-` list.
3. **Never fail hard.** Any parse error → treat the whole message as `raw` and
   render it as markdown.
4. Strip the fence from `raw` before rendering, so the panel never shows both
   the parsed fields and their source.
5. Cap each field on display; the full text stays available on expand.

## Asking the agent to comply

Muninn ships this as [MUNINN.md](../MUNINN.md) — `muninn init` drops it into a
project and points `CLAUDE.md` at it in one delimited line. The fragment below
is the same contract in paste-able form, for anyone wiring it by hand:

```markdown
## Closing summary

End every turn with a fenced ```muninn block summarising the turn:

- `done:` one sentence on what was achieved
- `changed:` files or areas touched, each with a brief why
- `verified:` what you actually checked — tests run, commands executed. Only
  what you genuinely verified; never imply a check you did not perform.
- `next:` what you would do next
- `blocked:` anything you need from me to continue
- `explain:` a `|` block — the same work told properly, in a few short
  paragraphs, for someone who wants to understand what you did rather than
  only that you finished. Explain what the problem was, what you changed and
  why that approach, and anything you decided against. Plain language, no
  jargon you have not introduced. Markdown is fine.

Keep everything except `explain` short — they are read on a small panel, away
from the terminal, by someone who has not been watching. Lead with the outcome.

`explain` is the opposite: it is read deliberately, in a window with room, by
someone trying to learn what happened. Give it the space it needs.
```

## The honesty rule

`verified` is the field that makes Muninn trustworthy or useless. It must
contain only checks the agent actually performed. An agent writing "tests pass"
without running tests turns the panel into a machine for producing false
confidence — which is worse than no panel, because the user has stopped
watching precisely so they can rely on it.

If Muninn ever adds its own inference, it must be visually distinct from what
the agent claimed.
