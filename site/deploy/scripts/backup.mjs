/**
 * A consistent copy of the SQLite file, taken while the app is running.
 *
 * `cp` is not safe here. The database runs in WAL mode, so at any moment part
 * of the committed state lives in `-wal` and copying the three files
 * individually can catch them mid-checkpoint. SQLite's own backup API walks
 * the pages under a read lock and produces a single consistent file, without
 * blocking writers for more than a moment.
 *
 * Run inside the container, where better-sqlite3 already is:
 *   docker compose ... exec -T app node deploy/scripts/backup.mjs /data/backup.db
 */

import Database from "better-sqlite3";

const source = process.env.MUNINN_DB_PATH ?? "/data/muninn-site.db";
const target = process.argv[2];

if (!target) {
  console.error("usage: backup.mjs <target-path>");
  process.exit(2);
}

const db = new Database(source, { readonly: true });

try {
  await db.backup(target);
  console.log(`backed up ${source} → ${target}`);
} finally {
  db.close();
}
