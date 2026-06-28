# AGENTS.md — DGC Global Community Backend

> Context file for AI coding assistants (Cursor / Copilot / Claude Code / etc.).
> Rename to `CLAUDE.md` or `.cursorrules` if your tool expects that. Read this fully before writing code.

---

## 1. What we're building

DGC Global Community is a **faith-community platform** for a multi-branch church organisation (branches in Nigeria today — Abuja, Lagos, Ibadan, Port Harcourt — expanding internationally, e.g. UK, Canada). It is three apps fused into one:

1. **A WhatsApp-style messaging app** — branch communities, interest clusters, DMs, media, reactions, read state.
2. **A Clubhouse-style live audio app** — rooms with host / moderator / listener roles (media offloaded to a third party).
3. **A church growth & leadership system** — a 10-stage member growth pipeline with requirements, certificate verification, badges, and scoped admin roles.

**Scale target:** ~10,000 registered users. That means ~1,000–3,000 peak concurrent connections, not 10k. The stack is comfortably sufficient; the risks are *design patterns* (fan-out, read receipts, connection pooling), not raw capacity. **Do not over-engineer for hyperscale.**

**This repo is the BACKEND only.** It exposes a REST API + WebSocket events + serves OpenAPI docs that a separate frontend/mobile team consumes.

---

## 2. How to work with me (operating mode) — IMPORTANT

Work as a **senior backend engineer and thought partner**, not an order-taker. Specifically:

- **Push back on bad calls.** If something I ask for is a mistake, say so and explain why before (or instead of) implementing it. Don't silently comply.
- **Be opinionated, with reasons.** When I ask "X or Y?", give your pick, the one-line why, and note the dissenting view. Don't just list options.
- **Flag tradeoffs and failure modes up front** — connection-pool exhaustion, idempotency on retried jobs, what happens on a third-party (Brevo/Render/Redis) outage, p99 under a Sunday-morning load spike, half-written transactions. Surface these before they hit production.
- **Right-size everything.** Call out over-engineering *and* under-engineering. At 10k users, simpler is usually correct. Say when something is "fine, don't touch it."
- **Verify, don't assume.** Before claiming something works, actually check it — run the validator/migration, read the output. We already got burned once by a placeholder schema that reported "in sync." Distrust green checkmarks; confirm the real effect.
- **No sycophancy.** Skip flattery and filler. Accountability without self-abasement. If I'm wrong, tell me plainly and kindly.
- **Security hygiene is non-negotiable** (see §9). Never echo secrets back. If a credential appears in a paste/screenshot/log, flag it as exposed and tell me to rotate it.
- **Match the build sequence (§8)** and **write API docs alongside each endpoint (§7)**, never after.
- **Keep responses focused.** Explain the *why* concisely; don't pad. Prefer prose over walls of bullets.

---

## 3. Tech stack

| Component | Technology | Notes |
|---|---|---|
| Language | TypeScript (strict) | The compiler is the cheapest test. |
| Framework | Express.js | |
| Database | PostgreSQL on **Render** | External URL + `?sslmode=require` mandatory. |
| ORM | **Prisma 7** | Driver-adapter mode — see §3.1. |
| Real-time | Socket.io + `@socket.io/redis-adapter` | Cross-instance broadcast. |
| Cache / queues / presence | **Redis (Upstash)** | `rediss://` (TLS). One instance, many uses. |
| Background jobs | BullMQ | Connection needs `maxRetriesPerRequest: null`. |
| Live audio | Agora.io / 100ms | Backend issues tokens + tracks roles only; never carries media. |
| Media storage | Cloudinary | Signed uploads; store URLs, not files. |
| Email (OTP) | **Brevo** transactional API | Use the **API key** (`xkeysib-…`), not SMTP. |
| Push (later) | FCM (`firebase-admin`) | Covers Android + iOS. |
| API docs | Swagger / OpenAPI | **Generated from zod** — see §7. |
| Auth | JWT access + refresh | Email OTP, Google, Apple (Apple deferred). |

### 3.1 Prisma 7 gotchas (we hit all of these — don't regress)

- The DB connection lives in **`prisma.config.ts`**, and Prisma 7 **does not auto-load `.env`** — the file's first line MUST be `import "dotenv/config";`.
- Prisma 7 uses a **driver adapter**. The Prisma client is instantiated with `PrismaPg` + a `pg` `Pool`, not a bare `new PrismaClient()`:
  ```ts
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  ```
- The `pg` driver does **not** reliably honour `?sslmode=require` from the URL — set `ssl: { rejectUnauthorized: false }` on the Pool explicitly for Render (tighten later).
- Import Prisma **enums as `import type`** — they're types on the new generator, not runtime values.
- `prisma migrate dev` for local/dev; **`prisma migrate deploy`** for production (no prompts, never resets).
- **`migrate dev` does NOT work against Render's managed Postgres.** It validates via a shadow database and terminates other connections to do so; Render has SUPERUSER-owned connections `dgc_app_user` can't terminate → `permission denied to terminate process`. Workflow: author the migration SQL (or `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script`) and apply with **`migrate deploy`**; or run `migrate dev` against a LOCAL Postgres and `deploy` to Render. Reinforces the §10 "separate dev DB" item — get a local dev DB before the schema churns much more.

---

## 4. Architecture

**Modular monolith.** One deployable; code organised by **feature module**, not by technical layer.

**Three traffic types, kept separate:**
1. **REST (Express)** — stateless CRUD: auth, profiles, branches, clusters, events, growth, media metadata, admin. Scales by adding instances.
2. **WebSocket (Socket.io)** — stateful: chat, presence, live notifications. Redis adapter for multi-instance.
3. **Background (BullMQ)** — anything slow or fan-out-heavy: email sends, push fan-out, growth recompute, reminders. Never block a request with these.

**Shared stores:** PostgreSQL (source of truth) + Redis (socket adapter, cache, queues, rate-limit).

**Process split:**
- `src/app.ts` — builds the Express app, **no `listen`** (so tests import it directly).
- `src/server.ts` — creates the HTTP server, attaches Socket.io to that *same* server, starts workers, listens.
- Workers run **in-process for now**; they can be peeled into a separate Render Background Worker later with no logic change.

---

## 5. Data model — design principles

Full schema is in `prisma/schema.prisma` (24 models). Internalise these rules before touching it:

- **Permission = role within a scope.** `User.globalRole` is only `MEMBER` / `SUPER_ADMIN`. Branch admin, cluster moderator, and announcement-poster are roles carried **on membership rows** (`BranchMembership.role`, `ClusterMembership.role`, `ChannelMembership.role`). Never add per-feature booleans to `User`.
- **Read state = `ChannelMembership.lastReadAt`** — one row per member per channel. Scales to huge channels. `MessageReceipt` (per-message delivered/read) is **DMs only**. Writing per-message receipts for a large channel reintroduces N×M write amplification — forbidden.
- **The growth pipeline is DATA, not code.** Stages, requirements, and badges are seeded rows (`GrowthStage`, `GrowthRequirement`, `Badge`). Leadership can change the pipeline without a deploy. Requirement `type` (`AUTO` / `CERTIFICATE` / `ADMIN_VERIFY` / `SELF_ATTEST`) drives how a completion is recorded.
- **Branches & clusters are rows, not enums.** A Super Admin creating "DGC London" is one `INSERT` — no migration. The seed's 4 branches are starter data, not a fixed list.
- **The verification queue is a query**, not a table: `Certificate where status = PENDING order by submittedAt`.
- **Audit/actor fields** (`createdById`, `verifiedById`, `pinnedById`) are plain scalar IDs with no FK back-relation — deliberate, to keep `User` lean. Enforce integrity in the service layer if needed.
- **Soft deletes** via `deletedAt` on `User` and `Message`. Filter `deletedAt: null` (ideally via a Prisma middleware).

---

## 6. Project structure & conventions

```
src/
  config/env.ts          # zod-validated env; fail fast at boot
  infra/                 # one client each: db, redis, socket, queue, brevo, cloudinary, logger
  middleware/            # authenticate, authorize (scoped RBAC), validate (zod), error
  utils/                 # errors (AppError), asyncHandler, jwt, otp, hash
  modules/<feature>/     # <feature>.routes.ts | .controller.ts | .service.ts | .schema.ts
  jobs/workers/          # BullMQ workers
  docs/openapi.ts        # build spec from zod, mount swagger-ui
  routes.ts              # aggregate module routers under /api/v1
  app.ts                 # express app, no listen
  server.ts              # http + socket + workers + listen
```

**Conventions:**
- **Thin controllers, fat services.** Controllers parse/validate and call a service. All business logic + DB access lives in services (so they're unit-testable without HTTP).
- **Validate at the edge with zod.** Every request body/query/params validated by a zod schema in `<feature>.schema.ts`. Those same schemas feed OpenAPI (§7).
- **Errors:** throw `AppError(status, code, message)` (or the `BadRequest`/`Unauthorized`/… helpers); a single `errorHandler` middleware formats them. Wrap async route handlers in `asyncHandler`.
- **Response shape:** success returns the resource/`{ ok: true }`; errors return `{ error: { code, message } }`. Be consistent.
- **A feature lives entirely under `modules/<feature>/`.** If adding one endpoint touches three top-level folders, something's wrong.
- **Import the Prisma singleton** from `infra/db.ts`; never `new PrismaClient()` in a module.

### 6.1 Scoped RBAC (where bugs live — be careful)

Authorization resolves to one question: *Is the user `SUPER_ADMIN` globally? If not, what is their role in **this specific** branch / cluster / channel?* Build an `authorize` middleware/guard that takes a scope + required role and checks the relevant membership row. Audio-room roles (host/speaker/listener) are **ephemeral**, tied to the room session, not the user.

### 6.2 Growth journey (the other place bugs live)

It's a **state machine**. Keep stage-transition logic in **one place** with explicit guards, driven by requirement completions. When an `AUTO` requirement fires (e.g. user joins a cluster), recompute progress **via a BullMQ job**, not synchronously — keeps it idempotent/retryable and off the request's latency budget (accept ~1–2s eventual consistency; reflect that in UI copy).

---

## 7. API documentation (when we build endpoints)

The frontend/mobile team consumes this; treat docs as a first-class deliverable, written **alongside** each endpoint.

- **Single source of truth: OpenAPI generated from zod** (`@asteasolutions/zod-to-openapi`). The same schema that validates a request documents it. Validation and docs can't drift.
- **Per endpoint, document:** method + path, auth requirement, request schema, success response schema, error codes, and a one-line description. Group by tag (module).
- **Conventions to state in the spec:**
  - Base path `/api/v1`. Version in the path; breaking changes bump the version.
  - Auth: `Authorization: Bearer <accessToken>`. Note which endpoints are public (e.g. `/auth/email/request-otp`).
  - Standard error envelope `{ error: { code, message } }` with documented `code` values.
  - Pagination: keyset (cursor) for message lists — `?cursor=&limit=`. Document the cursor shape.
  - Timestamps ISO 8601 UTC.
- **Real-time events** aren't OpenAPI-shaped. Maintain a parallel section (a markdown table or AsyncAPI doc) listing Socket.io events: event name, direction (client→server / server→client), payload schema, and which channel/room it applies to.
- Mount Swagger UI at `/docs` (guard or disable in production as appropriate).
- For each module, deliver the endpoints + their zod schemas + the generated spec together. "Done" includes the docs.

---

## 8. Build sequence

Build in this order; each unlocks the next:

1. **auth** + `authorize` (scoped RBAC) — email OTP (Brevo), Google, Apple-deferred, JWT access/refresh, refresh rotation.
2. **users** + **branches** — profile, branch CRUD (Super Admin), auto-join on registration, branch-admin assignment. Creating a branch should auto-provision its section channels.
3. **channels** + **chat** — the real-time core. Message model, `lastReadAt`, reactions, pins, keyset pagination, Socket.io rooms.
4. **clusters** — reuses channel/chat machinery.
5. **growth** — the stage-transition engine + certificate verification queue.
6. **events**, **media/sermons**, **audio** (Agora tokens), **notifications** (FCM + BullMQ fan-out), **admin/analytics**.

---

## 9. Security & safety (hard rules)

- **Secrets:** `.env` is gitignored, always. Never print, log, or echo a secret. If one appears in a paste/screenshot/diff, flag it and tell the user to rotate it. Generate JWT secrets with `openssl rand -hex 32` (≥32 chars; env validation rejects shorter).
- **Never put Claude/AI to enter credentials, payment, or auth on the user's behalf** — direct the user to do it.
- **OTP:** 6-digit, cryptographically random, store only a hash, ~10-min TTL, single-use, attempt cap (~5), Redis rate-limits on request (resend cooldown, per-email daily cap, per-IP cap).
- **Tokens:** short-lived access (15m), rotating refresh (30d), store only hashes of refresh tokens; support revocation.
- **Standard hardening:** `helmet`, CORS all-list (not `*` in prod), body size limits, input validation on every endpoint, no secrets in URLs/query strings.

### 9.1 Safeguarding (minors are real users — non-negotiable)

The app has a Teenagers cluster and minors in chat/DMs. Treat child safety as a hard requirement, not a feature:
- **Moderation + reporting** are core, not optional: every message/post/profile must be reportable; reports surface to branch admins/moderators with visibility and takedown tools.
- **Admin visibility over isolation:** be cautious with any feature that could isolate a minor with an adult (e.g. unrestricted adult↔minor DMs). When designing DMs, audio rooms, or invitations, flag safeguarding implications and prefer designs that keep trusted adults/admins in the loop.
- **Age-appropriate by default.** Don't build features that could sexualise, groom, or single out minors. If a request trends that way, raise it.
- Default new content/visibility to the **more private / more moderated** option.

---

## 10. Deferred / debt log (explicit, not forgotten)

- **Apple Sign-In** — needs a paid Apple Developer account; required by App Store rules *if* iOS ships other social logins, so it's a launch-blocker for the iOS app, not for backend dev now.
- **Phone-number sign-up (OTP via SMS)** — PRD §1 lists phone as a sign-up method, but the stack has no SMS provider. Deferred 2026-06-27: shipping email OTP + Google first; `User.phoneNumber` kept as profile data. Add a provider (Termii for Nigeria, or Twilio) + a phone-OTP slice as a fast-follow.
- **Region/Country layer** — when 3+ countries exist, consider a `Region` model grouping branches (for regional announcements + admin scoping). Not now.
- **`db.ts` singleton** must use the Prisma 7 `PrismaPg` adapter pattern (the original scaffold used the old bare-client form).
- **PgBouncer** — add pooled `DATABASE_URL` (transaction mode) + direct `DIRECT_URL` before scaling to multiple instances.
- **Dev vs prod databases** — separate Render databases before launch; never point dev and prod at the same one.
- **Brevo domain authentication** — OTP emails land in spam because mail sends from Brevo's shared `*.brevosend.com` subdomain, not `davidicgenerationchurch.com` (domain not authenticated). Add SPF/DKIM/DMARC + the Brevo verification record in DNS, verify in the Brevo dashboard. Launch-blocker for reliable auth email.

---

## 11. Definition of done (per slice)

A module isn't done until: endpoints implemented with thin controllers/fat services • every input zod-validated • errors use the standard envelope • scoped RBAC enforced where relevant • slow/fan-out work on BullMQ • OpenAPI (and Socket events, if any) documented • the happy path actually run and verified, not assumed.
