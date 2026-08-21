/**
 * The page-view beacon.
 *
 * A view is recorded from the browser rather than while rendering the page, for
 * two reasons: the landing page is static and would otherwise have to opt out
 * of caching to count anything, and a server-side count includes every
 * prefetch, crawler and uptime check as a human reading the page.
 */

import { identify, recordVisit } from "@/lib/analytics";

export const runtime = "nodejs";
// Never cached, never prerendered — it exists entirely for its side effect.
export const dynamic = "force-dynamic";

interface Beacon {
  path?: unknown;
  referrer?: unknown;
}

export async function POST(request: Request) {
  let body: Beacon = {};
  try {
    body = (await request.json()) as Beacon;
  } catch {
    // A malformed beacon is not worth an error page. Record the visit against
    // the site root and move on.
  }

  const path = typeof body.path === "string" ? body.path.slice(0, 512) : "/";
  const referrer = typeof body.referrer === "string" && body.referrer ? body.referrer : null;

  try {
    recordVisit(identify(request, referrer), path);
  } catch (error) {
    // Analytics must never be able to break the page it measures. Log it and
    // return success — the visitor's browser has nothing useful to do with a
    // failure here.
    console.error("track: could not record visit", error);
  }

  // 204: nothing to send back, and `sendBeacon` ignores the body anyway.
  return new Response(null, { status: 204 });
}
