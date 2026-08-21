# Muninn — site

The landing page and the admin portal that counts visits and downloads.

Separate from the app: this has its own `package.json` and its own `node_modules`,
and nothing here is bundled into the Tauri build. The two share only a design —
`styles/tokens.css` holds the same palette values as `ui/src/styles/tokens.css`,
so the page and the product cannot drift apart on colour.

Ported from the Claude Design project file `Muninn Landing.dc.html`. See
[`../docs/landing-page-brief.md`](../docs/landing-page-brief.md) for the design
system in prose.

## Running it

```sh
cp .env.example .env.local     # then fill in the two required values
npm install
npm run dev                    # http://localhost:3210
```

`MUNINN_ADMIN_PASSWORD` and `MUNINN_SESSION_SECRET` are both required — there is
no default password, and the app refuses to sign a session with a short key
rather than doing it insecurely. Generate the secret with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`npm run build && npm start` for production. It expects a writable disk for the
SQLite file, so it wants a VPS, a container with a volume, or a Mac — **not** a
platform with an ephemeral filesystem, where the database is lost on every
deploy.

Put a reverse proxy in front of it that sets `X-Forwarded-For`, or every visitor
hashes identically and the unique count becomes 1.

## How counting works

Two things are recorded, and neither uses a cookie or a third party.

**Visits.** A `sendBeacon` from the browser to `/api/track` after the page
loads. Done client-side rather than during render because the landing page is
static — counting server-side would mean opting out of caching, and it would
count every prefetch and uptime check as a reader.

**Downloads.** Every download button points at `/api/download?from=…`, which
records the click and then 302s to `MUNINN_DOWNLOAD_URL`. A click handler on a
link that navigates away is a race the navigation usually wins; a redirect
cannot miss. The `from` parameter says which button, and is checked against an
allowlist rather than trusted.

### No IP address is ever written to disk

An address arrives on the request, is mixed with a salt that exists only for the
current day, hashed, and dropped. What is stored distinguishes one visitor from
another *within* a day and nothing further — tomorrow the same person hashes to
something unrelated. Salts older than sixty days are deleted, which makes those
hashes permanently unlinkable to any new traffic.

This is the same construction Plausible and Fathom use. It is what lets the
landing page keep a truthful privacy claim in its footer while still counting.

Bots are classified on arrival and excluded from every figure on the dashboard.
They are still stored, so the classifier can be revisited without having thrown
the data away.

## Layout

```
app/
  page.tsx              the landing page — one server component, two client islands
  admin/                dashboard and login
  api/track/            the view beacon
  api/download/         record, then redirect to the release
  api/admin/            login and logout
components/             ThemeToggle, Beacon, LoginForm
lib/
  db.ts                 SQLite connection and schema
  analytics.ts          recording and the dashboard's queries
  auth.ts               password check and signed session cookie
middleware.ts           the /admin gate
styles/                 tokens, landing, admin
```

`/admin` is gated in middleware rather than per-page, so a new admin route is
protected by existing rather than by remembering to add a guard.
