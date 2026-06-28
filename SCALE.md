# SCALE.md — scaling DGC backend to the target load

> Target (CLAUDE.md §1): **~10k registered → ~1,000–3,000 peak concurrent connections.** Not 10k
> simultaneous. "Do not over-engineer for hyperscale." This checklist takes the current single-instance
> deployment to that target. The architecture already supports it — these are provisioning + a couple of
> query optimizations, **not** a redesign.

## Already scale-friendly (no work needed)
- Stateless REST + JWT (verified locally, no per-request DB hit) → horizontal scale by adding instances.
- Socket.io + `@socket.io/redis-adapter` already wired → cross-instance broadcast works.
- Slow/fan-out work on BullMQ (email; push/growth later) → off the request path.
- Read state = `ChannelMembership.lastReadAt` (one row per member/channel), not per-message receipts.
- Keyset pagination on messages (O(limit), not O(offset)).
- Signed Cloudinary uploads (media bytes never touch the server).

## Pre-scale checklist (do in this order before going past a few hundred concurrent)

1. **PgBouncer / pooled Postgres (the #1 crash risk).**
   - Provision a pooled connection (Render external pooler or PgBouncer in transaction mode).
   - `DATABASE_URL` → **pooled** URL (runtime); `DIRECT_URL` → **direct** URL (migrations only).
   - Transaction-mode pooling can't use prepared statements — append `?pgbouncer=true` (or set
     the pg adapter accordingly) so Prisma disables them.
   - Point `prisma.config.ts` migrations at `DIRECT_URL`; runtime client (`db.ts`) at `DATABASE_URL`.

2. **Multiple web instances.**
   - Bump the Render plan and run ≥2–3 instances. The Redis adapter handles socket fan-out across them.
   - Socket.io: force `transports: ['websocket']` on the client (or enable sticky sessions on Render) so
     the HTTP-polling handshake doesn't bounce between instances.

3. **Right-size Redis.**
   - Move off Upstash free (**~10k commands/day cap** — blows instantly under load). Use Upstash paid in
     the **same region as Render (Oregon/us-west)** or Render Key Value. Sockets + BullMQ + rate-limiter
     all hit Redis hard; watch command count + latency.

4. **Split workers into their own service.**
   - Add a worker entrypoint (`src/worker.ts` that only calls `startWorkers()`), deploy as a Render
     **Background Worker** pointed at the same Redis + DB. Remove `startWorkers()` from `server.ts` so web
     instances don't burn CPU on jobs.

5. **Query hotspots.**
   - [x] `GET /channels` unread counts + last message — batched into ~4 queries (was N+1). *(done)*
   - If channels get very large, denormalize unread via a counter only if profiling demands it (a naive
     per-member counter reintroduces N×M writes — avoid; the batched query is usually enough).

6. **Separate dev and prod databases** (§10) before real traffic — never share.

7. **Load test before launch.**
   - REST: k6 / Artillery to target p99 under load. Sockets: a connection swarm (e.g. artillery
     socketio engine) to ~3k concurrent. Find the real ceiling per instance; size instance count from it.

8. **Observability.**
   - Already have structured logs (pino). Add: request-duration + error-rate metrics, socket connection
     gauge, BullMQ queue depth, and error tracking (e.g. Sentry). You can't tune what you can't see.

## Cost note
This target is modest — a handful of small Render instances + a paid Redis + pooled Postgres. Don't
provision for 10k *concurrent* (a 3–10× harder bar) unless real numbers justify it.
