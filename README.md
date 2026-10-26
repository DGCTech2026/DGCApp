# DGC App

Backend for the Davidic Generation Church community app. Members message their branch, join clusters, sit in live audio rooms, and walk a ten-stage growth journey. This repository is the API and the realtime server. The mobile app is a separate project.

Built for about 10,000 registered members, with a few thousand people online at the Sunday peak.

## What you get

- Accounts by email code, password, Google, and Apple. Phone codes turn on when Termii is configured.
- Branch communities, clusters, channels, direct messages, and 1:1 calls.
- Live audio rooms. Agora carries the audio. This server only issues tokens and tracks who is hosting.
- Growth journey: First Timer through Pastorate, with certificates, badges, and admin checks.
- Events, announcements, prayer watch, push notifications, and member reports.

The contract for the mobile team is the live API reference at `/docs` (Swagger, generated from the same schemas that validate requests).

## Stack

| Piece | Choice |
| --- | --- |
| API | Node 22, TypeScript, Express |
| Data | PostgreSQL, Prisma 7 |
| Realtime | Socket.io, shared with the HTTP server |
| Jobs | BullMQ on Redis (email, SMS, push, growth) |
| Files | Cloudinary, signed uploads |
| Mail | Brevo |
| Host | Render, one web service (`render.yaml`) |

Postgres is the source of truth. Redis holds queues, rate limits, and the socket adapter. Workers run inside the web process, so one Render service is the whole backend.

## Run it locally

You need Node 22, a Postgres database, and Redis. Copy the sample env and fill in your own values. Never point this at production.

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev
```

The API listens on port 4000.

- Health: http://localhost:4000/health
- Readiness (database and Redis): http://localhost:4000/ready
- API reference: http://localhost:4000/docs

`npm run build` compiles to `dist/`. `npm start` runs the compiled server. `npm run prisma:seed` loads starter branches, growth stages, and badges into the database named in `.env`.

`prisma migrate dev` cannot run against Render Postgres. Write the migration against a local database, then apply it with `npx prisma migrate deploy`.

Render’s internal Redis hostname only resolves inside Render. From a laptop, use a local Redis or the external Redis URL.

## API

Everything the app calls lives under `/api/v1`. Send `Authorization: Bearer <accessToken>` on protected routes. A successful call returns the resource, or `{ "ok": true }`. A failure returns `{ "error": { "code", "message" } }`.

| Path | What it covers |
| --- | --- |
| `/auth` | Codes, password, Google, Apple, refresh |
| `/bootstrap` | First payload the app needs after login |
| `/users`, `/branches` | Profiles and church branches |
| `/channels`, `/messages` | Community chat |
| `/dms`, `/calls` | Direct messages and 1:1 calls |
| `/clusters` | Interest groups. Joining opens after First Timer |
| `/growth` | The ten-stage journey |
| `/events`, `/announcements` | Calendar and notices |
| `/audio-rooms` | Live rooms |
| `/prayer-watch` | Prayer watch |
| `/notifications` | In-app and push registration |
| `/media` | Signed Cloudinary uploads |
| `/moderation` | Reports and blocks |
| `/admin` | Staff tools |

Chat, presence, and live updates travel over Socket.io on the same port as HTTP. The event list is in the `/docs` guide.

## Deploy

Render reads `render.yaml` and runs one web service from `main`. Each start applies pending migrations, then boots the API, sockets, and workers together. Secrets stay in the Render dashboard. They are marked `sync: false` and are not in git.

Leave the service at one instance until the phone connects with websockets only. Extra copies share rooms through Redis, but the polling handshake does not. See [SCALE.md](SCALE.md) before raising the instance count.

## Repository map

```
src/modules/     one folder per feature (routes, controller, service, schema)
src/infra/       database, Redis, queues, mail, push, sockets
src/jobs/        background workers
src/docs/        OpenAPI spec
prisma/          schema and migrations
scripts/         one-off operational scripts
docs/            product notes and the mobile guide for DMs and calls
```

A feature stays inside its module. Request bodies are checked with zod, and those schemas are what `/docs` shows.

## Read next

- [CLAUDE.md](CLAUDE.md) — how the backend is put together, and the rules for changing it
- [SCALE.md](SCALE.md) — what to provision before a bigger Sunday
- [docs/PRD.md](docs/PRD.md) — the product
- [docs/DM_CALLS_FRONTEND_GUIDE.md](docs/DM_CALLS_FRONTEND_GUIDE.md) — direct messages and calls for the mobile team

## Careful with production

- Do not commit `.env` or paste keys into issues.
- Do not run seed or cleanup scripts against the live database unless you mean to change member data.
- OTP and password mail only reach the inbox reliably after `davidicgenerationchurch.com` is authenticated in Brevo (DKIM). Until then, codes often land in spam.
