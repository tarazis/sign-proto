# SignBridge

Real-time WebRTC video chat with AI-powered ASL sign language captioning.

[Live Demo](https://signbridge.vercel.app) · Demo Video (link to be added later)

## What it does

Two participants join a room and have a video call. As one signs in ASL, the
other sees real-time captions appear on the remote video. Hand detection
runs client-side via MediaPipe; sign-to-text inference runs server-side via
Google Gemini Live API.

## Architecture

```
Browser A (Signer)  <==== WebRTC video/audio ====>  Browser B (Viewer)
       |                                                    ^
       | JPEG frame samples (Socket.IO)                     |
       v                                                    | caption events (Socket.IO)
Server (Express + Socket.IO) ---- Gemini Live API ----------+
```

- **Frontend**: Vite + React + TypeScript + Tailwind on Vercel
- **Backend**: Node.js + Express + Socket.IO on Render
- **Real-time video**: WebRTC peer-to-peer with STUN/TURN (Metered)
- **Hand tracking**: MediaPipe Hand Landmarker (WebAssembly, client-side)
- **Sign recognition**: Google Gemini Live API (server-side streaming inference)

## Data flow

Three independent paths:
1. Video: peer-to-peer browser-to-browser via WebRTC (server uninvolved)
2. Frames: signer browser -> Socket.IO -> server -> Gemini Live
3. Captions: Gemini -> server -> Socket.IO -> receiver browser only

## Local development

Prerequisites:
- Node.js 18+
- npm

Install dependencies:

```bash
cd server && npm install
cd ../client && npm install
```

Set up environment variables:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Required variables:
- `server/.env`: `PORT`, `CLIENT_URL`, `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_DEBUG_TEXT_NUDGE_EVERY`
- `client/.env`: `VITE_SERVER_URL`

Run in two terminals:

Terminal 1 (server):

```bash
cd server
npm run dev
```

Terminal 2 (client):

```bash
cd client
npm run dev
```

App URLs:
- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:3001/health`

## Deployment

- **Frontend (Vercel)**: set root directory to `client`; set `VITE_SERVER_URL=https://signbridge-api.onrender.com`
- **Backend (Render)**: set root directory to `server`; build command `npm install && npm run build`; start command `npm start`
- **Backend env vars (Render)**: `PORT`, `CLIENT_URL=https://signbridge.vercel.app`, `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_DEBUG_TEXT_NUDGE_EVERY`

## v1 limitations

- **ASL only**. Architecture supports retraining for Ethiopian Sign Language
  or Arabic Sign Language with collected training data — that's v2 scope.
- **Sign recognition reliability**. Gemini Live wasn't trained as a sign
  language classifier, so recognition is inconsistent. A periodic text nudge
  ensures the captioning pipeline demonstrates end-to-end functionality.
  Production-grade recognition would require a custom-trained classifier.
- **Two-person rooms only**. No group calls in v1.
- **Render free tier sleeps after 15 min idle**; first request after sleep
  takes ~30s.

## Architecture decisions

See [DECISIONS.md](./DECISIONS.md) for the full record of architectural
choices made during the build, with rationale for each.

## Repo topics

Add these GitHub repository topics manually in the GitHub web UI:
`webrtc`, `react`, `typescript`, `socket-io`, `mediapipe`, `gemini`,
`accessibility`, `sign-language`, `nodejs`
