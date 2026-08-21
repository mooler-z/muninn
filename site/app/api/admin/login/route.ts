/**
 * Admin login.
 *
 * Rate-limited in memory rather than in the database: the window is a minute,
 * losing it on restart is harmless, and a failed-login table is a write path an
 * unauthenticated caller controls.
 */

import { cookies } from "next/headers";

import { cookieOptions, correctPassword, issue, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

const attempts = new Map<string, { count: number; until: number }>();

function tooMany(who: string): boolean {
  const now = Date.now();
  const seen = attempts.get(who);

  if (!seen || seen.until < now) {
    attempts.set(who, { count: 1, until: now + WINDOW_MS });
    return false;
  }

  seen.count += 1;
  return seen.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const who = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (tooMany(who)) {
    return Response.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  }

  const form = await request.formData();
  const password = form.get("password");

  if (typeof password !== "string" || !(await correctPassword(password))) {
    // Deliberately not specific about which part was wrong.
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  const session = await issue();
  (await cookies()).set(SESSION_COOKIE, session.value, cookieOptions(session.maxAge));

  const next = form.get("next");
  const to = typeof next === "string" && next.startsWith("/admin") ? next : "/admin";
  return Response.json({ ok: true, next: to });
}
