# SignBridge

Real-time WebRTC video chat with AI sign language captioning.

## Live Demo

- Frontend: https://signbridge.vercel.app
- Backend health check: https://signbridge-api.onrender.com/health

## Project structure

```
/
├── client/    # Vite + React + TypeScript + Tailwind
└── server/    # Express + Socket.IO + TypeScript
```

## Local development

### Prerequisites

- Node.js 18+
- npm

### Backend

```bash
cd server
npm install
npm run dev
# Listens on http://localhost:3001
```

### Frontend

```bash
cd client
npm install
npm run dev
# Opens at http://localhost:5173
```

### Environment variables

Both directories include a `.env.example`. Copy it to `.env` and adjust as needed:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

## Deployment

- **Frontend**: Vercel — connect the repo, set root directory to `client`, add `VITE_SERVER_URL` env var pointing to the Render backend URL.
- **Backend**: Render — connect the repo, set root directory to `server`, build command `npm install && npm run build`, start command `npm start`. Add `CLIENT_URL` env var pointing to the Vercel frontend URL.

WebSocket support is the primary reason we chose Render over Vercel for the backend (see [DECISIONS.md](./DECISIONS.md)).
