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

## 3. Monorepo structure

**Date:** 2026-04-27
**Decision:** Keep `client/` and `server/` as sibling directories in a single repo rather than separate repos or a turborepo setup.
**Rationale:** The project is small (two packages, one developer). A simple monorepo avoids cross-repo PR coordination while keeping deployment configs and shared decisions in one place. We can add a workspace manager (turborepo, nx) later if build complexity grows, but adding that overhead now would be premature.
