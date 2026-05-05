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

## 9. Vercel SPA rewrites for client-side routing

**Date:** 2026-04-29
**Decision:** Added `client/vercel.json` with a catch-all rewrite rule mapping all paths to `index.html`.
**Rationale:** react-router-dom uses client-side routing with no server-rendered pages. Direct URL access to non-root paths like `/room/:id` would otherwise return 404 from Vercel's static file server — it looks for a file at that path, finds nothing, and 404s before the app even loads. The rewrite ensures `index.html` always loads first, then React Router reads the URL and renders the correct component. Static assets (`/assets/*`) still resolve correctly because Vercel checks real files before applying rewrites.

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

## 10. WebRTC via simple-peer with signal buffering

**Date:** 2026-04-30
**Decision:** Use `simple-peer` for WebRTC peer connections, with signals buffered until the peer is ready, and the browser bundle imported explicitly.
**Rationale:** `simple-peer` wraps the verbose RTCPeerConnection API into a clean event-based interface. Two issues surfaced during implementation: (1) signals arriving before the peer was initialized were dropped, causing connections to stall — fixed by buffering pending signals and flushing them once the peer is created; (2) the default `simple-peer` import resolves to the Node bundle in Vite, which fails in the browser — fixed by importing `simple-peer/simplepeer.min.js` directly. React StrictMode was also removed because it double-invokes effects, causing a second peer to be created and immediately destroyed, which broke the connection lifecycle.

---

## 11. CORS for Vercel preview deployments: regex env var

**Date:** 2026-04-30
**Decision:** Allow all Vercel preview origins via a `CORS_ORIGIN_PATTERN` regex env var rather than listing specific URLs.
**Rationale:** Vercel preview URLs change per branch (`sign-proto-git-<branch>-<user>.vercel.app`), so hardcoding individual origins would require a Render dashboard update on every new branch. A regex (`^https://sign-proto[^.]*\.vercel\.app$`) covers all current and future preview URLs in one setting. Comma-separated origins were considered but rejected — they have the same scaling problem. The `CLIENT_URL` env var is kept for exact-match production origin; `CORS_ORIGIN_PATTERN` is additive on top of it.

---

## 12. Hand tracking on the main thread, with canvas overlay separate from the WebRTC stream

**Date:** 2026-04-30
**Decision:** Run MediaPipe Hand Landmarker on the main thread via `requestAnimationFrame`. Draw landmarks on a `<canvas>` positioned absolutely over the local `<video>` element — never composited into the outgoing WebRTC stream. Expose a single hook `useHandTracking(videoRef) → { landmarks, handsDetected }`; no imperative frame-capture API.
**Rationale:** Three coupled choices:
(1) **Main thread, not worker.** A worker + `OffscreenCanvas` would isolate detection from React rendering, but it adds message-passing overhead, complicates lifecycle, and forces a `VideoFrame`/`ImageBitmap` transfer per tick. At one local 480p video on a modern laptop the main thread is comfortable, and `requestAnimationFrame` already pauses when the tab is hidden. Worker offload is an internal refactor we can do later without changing the hook's surface.
(2) **Overlay, not stream composition.** Burning landmarks into the local stream (via canvas → `captureStream`) would let the remote peer see them, but that's the opposite of what we want: landmarks are local feedback for the signer, the remote should see clean video. Keeping them on a separate canvas also avoids re-encoding a composited stream and the latency that adds.
(3) **One hook, no `sampleFrame`.** Phase 4 will sample frames for Gemini, but exposing a `sampleFrame` method now would conflate "detect hands" with "capture a still" and force the hook to own concerns it shouldn't. Phase 4's sampler will be a separate utility that reads from the same `videoRef` and gates on `handsDetected` — no coupling to this hook's internals.

---

## 3. Monorepo structure

**Date:** 2026-04-27
**Decision:** Keep `client/` and `server/` as sibling directories in a single repo rather than separate repos or a turborepo setup.
**Rationale:** The project is small (two packages, one developer). A simple monorepo avoids cross-repo PR coordination while keeping deployment configs and shared decisions in one place. We can add a workspace manager (turborepo, nx) later if build complexity grows, but adding that overhead now would be premature.

---

## 13. Hidden `<canvas>` over `OffscreenCanvas` for frame capture

**Date:** 2026-05-05
**Decision:** Sample frames in `useFrameSampler` via a hidden `HTMLCanvasElement` created with `document.createElement('canvas')` and never mounted. Use synchronous `canvas.toDataURL('image/jpeg', 0.7).split(',')[1]` to produce raw base64 for the server.
**Rationale:** OffscreenCanvas + a worker would isolate encoding from the main thread, but Safari/iOS support is uneven and the pattern requires `VideoFrame`/`ImageBitmap` transfers per tick. At 2 FPS over one local stream the synchronous path is comfortably cheap on the main thread — well under a frame budget. `toDataURL` over `Blob` + `FileReader` keeps the call site one-line and avoids an async hop per frame. Worker offload remains a drop-in refactor later without changing the hook's surface.

---

## 14. 500 ms hysteresis on hand-detection stop, tracked via ref not state

**Date:** 2026-05-05
**Decision:** When `handsDetected` flips false, wait 500 ms before halting frame sampling. Track the debounced "effective" state in a `useRef`, never in `useState`.
**Rationale:** MediaPipe drops `handsDetected` to false on transient lighting changes, partial occlusion, or motion blur — even mid-sign. Stopping the sampler immediately would create rapid start/stop churn and lose the frames that matter most. The hysteresis lives in a ref + `setTimeout` rather than React state because it's a gating signal for an interval, not something the UI renders. Lifting it to state would force a re-render on every flicker for no visual change.

---

## 15. Caption replace semantics with 4 s auto-clear, no history

**Date:** 2026-05-05
**Decision:** `useCaptions` exposes a single `current: string | null`. Each new caption replaces the previous text and resets a 4 s auto-clear timer; if no caption arrives within that window, the overlay clears.
**Rationale:** Captions are a real-time accessibility surface for live signing, not a transcript. Stacking them or scrolling a history would compete with the remote video for visual attention and keep stale text on screen long after the moment has passed. Replace-and-fade matches video-call CC conventions and keeps the overlay component dead simple — one string, one timer. A scrolling transcript is a deliberate v2 feature; server-side dedup means the client doesn't need to filter repeats.
