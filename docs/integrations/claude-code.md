# Integration: Claude Code

Verified against Claude Code's hooks documentation, August 2026. Re-check before
relying on any field — this is a moving target.

## Which event to use

| Event | Fires when | Use it? |
|---|---|---|
| `Stop` | Claude finishes responding in the main session and is waiting for you | **Yes — the primary trigger** |
| `SubagentStop` | A subagent finishes | No by default; too chatty. Opt-in setting. |
| `Notification` | Claude Code raises a notification | Yes, for the `needs-input` case |

## `Stop` payload

Delivered as JSON on **stdin**:

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/Users/me/.claude/projects/…/transcript.jsonl",
  "cwd": "/Users/me/my-project",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "effort": { "level": "medium" },
  "last_assistant_message": "Here's what I found…"
}
```

**`last_assistant_message` is the whole ballgame.** It is the agent's final text
for the turn, handed to us directly. Everything Muninn shows is derived from it.

`SubagentStop` adds `agent_id` and `agent_type`.

> **Do not read `transcript_path` on the critical path.** The file is written
> asynchronously and may lag the live conversation, so the final message might
> not be in it yet when the hook fires. The docs are explicit about preferring
> `last_assistant_message`. Read the transcript later, for context, if at all.

## `Notification` payload and matchers

```json
{
  "session_id": "…",
  "cwd": "…",
  "hook_event_name": "Notification",
  "notification_type": "permission_prompt"
}
```

Matchers observed:

| Matcher | Meaning | Muninn maps to |
|---|---|---|
| `permission_prompt` | Needs approval; prompt has waited ~6s | `needs-input` |
| `idle_prompt` | Finished ~60s ago, you have not typed | ignore (Stop already fired) |
| `agent_needs_input` | Background session waiting | `needs-input` |
| `agent_completed` | Background session finished or failed | `completed` |
| `auth_success` | Auth completed | ignore |
| `elicitation_dialog` | MCP server opened a form | `needs-input` |
| `elicitation_url_dialog` | MCP server wants to open a URL | `needs-input` |

*Unverified:* whether `Notification` carries the common fields beyond
`session_id`, `cwd`, `hook_event_name`. Handle their absence.

## Setup

In `~/.claude/settings.json` (user-wide) or `.claude/settings.json` (per
project):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "muninn-forward --source claude-code" }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          { "type": "command", "command": "muninn-forward --source claude-code --kind needs-input" }
        ]
      }
    ]
  }
}
```

`matcher` may be omitted (or `""`) to match everything.

Muninn's installer writes this block, merging rather than replacing — users have
their own hooks and clobbering them is unacceptable.

## Hook contract we must respect

- **Read stdin fully, exit fast.** The hook runs in the agent's stop path.
  Budget 500 ms, then exit 0 regardless.
- **Never write to stdout.** Hook stdout can be interpreted by Claude Code.
  Diagnostics go to a log file.
- **Always exit 0.** A non-zero exit from a notification shim must never look
  like a failure to the agent.

## Related built-ins worth knowing

- **Mobile push:** `agentPushNotifEnabled` in settings, toggled via `/config`,
  delivering to the Claude mobile app through Remote Control. Claude decides when
  to send; there is no per-event control. Complementary to Muninn, not a
  competitor — it is a ping, not a briefing.
- **Terminal-native notifications** in Ghostty, Kitty and iTerm2.
- **Phone push via [ntfy.sh](https://ntfy.sh)** is the common community pattern:
  a one-line `curl` in the hook.
