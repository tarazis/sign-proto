# Architecture Decisions

> Note: Not using metered/twilio for now unless needed.

---

## 1. Vite + React over Next.js

**Date:** 2026-04-27
**Decision:** Use Vite + React (SPA) rather than Next.js for the frontend.
**Rationale:** SignBridge is a real-time peer-to-peer video app. It has no server-rendered pages, no SEO requirements, and no API routes — all communication goes through Socket.IO and WebRTC. Next.js adds SSR/SSG complexity with no benefit here. Vite gives faster dev iteration and a simpler mental model for a pure client-side app.

---

## 2. Render over Vercel for the backend

**Date:** 2026-04-27
**Decision:** Deploy the Express/Socket.IO server to Render, not Vercel.
**Rationale:** Vercel Functions are stateless and short-lived; they do not support persistent WebSocket connections. Socket.IO requires a long-lived server process. Render's Web Service tier supports WebSockets natively and keeps the process running continuously, which is required for real-time signaling and (later) WebRTC coordination.

---

## 4. Deployment configuration

**Date:** 2026-04-27
**Decision:** Deployed frontend to Vercel and backend to Render. Confirmed end-to-end Socket.IO connection across production hosts.

Environment variables:
- Render: `CLIENT_URL` = Vercel production URL (CORS allowlist)
- Vercel: `VITE_SERVER_URL` = Render service URL

Notes:
- Render free tier sleeps after 15 min idle; first request after sleep takes 30-60s. Acceptable for prototype, would upgrade for production.
- TypeScript build runs at deploy time on Render (`tsc` → `dist/`), not committed to repo.
- Used `npm ci` (not `npm install`) on both sides for reproducible builds from `package-lock.json`.

---

## 5. Client-side routing: react-router-dom

**Date:** 2026-04-29
**Decision:** Use `react-router-dom` v6 for client-side routing.
**Rationale:** The app needs URL-addressable rooms (`/room/:roomId`) so users can share links. React Router is the standard choice for Vite + React SPAs and integrates cleanly with the existing stack. No server-side rendering is involved, so the router just maps URL patterns to components. Alternatives (TanStack Router, Wouter) offer no meaningful advantage at this scale.

---

## 6. Room ID generation: `crypto.randomUUID()`

**Date:** 2026-04-29
**Decision:** Use the browser's built-in `crypto.randomUUID()` to generate room IDs on the client.
**Rationale:** UUID v4 from the Web Crypto API is available in all modern browsers with no install. It produces 122 bits of randomness — collision probability is negligible for a prototype with tiny concurrent usage. Considered `nanoid` (shorter IDs, prettier URLs) but chose the zero-dependency path since URL aesthetics are not a concern yet. The server never generates room IDs; it only accepts them from clients, which is fine for a prototype without auth.

---

## 7. Room capacity: max 2 users

**Date:** 2026-04-29
**Decision:** Rooms are hard-capped at 2 participants. A third join attempt is rejected with a `room-full` event.
**Rationale:** SignBridge is explicitly a 1-on-1 video call tool. WebRTC peer connections are modeled as exactly two endpoints. Allowing more than 2 would require a mesh or SFU architecture — neither of which is in scope. The cap is enforced server-side so it cannot be bypassed by the client.

---

## 8. In-memory room state instead of Redis

**Date:** 2026-04-29
**Decision:** Track active rooms in a `Map<roomId, Set<socketId>>` in the server process. No external store.
**Rationale:** This is a prototype running on a single Render instance. In-memory state is sufficient: it's fast, zero-config, and has no additional cost or operational complexity. The tradeoff is that state is lost on server restart and multi-instance scaling is not possible — both are acceptable at prototype scope. The right migration path when we need durability or horizontal scale is Redis with Socket.IO's Redis adapter, but that's premature here.

---

## 3. Monorepo structure

**Date:** 2026-04-27
**Decision:** Keep `client/` and `server/` as sibling directories in a single repo rather than separate repos or a turborepo setup.
**Rationale:** The project is small (two packages, one developer). A simple monorepo avoids cross-repo PR coordination while keeping deployment configs and shared decisions in one place. We can add a workspace manager (turborepo, nx) later if build complexity grows, but adding that overhead now would be premature.
