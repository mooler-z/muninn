/**
 * Admin sessions.
 *
 * One password, held in the environment, and a cookie carrying nothing but an
 * expiry and a signature over it. There is no user table because there is one
 * user; adding accounts to a single-operator dashboard is complexity bought
 * with no benefit.
 *
 * Written against Web Crypto rather than `node:crypto` so the same verify runs
 * in middleware — Next's middleware is Edge-runtime and cannot load Node's
 * crypto module. Middleware is where the check has to happen, because that is
 * the only place that covers every `/admin` route without each page
 * remembering to ask.
 */

export const SESSION_COOKIE = "mn_admin";

/** Long enough not to be a nuisance, short enough that a forgotten laptop
 *  stops mattering within the week. */
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.MUNINN_SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "MUNINN_SESSION_SECRET is missing or too short — see .env.example. " +
        "Refusing to sign sessions with a guessable key.",
    );
  }
  return value;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking, through timing, how much of the tag matched. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `<expiry>.<signature>`. The expiry is in the payload *and* signed, so it
 *  cannot be pushed forward by editing the cookie. */
export async function issue(): Promise<{ value: string; maxAge: number }> {
  const expires = Date.now() + SESSION_MS;
  const signature = hex(
    await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(String(expires))),
  );
  return { value: `${expires}.${signature}`, maxAge: Math.floor(SESSION_MS / 1000) };
}

export async function valid(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const dot = token.indexOf(".");
  if (dot < 1) return false;

  const expires = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;

  const expected = hex(
    await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(expires)),
  );
  return sameString(signature, expected);
}

/**
 * Is this the password?
 *
 * Compared against its SHA-256 rather than directly, so the comparison is over
 * two fixed-length strings — a raw compare would leak the password's length
 * through `sameString`'s early return.
 */
export async function correctPassword(attempt: string): Promise<boolean> {
  const expected = process.env.MUNINN_ADMIN_PASSWORD;
  if (!expected) return false;

  const digest = async (s: string) =>
    hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

  return sameString(await digest(attempt), await digest(expected));
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
