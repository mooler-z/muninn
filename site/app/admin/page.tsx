/**
 * The dashboard.
 *
 * A server component that reads SQLite directly — there is no API layer
 * between them because there is no second consumer, and adding one would mean
 * a second place for the numbers to be defined.
 *
 * Bots are excluded everywhere (see `overview`), so these are figures someone
 * can act on rather than figures that mostly measure crawlers.
 */

import { overview, pruneSalts } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

function percent(value: number): string {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

function Breakdown({ title, rows, empty }: { title: string; rows: Array<{ label: string; count: number }>; empty: string }) {
  const top = rows[0]?.count ?? 0;

  return (
    <section className="ad-panel">
      <div className="ad-panel-head">
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="ad-empty">{empty}</p>
      ) : (
        <div className="ad-list">
          {rows.map((row) => (
            <div className="ad-row" key={row.label}>
              {/* Proportional to the biggest row rather than to the total, so a
                  long tail stays legible instead of collapsing to hairlines. */}
              <span
                className="ad-row-fill"
                style={{ width: top === 0 ? "0%" : `${Math.max(2, (row.count / top) * 100)}%` }}
              />
              <span className="ad-row-label" title={row.label}>
                {row.label}
              </span>
              <span className="ad-row-count">{row.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const asked = Number((await searchParams).days);
  const days = RANGES.includes(asked as (typeof RANGES)[number]) ? asked : 30;

  // Cheap, and this is the only page guaranteed to be visited now and then.
  pruneSalts();

  const data = overview(days);
  const peak = Math.max(1, ...data.days.map((d) => d.views));
  const peakDownloads = Math.max(1, ...data.days.map((d) => d.downloads));

  return (
    <div className="ad-shell">
      <div className="ad-wrap">
        <header className="ad-bar">
          <span className="ad-title">
            <span className="mn-logo mn-logo--nav" aria-hidden="true" />
            <strong>Muninn</strong>
            <span>Admin</span>
          </span>

          <span className="ad-bar-side">
            <nav className="ad-range">
              {RANGES.map((n) => (
                <a key={n} href={`/admin?days=${n}`} aria-current={n === days ? "true" : undefined}>
                  {n}d
                </a>
              ))}
            </nav>
            <form action="/api/admin/logout" method="post">
              <button type="submit" className="mn-glass ad-logout">
                Sign out
              </button>
            </form>
          </span>
        </header>

        <div className="ad-totals">
          <div className="ad-total">
            <span className="ad-total-label">Visitors</span>
            <span className="ad-total-value">{data.totals.visitors.toLocaleString()}</span>
            <span className="ad-total-note">unique, last {days} days</span>
          </div>
          <div className="ad-total">
            <span className="ad-total-label">Page views</span>
            <span className="ad-total-value">{data.totals.views.toLocaleString()}</span>
            <span className="ad-total-note">bots excluded</span>
          </div>
          <div className="ad-total">
            <span className="ad-total-label">Downloads</span>
            <span className="ad-total-value">{data.totals.downloads.toLocaleString()}</span>
            <span className="ad-total-note">
              by visitors who loaded the page
              {data.totals.direct > 0
                ? ` · ${data.totals.direct.toLocaleString()} unattributed excluded`
                : ""}
            </span>
          </div>
          <div className="ad-total">
            <span className="ad-total-label">Conversion</span>
            <span className="ad-total-value">{percent(data.totals.conversion)}</span>
            <span className="ad-total-note">downloads per unique visitor</span>
          </div>
        </div>

        <section className="ad-panel">
          <div className="ad-panel-head">
            <h2>Daily</h2>
            <span className="ad-legend">
              <span>
                <i style={{ background: "color-mix(in oklab, var(--mn-fg) 26%, transparent)" }} />
                Views
              </span>
              <span>
                <i style={{ background: "var(--mn-accent)" }} />
                Downloads
              </span>
            </span>
          </div>

          <div className="ad-chart">
            {data.days.map((day) => (
              <div
                className="ad-col"
                key={day.day}
                title={`${day.day} · ${day.views} views · ${day.visitors} visitors · ${day.downloads} downloads`}
              >
                {/* Downloads are scaled against their own peak, not against
                    views — on the same scale they would be invisible, which is
                    the number the whole dashboard exists for. */}
                <div
                  className="ad-col-downloads"
                  style={{ height: `${(day.downloads / peakDownloads) * 34}%` }}
                />
                <div className="ad-col-views" style={{ height: `${(day.views / peak) * 62}%` }} />
              </div>
            ))}
          </div>

          <div className="ad-axis">
            <span>{shortDay(data.days[0]!.day)}</span>
            <span>{shortDay(data.days[data.days.length - 1]!.day)}</span>
          </div>
        </section>

        <div className="ad-grid">
          <Breakdown title="Referrers" rows={data.referrers} empty="No visits yet." />
          <Breakdown title="Pages" rows={data.paths} empty="No visits yet." />
          <Breakdown title="Download buttons" rows={data.sources} empty="No downloads yet." />
          <Breakdown title="Devices" rows={data.devices} empty="No visits yet." />
          <Breakdown title="Countries" rows={data.countries} empty="No visits yet." />
        </div>

        <section className="ad-panel">
          <div className="ad-panel-head">
            <h2>Recent downloads</h2>
          </div>
          {data.recent.length === 0 ? (
            <p className="ad-empty">Nothing yet.</p>
          ) : (
            <table className="ad-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Button</th>
                  <th>Referrer</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.at}>
                    <td>{new Date(row.at).toLocaleString()}</td>
                    <td>{row.source}</td>
                    <td>{row.referrer ?? "direct"}</td>
                    <td>{row.device}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="ad-note">
          A download counts when the visitor also loaded the page that day. Certificate
          Transparency logs publish every new certificate, and scanners crawl the domain within
          seconds behind user agents that imitate browsers — they follow links, but they do not run
          the script that records a page view. Unattributed hits are stored, just not counted.
        </p>
        <p className="ad-note" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
          Counted first-party and cookielessly. No IP address is ever written to disk: an address is
          mixed with a salt that exists only for the current day, hashed, and discarded — enough to
          count one person once within a day, and useless for following anyone across days. Salts
          older than sixty days are deleted, which makes those hashes permanently unlinkable to any
          new traffic.
        </p>
      </div>
    </div>
  );
}
