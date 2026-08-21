/**
 * The analytics store.
 *
 * SQLite, on the box the site runs on. There is no external service, no
 * third-party script, and nothing to sign up for — which is the only kind of
 * analytics this particular product can honestly ship, given the page it is
 * attached to promises no third-party trackers.
 *
 * WAL mode because the reader (the admin portal) and the writer (the beacon
 * route) are concurrent and a default-journal SQLite would have them blocking
 * each other on every page view.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

let handle: Database.Database | null = null;

function open(): Database.Database {
  const path = process.env.MUNINN_DB_PATH ?? resolve(process.cwd(), "data/muninn-site.db");
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  // Durability is worth less here than write latency: losing the last few page
  // views to a power cut is not a problem worth an fsync per beacon.
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

/**
 * The connection, opened once per process.
 *
 * Next reloads modules in development, so this must survive a hot reload or
 * every edit leaks a file handle. Stashing it on `globalThis` is the standard
 * escape hatch.
 */
export function db(): Database.Database {
  if (handle) return handle;

  const store = globalThis as typeof globalThis & { __muninnDb?: Database.Database };
  handle = store.__muninnDb ?? open();
  if (process.env.NODE_ENV !== "production") store.__muninnDb = handle;
  return handle;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visit (
      id        INTEGER PRIMARY KEY,
      -- Local calendar day, 'YYYY-MM-DD'. Stored rather than derived so the
      -- day a visit belongs to cannot shift when the server's timezone does.
      day       TEXT NOT NULL,
      at        INTEGER NOT NULL,
      path      TEXT NOT NULL,
      -- Referrer *host* only. The full URL can carry search terms and private
      -- paths, and the host answers the only question worth asking.
      referrer  TEXT,
      country   TEXT,
      device    TEXT NOT NULL,
      -- Salted hash of IP + user agent, where the salt rotates daily. Enough to
      -- count one person once per day; useless for following them across days,
      -- and it cannot be turned back into an IP address.
      visitor   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS visit_day ON visit (day);
    CREATE INDEX IF NOT EXISTS visit_at ON visit (at);
    CREATE INDEX IF NOT EXISTS visit_visitor_day ON visit (visitor, day);

    CREATE TABLE IF NOT EXISTS download (
      id       INTEGER PRIMARY KEY,
      day      TEXT NOT NULL,
      at       INTEGER NOT NULL,
      -- Which button: 'hero', 'install', or whatever a future one is called.
      source   TEXT NOT NULL,
      -- 1 when the click came from a page on this site, 0 when the endpoint
      -- was hit directly. Certificate Transparency logs publish every new
      -- certificate, and scanners crawl the domain within seconds of issuance
      -- and follow every link — including both download buttons. Those are not
      -- people, and their user agents imitate browsers, so the UA classifier
      -- never sees them. Where the request came from does.
      from_page INTEGER NOT NULL DEFAULT 1,
      referrer TEXT,
      country  TEXT,
      device   TEXT NOT NULL,
      visitor  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS download_day ON download (day);
    CREATE INDEX IF NOT EXISTS download_at ON download (at);

    -- One row per day, holding that day's hashing salt. Deleting a row makes
    -- that day's visitor hashes permanently unlinkable to any new traffic.
    CREATE TABLE IF NOT EXISTS salt (
      day   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
  // so a column added after the first deploy needs its own step.
  const columns = db.prepare("SELECT name FROM pragma_table_info('download')").all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === "from_page")) {
    db.exec("ALTER TABLE download ADD COLUMN from_page INTEGER NOT NULL DEFAULT 1");
  }
}
