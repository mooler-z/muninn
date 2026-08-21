# Muninn site — landing page + admin portal.
#
# Build context is the SITE directory (not the repo root — the Tauri app above
# is unrelated and would only bloat the context):
#   docker build -f deploy/Dockerfile .
#
# Debian slim rather than Alpine, deliberately. better-sqlite3 is a native
# module and publishes prebuilt binaries for glibc; on musl there is no prebuild
# and every image build compiles it from source with node-gyp. Slim is a larger
# base and a much shorter, more reliable build.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Manifests first — this layer caches until dependencies actually change.
COPY package.json package-lock.json ./
# `npm ci` runs better-sqlite3's install script, which fetches its prebuild.
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The admin portal refuses to sign sessions with a short key, and `next build`
# imports that module while collecting page data. This value is never used at
# runtime — compose supplies the real one — but something has to satisfy the
# check during the build.
ENV MUNINN_SESSION_SECRET=build-time-placeholder-not-a-secret
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server listens on this; nginx on the host proxies to it.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Ownership is applied during the copy rather than by a `RUN chown -R` after
# it — a recursive chown rewrites every file into a new layer and can never
# cache. (The sibling my-future app measured 23 minutes on that mistake.)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Copied explicitly rather than relied on from the trace. Next's file tracing
# follows `require` graphs, and better-sqlite3's real payload is a `.node`
# binary loaded at runtime by path — exactly the shape tracing is worst at. If
# this is ever missing, every page that touches the database 500s at runtime
# and the build says nothing.
COPY --from=deps --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=node:node /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps --chown=node:node /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

COPY --chown=node:node --chmod=755 deploy/scripts/backup.mjs ./deploy/scripts/backup.mjs

# The SQLite file lives on a bind mount from the host. The directory is created
# by the deploy steps owned by this uid; the app also mkdir -p's it on boot.
ENV MUNINN_DB_PATH=/data/muninn-site.db
VOLUME ["/data"]

# Never root. A process that can write the bind mount as uid 0 is a process
# that can hand a host-owned file to the next thing that reads it.
USER node
EXPOSE 3000
CMD ["node", "server.js"]
