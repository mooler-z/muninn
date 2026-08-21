# Integration: Codex CLI

> **Status: UNVERIFIED.** Everything below needs confirming against the current
> Codex CLI before any code is written. It is recorded as a starting point, not
> as fact. Do not implement from this page alone.

## What we believe

Codex CLI supports a `notify` configuration that runs an external program when
certain events occur. The intent matches Claude Code's `Stop` hook: the agent
invokes a command you specify when it finishes or needs attention.

Believed to differ from Claude Code in ways that matter to us:

1. **Configured in Codex's own config file**, not `settings.json`.
2. **Arguments may arrive as argv rather than JSON on stdin.**
3. **There may be no equivalent of `last_assistant_message`.** This is the
   important unknown — if Codex does not hand over the closing text, Muninn must
   recover it from Codex's session/rollout files, which is a different and
   worse code path than the Claude Code one.

## What to verify, in order

1. Exact config key and file location for `notify`.
2. Whether the payload is argv or stdin, and its schema.
3. **Whether the agent's final message is included.** If not, find where Codex
   persists session history and how far behind it lags.
4. Which events fire — completion only, or also approval-required?
5. Whether the command blocks the agent while running.

## Design consequence

The normaliser in the receiver exists precisely because of this page. Both
sources must collapse into the one internal event shape defined in
[ARCHITECTURE.md](../../ARCHITECTURE.md), so the panel never learns which agent
produced a summary.

If Codex turns out not to expose the closing message, the fallback is:

- Panel shows project, branch, duration and "finished".
- Body is filled from Codex's session file once readable, arriving late.
- The [summary contract](../summary-contract.md) still applies — a user can
  instruct Codex to end turns with the same block, and we parse it from whatever
  text we can reach.

## Other agents

The same normaliser should make Aider, Gemini CLI, and others cheap to add. Each
gets a page here, with the same rule: a source is not supported until its
payload schema is written down and verified.
