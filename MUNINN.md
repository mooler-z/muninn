## Closing summary

End every turn with a fenced ` ```muninn ` block. It is read by a small panel
that appears when you finish, by someone who walked away and has not been
watching.

````markdown
```muninn
done: One sentence on what was achieved.
changed:
  - path/to/file.ts — a brief why
verified: what you actually checked — tests run, commands executed
next: what you would do next
blocked: anything you need from me to continue
risk: anything worth looking at sceptically
explain: |
  How the thing now works. Name the functions and files, walk the path through
  the code in order, and give the constraint that ruled out the alternative.

  Then name the concept it rests on — the algorithm, the API, the failure mode
  — in a line, so the reader learns something that outlives this change.
```
````

Only `done` is required. Leave out anything that does not apply — an empty
field is worse than no field.

If you write no block at all, your closing message is shown as-is. Nothing
breaks. The block just makes it readable at a glance.

---

## The two summaries

`done` and `explain` are the same turn written for two different moments.

- **`done`** is for the glance: one sentence, read in three seconds from across
  the room, answering only "did it work". Lead with the outcome. It is the only
  thing guaranteed to be read.
- **`explain`** is for the reader who wants to follow the work. It has a window
  of its own with room for it.

Write `explain` as a `|` block. Every other field is folded onto one line,
which is right for a sentence and would turn a piece of writing into one
run-on paragraph.

---

## `explain` carries the mechanism, not a narration

The failure mode is not an empty `explain`. It is a full one that says nothing:
`done` restated in more words, a tour of which files were touched, "I chose
this because it was cleaner". All true, and none of it leaves the reader able
to reason about the code.

**After reading it, someone should be able to predict what the code does with
an input they have not seen, and know where to look when it misbehaves.** So:

- **Walk the path.** What happens, in order, in the terms the code uses. Name
  the functions and the files.
- **Give the load-bearing reason.** Not "cleaner" — the constraint that ruled
  the alternative out. *"String replacement would put untrusted HTML through
  `innerHTML` and miss a match straddling a tag"* is a reason.
- **Say where the edges are.** What it does not handle, what the failure path
  does, what an unusual input does.

Length is not the measure. Three sentences of mechanism beat five paragraphs of
narration; the test is whether the reader could now change the code themselves.

| Narration — not this | Mechanism — this |
|---|---|
| "Refactored the search to be more robust." | "Matches are collected before any replacement — swapping nodes while the `TreeWalker` is mid-traversal makes it loop over its own output." |
| "Added caching to speed things up." | "The resolved colour is memoised per string, so it is read from a 1×1 canvas once per session rather than every frame." |
| "Fixed the animation glitch." | "`height` is a layout property, so every frame relaid the contents while the window was also resizing. Transform and opacity go to the compositor and touch neither." |

---

## Name the concept, so something transfers

Mechanism tells the reader about *this* code. That is worth having, and it is
not the same as teaching them anything. Someone who reads twenty summaries and
comes away knowing twenty diffs has learned nothing they can use on a project
you were not part of.

So when the work rests on a named technique — an algorithm, a data structure, a
platform API, a well-known failure mode — **name it, and say in one line what
it is for.** Not a tutorial. A handle the reader can go and look up.

> The cascade is a **flood fill**, breadth-first rather than recursive so each
> cell carries its distance from the click and the reveal can be staggered by
> it.

> `TreeWalker` is the DOM's iterator over text nodes. It exists precisely so
> you can transform text without touching the markup around it, which is why it
> is the right tool whenever the HTML is not yours to trust.

> This is the classic **layout vs. compositor** split: `height` and `top` make
> the browser re-run layout every frame, while `transform` and `opacity` are
> handed to the GPU. Anything animating at 60fps wants to be on the second
> list.

Three tests for whether it belongs:

- **Would it still be true in a different codebase?** "We collect nodes before
  replacing them" is about this function. "Mutating a collection while
  iterating it invalidates the iterator" is about programming.
- **Does it have a name the reader can search?** Flood fill, memoisation,
  debounce, back-pressure, TOCTOU, the compositor. A name is a thread they can
  pull on later.
- **Did *you* have to know something to do this?** If you drew on knowledge the
  reader might not have, that is exactly the thing to hand over.

Skip it when there is nothing to name. A config change or a copy edit does not
need a concept attached, and inventing one to fill the space is worse than
leaving it out — the reader learns to skim past it.

---

## The honesty rule

`verified` must contain **only checks you actually performed.** It is rendered
as your claim — quoted, and permanently labelled *reported* — because Muninn
checked nothing itself, and someone stopped watching precisely so they could
rely on it.

Writing "tests pass" without running tests turns the panel into a machine for
producing false confidence, which is worse than no panel at all.

If you did not verify anything, leave the field out. That is a complete and
honest answer.

The same applies to `done`: if the work did not land, say so there. A summary
that reads as success when the turn failed is the one thing this file exists to
prevent.

---

## Writing the fields

**`done`** — the outcome, not the activity. "Token refresh now retries once
before failing the session", not "worked on the auth module".

**`changed`** — one line per file or area, each with a *why*, not a restatement
of the path. `src/auth/session.ts — retries once before giving up` earns its
line; `src/auth/session.ts — updated session file` does not.

**`next`** — what you would genuinely do next, so the reader can decide whether
to let you continue or step in. Not a wish list.

**`blocked`** — only what you cannot proceed without, and be specific about
what would unblock you. This sorts above everything else on the panel and is
the one field that asks the reader to act, so a false one costs their
attention.

**`risk`** — what you would want a second pair of eyes on. Things you changed
that you are not certain about, assumptions you made, anything that will bite
later.

---

## Notes

Muninn reads the **last** ` ```muninn ` block in your message, so an example
block earlier in your reply is harmless.

Everything you write here stays on the user's machine. Muninn has no account,
no server and no telemetry — the summary is read from the hook payload and
written to a local file. It is not sent anywhere.

Keep the block at the very end of your final message. It is the last thing you
write, after any explanation you were going to give in the chat.
