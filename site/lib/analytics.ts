/**
 * Recording and reading traffic.
 *
 * The rule this module exists to enforce: **no raw IP address is ever
 * written to disk.** An address arrives on the request, is mixed with a salt
 * that only exists for the current day, hashed, and dropped. What is stored
 * distinguishes one visitor from another *within* a day and nothing more —
 * tomorrow the same person hashes to something unrelated.
 *
 * That is the same construction Plausible and Fathom use, and it is what lets
 * the landing page keep saying there are no third-party trackers without
 * either lying or giving up on counting.
 */

import { createHash, randomBytes } from "node:crypto";

import { db } from "./db";

export type Device = "desktop" | "mobile" | "tablet" | "bot";

export interface Visitor {
  visitor: string;
  device: Device;
  country: string | null;
  referrer: string | null;
}

/** The local calendar day, as `YYYY-MM-DD`. */
export function today(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The salt for a given day, created on first use.
 *
 * `INSERT OR IGNORE` then `SELECT` rather than check-then-write: two beacons
 * arriving in the same millisecond just after midnight would otherwise race,
 * and the loser would salt its hash differently from everyone else that day.
 */
function saltFor(day: string): string {
  const store = db();
  store
    .prepare("INSERT OR IGNORE INTO salt (day, value) VALUES (?, ?)")
    .run(day, randomBytes(32).toString("hex"));
  const row = store.prepare("SELECT value FROM salt WHERE day = ?").get(day) as
    | { value: string }
    | undefined;
  return row!.value;
}

/** Discard salts older than the retention window, so old hashes go cold. */
export function pruneSalts(keepDays = 60) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  db().prepare("DELETE FROM salt WHERE day < ?").run(today(cutoff));
}

function hashVisitor(ip: string, agent: string, day: string): string {
  return createHash("sha256").update(`${saltFor(day)}|${ip}|${agent}`).digest("hex").slice(0, 32);
}

/**
 * Which of the proxy headers to believe.
 *
 * `x-forwarded-for` is a list appended to by each hop, so the *first* entry is
 * the client — but it is also trivially spoofable when nothing sits in front of
 * the app. That is acceptable here: the worst case is a miscounted visitor, and
 * the value never leaves this function un-hashed.
 */
function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

function deviceOf(agent: string): Device {
  const ua = agent.toLowerCase();
  if (/bot|crawler|spider|crawling|headless|preview|curl|wget|lighthouse/.test(ua)) return "bot";
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet";
  if (/mobi|android|iphone|ipod/.test(ua)) return "mobile";
  return "desktop";
}

/** The referrer's host, or null. Never the full URL — see the schema. */
function referrerHost(raw: string | null, self: string | null): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).host;
    // Moving between pages of this site is not a referral.
    if (self && host === self) return null;
    return host || null;
  } catch {
    return null;
  }
}

/** Everything derivable from the request, with the address already discarded. */
export function identify(request: Request, referrer: string | null): Visitor {
  const headers = request.headers;
  const agent = headers.get("user-agent") ?? "";
  const day = today();

  return {
    visitor: hashVisitor(clientIp(headers), agent, day),
    device: deviceOf(agent),
    // Set by Cloudflare and most reverse proxies; absent otherwise, which is
    // fine — the column is nullable and the dashboard says "unknown".
    country: headers.get("cf-ipcountry") ?? headers.get("x-vercel-ip-country") ?? null,
    referrer: referrerHost(referrer, headers.get("host")),
  };
}

export function recordVisit(who: Visitor, path: string) {
  db()
    .prepare(
      `INSERT INTO visit (day, at, path, referrer, country, device, visitor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(today(), Date.now(), path, who.referrer, who.country, who.device, who.visitor);
}

/**
 * @param fromPage whether the click came from a page on this site. Direct hits
 *   on the endpoint are stored but kept out of the headline figure — see the
 *   `from_page` column's note in db.ts.
 */
export function recordDownload(who: Visitor, source: string, fromPage: boolean) {
  db()
    .prepare(
      `INSERT INTO download (day, at, source, referrer, country, device, visitor, from_page)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(today(), Date.now(), source, who.referrer, who.country, who.device, who.visitor, fromPage ? 1 : 0);
}

// --- reading ---------------------------------------------------------------

export interface DayRow {
  day: string;
  views: number;
  visitors: number;
  downloads: number;
}

export interface Counted {
  label: string;
  count: number;
}

export interface Overview {
  days: DayRow[];
  totals: {
    views: number;
    visitors: number;
    downloads: number;
    conversion: number;
    /** Download hits that could not be attributed to a visitor who loaded the
     *  page — direct hits on the URL, and link-followers that ran no script. */
    direct: number;
  };
  referrers: Counted[];
  paths: Counted[];
  devices: Counted[];
  countries: Counted[];
  sources: Counted[];
  recent: Array<{ at: number; source: string; referrer: string | null; device: string }>;
}

/** `YYYY-MM-DD` for each of the last `days` days, oldest first. */
function window(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(today(d));
  }
  return out;
}

/**
 * Everything the dashboard shows, in one pass.
 *
 * Bots are excluded from every figure. A crawler is not a visit, and counting
 * them makes the whole dashboard a number nobody can act on.
 */
export function overview(days = 30): Overview {
  const store = db();
  const span = window(days);
  const from = span[0]!;
  const notBot = "device != 'bot'";

  /**
   * What separates a person from a crawler.
   *
   * Two filters, because one was not enough. The `from_page` flag catches
   * anything that hits the download URL cold, but a well-behaved crawler loads
   * the page first and follows its links with a proper same-origin `Referer` —
   * indistinguishable from a click by that test alone.
   *
   * What crawlers overwhelmingly do not do is execute JavaScript, and the page
   * view is recorded by a script. So a download only counts if the same
   * visitor also registered a view that day. A person who clicks the button
   * necessarily loaded the page that has the button on it; a link-follower
   * never does.
   */
  const attributed = `${notBot} AND from_page = 1 AND EXISTS (
    SELECT 1 FROM visit v WHERE v.visitor = download.visitor AND v.day = download.day
  )`;

  const views = store
    .prepare(
      `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
         FROM visit WHERE day >= ? AND ${notBot} GROUP BY day`,
    )
    .all(from) as Array<{ day: string; views: number; visitors: number }>;

  const downloads = store
    .prepare(
      `SELECT day, COUNT(*) AS downloads
         FROM download WHERE day >= ? AND ${attributed} GROUP BY day`,
    )
    .all(from) as Array<{ day: string; downloads: number }>;

  const direct = (
    store
      .prepare(
        `SELECT COUNT(*) AS n FROM download WHERE day >= ? AND ${notBot} AND NOT (${attributed})`,
      )
      .get(from) as { n: number }
  ).n;

  const viewsBy = new Map(views.map((r) => [r.day, r]));
  const downloadsBy = new Map(downloads.map((r) => [r.day, r.downloads]));

  // Every day in the range gets a row, including the quiet ones — a chart with
  // gaps silently rescales itself and misleads.
  const rows: DayRow[] = span.map((day) => ({
    day,
    views: viewsBy.get(day)?.views ?? 0,
    visitors: viewsBy.get(day)?.visitors ?? 0,
    downloads: downloadsBy.get(day) ?? 0,
  }));

  const uniqueVisitors = (
    store
      .prepare(`SELECT COUNT(DISTINCT visitor) AS n FROM visit WHERE day >= ? AND ${notBot}`)
      .get(from) as { n: number }
  ).n;

  const totalViews = rows.reduce((n, r) => n + r.views, 0);
  const totalDownloads = rows.reduce((n, r) => n + r.downloads, 0);

  const tally = (sql: string): Counted[] =>
    (store.prepare(sql).all(from) as Array<{ label: string | null; count: number }>).map((r) => ({
      label: r.label ?? "unknown",
      count: r.count,
    }));

  return {
    days: rows,
    totals: {
      views: totalViews,
      visitors: uniqueVisitors,
      downloads: totalDownloads,
      conversion: uniqueVisitors === 0 ? 0 : totalDownloads / uniqueVisitors,
      direct,
    },
    referrers: tally(
      `SELECT COALESCE(referrer, 'direct') AS label, COUNT(*) AS count FROM visit
        WHERE day >= ? AND ${notBot} GROUP BY label ORDER BY count DESC LIMIT 12`,
    ),
    paths: tally(
      `SELECT path AS label, COUNT(*) AS count FROM visit
        WHERE day >= ? AND ${notBot} GROUP BY label ORDER BY count DESC LIMIT 12`,
    ),
    devices: tally(
      `SELECT device AS label, COUNT(*) AS count FROM visit
        WHERE day >= ? AND ${notBot} GROUP BY label ORDER BY count DESC`,
    ),
    countries: tally(
      `SELECT COALESCE(country, 'unknown') AS label, COUNT(*) AS count FROM visit
        WHERE day >= ? AND ${notBot} GROUP BY label ORDER BY count DESC LIMIT 12`,
    ),
    sources: tally(
      `SELECT source AS label, COUNT(*) AS count FROM download
        WHERE day >= ? AND ${attributed} GROUP BY label ORDER BY count DESC`,
    ),
    recent: store
      .prepare(
        `SELECT at, source, referrer, device FROM download
          WHERE ${attributed} ORDER BY at DESC LIMIT 25`,
      )
      .all() as Array<{ at: number; source: string; referrer: string | null; device: string }>,
  };
}
