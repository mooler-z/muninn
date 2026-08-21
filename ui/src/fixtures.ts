/**
 * Canned events, one per state the design draws.
 *
 * These exist so the panel can be checked against
 * `Muninn Panel States v2.dc.html` without running an agent and waiting for it
 * to finish. The copy is the design's own, deliberately — if a state stops
 * matching, the difference should be the layout rather than the words.
 */

import type { MuninnEvent, Summary, View } from "./types";

const emptySummary: Summary = {
  done: null,
  changed: [],
  verified: null,
  next: null,
  blocked: null,
  risk: null,
  explain: null,
  extra: [],
};

function event(partial: Partial<MuninnEvent>): MuninnEvent {
  return {
    id: "fixture",
    source: "claude-code",
    sessionId: "abc123",
    promptId: null,
    prompt: null,
    transcriptPath: null,
    cwd: "/Users/me/signup-flow",
    project: "signup-flow",
    gitBranch: "feat/phone-verify",
    kind: "completed",
    receivedAt: "2026-08-17T16:42:00Z",
    summary: null,
    raw: "",
    ...partial,
  };
}

function view(partial: Partial<View> & { event: MuninnEvent }): View {
  return { position: 1, total: 1, rawHtml: "", explainHtml: "", ...partial };
}

export const FIXTURES: { name: string; note: string; view: View }[] = [
  {
    name: "Completed, full summary",
    note: "The happy path. Outcome, involvement, next step — readable top to bottom without a click.",
    view: view({
      event: event({
        summary: {
          ...emptySummary,
          done: "Added phone-number verification to the signup flow and got the suite green.",
          changed: [
            {
              path: "apps/api/src/auth/verify.ts",
              note: "new OTP issue and verify endpoints",
            },
            {
              path: "apps/web/app/signup/page.tsx",
              note: "phone step before the password screen",
            },
          ],
          verified: "34 tests pass; sent an OTP to a real number against the sandbox.",
          next: "Wire the rate limiter — sending is unbounded, so one number can be spammed.",
          risk: "The OTP store is in-memory; a deploy wipes pending codes.",
        },
      }),
    }),
  },
  {
    name: "Blocked",
    note: "The blocked sentence takes the headline slot; what got done moves one notch down.",
    view: view({
      event: event({
        receivedAt: "2026-08-17T16:58:00Z",
        summary: {
          ...emptySummary,
          done: "Added phone-number verification to the signup flow and got the suite green.",
          next: "Wire the rate limiter once the key lands — sending is unbounded right now.",
          blocked: "Needs a Twilio production key — the sandbox only sends to verified numbers.",
        },
      }),
    }),
  },
  {
    name: "Raw fallback",
    note: "No structured block — the agent's closing prose, shown as written.",
    view: view({
      event: event({
        source: "codex",
        project: "orders-etl",
        cwd: "/Users/me/orders-etl",
        gitBranch: "main",
        receivedAt: "2026-08-17T15:26:00Z",
        raw: "Switched the exporter to stream rows…",
      }),
      rawHtml:
        "<p>Switched the exporter to stream rows instead of buffering the whole table — " +
        "memory stays flat around 60 MB on the four-million-row backfill.</p>" +
        "<p>The old path is still there behind <code>EXPORT_STREAMING=0</code> if anything " +
        "looks off.</p>" +
        "<p>The nightly job needs the new IAM role before Thursday's run.</p>",
    }),
  },
  {
    name: "No summary",
    note: "Nothing came back. Say so; never fabricate.",
    view: view({
      event: event({
        project: "infra-scripts",
        cwd: "/Users/me/infra-scripts",
        gitBranch: "main",
        receivedAt: "2026-08-17T12:04:00Z",
      }),
    }),
  },
  {
    name: "Needs input",
    note: "A permission, not a problem. Lighter than a completed turn.",
    view: view({
      event: event({
        kind: "needs-input",
        receivedAt: "2026-08-17T17:12:00Z",
      }),
    }),
  },
  {
    name: "Needs input, with a question",
    note: "When the payload does carry the question. Claude Code's Notification hook does not today — see docs/integrations/claude-code.md.",
    view: view({
      event: event({
        kind: "needs-input",
        receivedAt: "2026-08-17T17:12:00Z",
        summary: {
          ...emptySummary,
          blocked: "May it run prisma migrate reset on the local database?",
        },
      }),
    }),
  },
  {
    name: "Queue",
    note: "Three agents finished — one panel, a count, paging. Never a pile of windows.",
    view: view({
      position: 2,
      total: 3,
      event: event({
        source: "codex",
        project: "checkout-api",
        cwd: "/Users/me/checkout-api",
        gitBranch: "fix/idempotency-keys",
        receivedAt: "2026-08-17T16:47:00Z",
        summary: {
          ...emptySummary,
          done: "Idempotency keys now cover the retry path; double charges on flaky networks are gone.",
          next: "Backfill keys for the last 30 days of open carts.",
        },
      }),
    }),
  },
  {
    name: "A long one",
    note: "Not in the design, but the case design principle §2 is about: the first screen still has to carry the outcome.",
    view: view({
      event: event({
        summary: {
          ...emptySummary,
          done: "Migrated the billing service off the legacy Stripe SDK and reconciled three months of drifted invoices.",
          changed: Array.from({ length: 9 }, (_, i) => ({
            path: `services/billing/src/module-${i + 1}/index.ts`,
            note: "ported to the new client and re-typed the webhook payloads",
          })),
          verified:
            "The full suite passes (612 tests), and I replayed 2,000 archived webhooks through the new handler with no diffs.",
          next: "Delete the compatibility shim once the staging soak has run for a week.",
          risk: "Invoice numbering changed format; anything parsing it downstream will break.",
        },
      }),
    }),
  },
];
