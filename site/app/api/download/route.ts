/**
 * The download button.
 *
 * Every download link points here rather than at the release directly, and
 * this records the click and then redirects. A click handler on a link that
 * navigates away is a race the navigation usually wins; a redirect through the
 * server cannot miss.
 *
 * The cost is one extra hop before the file starts, which nobody notices, and
 * the benefit is that the download count is the real one.
 */

import { identify, recordDownload } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which button was pressed. Anything unrecognised is recorded as "other"
 *  rather than trusted — this arrives in a query string. */
const SOURCES = new Set(["hero", "install", "nav", "footer"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const asked = url.searchParams.get("from") ?? "other";
  const source = SOURCES.has(asked) ? asked : "other";

  // A person clicking the button arrives from a page on this site, so the
  // browser sends a same-origin `Referer` — our own Referrer-Policy
  // (strict-origin-when-cross-origin) guarantees at least the origin. A hit
  // with no referrer, or one from elsewhere, was not a click on the page.
  // Compared against the `Host` header, not `url.host`. Behind nginx,
  // `request.url` carries the internal origin (127.0.0.1:3000) while the
  // browser's Referer carries the public domain — comparing the two would mark
  // every genuine click as a direct hit.
  const referer = request.headers.get("referer");
  const self = request.headers.get("host") ?? url.host;
  let fromPage = false;
  try {
    fromPage = referer !== null && new URL(referer).host === self;
  } catch {
    fromPage = false;
  }

  try {
    recordDownload(identify(request, referer), source, fromPage);
  } catch (error) {
    // A failure to count must never be a failure to download.
    console.error("download: could not record", error);
  }

  const target = process.env.MUNINN_DOWNLOAD_URL;
  if (!target) {
    return new Response(
      "MUNINN_DOWNLOAD_URL is not set — see .env.example. The click was recorded.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // 302, not 301: a permanent redirect would be cached by the browser and
  // every download after the first would skip this route entirely.
  return Response.redirect(target, 302);
}
