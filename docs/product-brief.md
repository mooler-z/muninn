# Product brief

## The user

Someone running a coding agent on a real task that takes five to thirty minutes.
They want to leave — read, watch something, cook — and come back informed
without replaying a terminal.

They are not looking for a dashboard. They look at Muninn a handful of times a
day, for thirty seconds each time.

## The job to be done

> "Tell me what happened while I was gone, well enough that I know whether to
> look closer — without me having to read the transcript."

Three questions, in order:

1. **Did it work?**
2. **Do I need to do something?** (blocked, or a decision needed)
3. **What is it going to do next?**

## Success

- The user genuinely stops watching the terminal.
- The panel answers all three questions without expanding anything.
- The sound never makes anyone flinch. Nobody disables it.

## Failure

- The user reads the panel and opens the terminal anyway to find out what really
  happened. The summary was not trustworthy or not specific enough.
- The sound is annoying, so it gets muted, so the tool is useless.
- It fires too often — every subagent, every tool call — and becomes noise.

That last one is the likeliest failure. **Default to under-notifying.**
`SubagentStop` is off by default for this reason.

## Scope — v1

In:
- Claude Code `Stop` and permission-needed events
- Local receiver, panel, sound
- Summary-block parsing with raw-markdown fallback
- Menu bar item: last summary, mute, quit
- History of the last N summaries, local only

Out:
- Replying to the agent
- Multi-machine or remote sessions
- Mobile
- Codex (until its payload is verified — see
  [integrations/codex.md](integrations/codex.md))
- Anything resembling analytics

## Competitive position

The existing tools answer "is it still running?" and "how much have I spent?".
Muninn answers "what did it do?". Adjacent, not overlapping — a user can
reasonably run Muninn alongside a usage tracker.

The moat, such as it is, is the [summary contract](summary-contract.md): the
value comes from shaping the agent's output at the source, which a passive
monitor cannot do.

## Questions that were open, and how they closed

- *Does the panel appear automatically?* Yes — it appears without stealing
  focus, and waits until seen. The premise is that the user is not at the desk;
  a sound-then-open flow assumes they are.
- *Is history worth keeping beyond the current day?* Yes. The last fifty turns,
  each with the prompt that caused it, searchable with project names ranked
  first. "When did this start going wrong" turned out to be the question users
  actually have.
- *Should `blocked` escalate?* No. It was tempting and it lost to "never
  startle": escalation is an alarm by instalments. `blocked` takes the headline
  slot and the accent instead — louder placement, not louder sound.
