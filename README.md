# 🎬 YouTube Watch Party

Watch YouTube videos together in real time. Create a room, share the code or link, and everyone's player
stays in sync — play, pause, seek and video changes are broadcast over **WebSockets** and gated by
**role-based access control** enforced on the server.

> **Live demo:** https://youtube-watch-party-s7t0.onrender.com ← *replace after you deploy (steps below)*

---

| Requirement | Where / how |
|---|---|
| Real-time sync (play/pause, seek, video) | `sync_state` broadcast + 5 s drift-correction `sync_tick`, latency-compensated clock |
| Room model (create / join by link or code) | `POST /api/rooms`, `/room/:CODE` links, join box accepts a code *or* a pasted link |
| YouTube integration | YouTube IFrame Player API (`client/src/components/Player.jsx`) |
| WebSockets | Socket.IO (pure `websocket` transport), JWT-authenticated handshake |
| Roles: Host / Moderator / Participant / Viewer | `server/src/models/roles.js` permission matrix |
| Host assigns roles, removes users, transfers host | `assign_role`, `remove_participant`, `transfer_host` (Host only) |
| Server-side permission validation | `MessageHandler.control()` etc. reject with `permission_denied` |
| Role broadcasts update the UI | `role_assigned`, `host_transferred`, `participant_removed`, `user_joined`, `user_left` |
| Participants need approval for changes | `request_action` → Host/Mod `approve_request` / `reject_request` |
| Participant list with roles | People tab (live) |
| Paste a YouTube URL to change video | Parses watch / youtu.be / embed / shorts / live links |
| **Database** | SQLite (users, rooms, members+roles, bans, chat) — rooms survive restarts |
| Bonus: OOP WebSocket server | `Room`, `Participant`, `RoomManager`, `MessageHandler`, `SocketServer`, `Database`, `AuthService` |
| Bonus: Scalability 1 000+ users, 100+ rooms, 50+ per room | Load-tested: **5 000 users / 100 rooms / 50 per room** (see below) + Redis adapter |
| Bonus: Persistent rooms | Rooms, roles, current video/time and bans stored in SQLite; "Your rooms" list |
| Bonus: Authentication | Sign up / log in (bcrypt + JWT) required before any room or socket access |
| Bonus: Chat, reactions, transfer host | Persisted chat history, 8 floating emoji reactions, Make-host button |

## 🧱 Tech stack

* **Frontend:** React 18 + Vite, YouTube IFrame API, socket.io-client (plain CSS, no UI lib)
* **Backend:** Node.js, Express, Socket.IO
* **Database:** SQLite via `better-sqlite3` (WAL mode)
* **Auth:** bcryptjs + JSON Web Tokens
* **Optional scaling:** `@socket.io/redis-adapter` + Redis

## 🚀 Run locally

Requires **Node 18+**.

```bash
# 1. install everything
npm run install:all

# 2. configure the server (optional - sensible defaults exist)
cp server/.env.example server/.env

# 3. start backend (http://localhost:5000) and frontend (http://localhost:5173) in two terminals
npm run dev:server
npm run dev:client
```
Open http://localhost:5173, sign up, create a room, then open the invite link in a second browser
(or an incognito window) with a different account.

**Production-style single process** (what Render runs):
```bash
npm run build     # installs deps + builds the React app into client/dist
npm start         # Express serves the API, WebSocket server and the built client on :5000
```

## 🔧 Environment variables (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP + WebSocket port (set automatically on Render/Railway) |
| `JWT_SECRET` | dev value | **Set a long random string in production** |
| `DATABASE_PATH` | `server/data/watchparty.db` | SQLite file (use a persistent disk in prod) |
| `CLIENT_URL` | *(empty = allow all)* | Comma-separated allowed origins, only if frontend is hosted separately |
| `MAX_ROOM_SIZE` | `100` | Max simultaneous users per room |
| `REDIS_URL` | *(off)* | Enables the Socket.IO Redis adapter |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost |

Client (only if hosted separately): `VITE_SERVER_URL=https://your-backend.onrender.com` at build time.

## ☁️ Deploy on Render (free)

1. Push this folder to a GitHub repository.
2. Render dashboard → **New → Blueprint** → pick the repo (it reads `render.yaml`).
   *(Or New → Web Service manually: Build `npm run build`, Start `npm start`, Health check `/api/health`.)*
3. Render generates `JWT_SECRET` for you. Wait for the build, open the `*.onrender.com` URL.
4. Put that URL at the top of this README.

Notes & platform limits:
* One service hosts frontend + backend + WebSockets, so there is no CORS or cross-origin socket setup.
* **Free plan:** the service sleeps after ~15 min idle (first request wakes it up) and the SQLite file is
  wiped on redeploy/restart. For permanent data attach a Render Disk and set `DATABASE_PATH=/var/data/watchparty.db`
  (instructions in `render.yaml`) or switch `Database.js` to Postgres.
* Railway: use the included `Dockerfile` or the same build/start commands.

## 🧪 Tests

```bash
npm test                       # 24 end-to-end checks against the real server + real Socket.IO clients
npm run loadtest               # 1 000 users / 20 rooms (50 per room)
USERS=5000 ROOMS=100 npm run loadtest   # 5 000 users / 100 rooms (50 per room)
```
The e2e suite covers auth, role defaults, every permission rule, sync of play/pause/seek/change-video,
the approval workflow, remove + ban, transfer host, chat/reactions and persistence across a server restart.

**Measured load-test results** (single Node process, 1 CPU core shared with the load generator itself):

| Scenario | Result |
|---|---|
| 5 000 concurrent sockets, 100 rooms × 50 users | 5 000 / 5 000 joined, 0 failures, join p95 ≈ 380 ms |
| 100 hosts press Play at once | 4 900 / 4 900 viewers synced, p95 ≈ 290 ms |
| Chat storm (5 000 messages → 250 000 deliveries) | 100 % delivered in 6 s |
| Memory | ≈ 70 MB idle → ≈ 190 MB with 5 000 sockets |

## 📐 Architecture overview

```
 Browser (React)                         Node server (Express + Socket.IO)               SQLite
┌───────────────────┐   REST (HTTPS)    ┌──────────────────────────────────┐        ┌──────────┐
│ Auth / Home pages │ ───────────────▶  │ authRoutes / roomRoutes          │ ─────▶ │ users    │
│                   │  login, create    │  AuthService (bcrypt + JWT)      │        │ rooms    │
│ RoomPage          │                   │                                  │        │ members  │
│  ├ Player (YT API)│   WebSocket       │ SocketServer  (JWT handshake)    │        │ bans     │
│  ├ Chat / People  │ ◀═══════════════▶ │  └ MessageHandler (per socket)   │        │ messages │
│  └ Requests       │   events below    │      ├ validates role/permission │        └──────────┘
└───────────────────┘                   │      └ mutates ▶ Room (in memory)│  RoomManager flushes
                                        │ RoomManager: lazy-load / evict   │  state every 2 s
                                        └──────────────────────────────────┘
```

**Flow of a synced action** (e.g. Host presses pause):
1. Browser sends `pause {time}` over the socket.
2. `MessageHandler.control()` looks up the caller's role **on the server** (from the verified JWT user →
   `Participant` in the `Room`), checks `PERMISSIONS[role].control`. If not allowed → `permission_denied`.
3. `Room.pause()` updates the authoritative state `{videoId, playState, baseTime, updatedAt}`.
4. Server broadcasts `sync_state` to **everyone in the Socket.IO room** (including the sender).
5. Each client's `Player.apply()` computes the target time (`currentTime + estimated server-time elapsed`)
   and seeks/plays/pauses its local YouTube player. Clients never trust each other, only the server.

**Keeping players in sync:** the YouTube UI is covered by a transparent shield and replaced by custom
controls, so *every* action must go through the server. Each client measures its clock offset with a few
`time_sync` pings (min-RTT sample), so a "playing at 12.0 s" message that took 80 ms to arrive is applied as
12.08 s. Every 5 s a `sync_tick` lets clients correct drift > 1.5 s. Late joiners get the live position
(`baseTime + elapsed`), not a stale one.

### Roles & permissions (enforced in `server/src/models/roles.js` + `MessageHandler`)

| Action | Host | Moderator | Participant | Viewer |
|---|:-:|:-:|:-:|:-:|
| Play / pause / seek / change video | ✅ | ✅ | ❌ → *request* | ❌ |
| Send a request for approval | – | – | ✅ | ❌ |
| Approve / reject requests | ✅ | ✅ | ❌ | ❌ |
| Assign roles | ✅ | ❌ | ❌ | ❌ |
| Remove (ban) participants | ✅ | ❌ | ❌ | ❌ |
| Transfer host | ✅ | ❌ | ❌ | ❌ |
| Chat & react | ✅ | ✅ | ✅ | ✅ |

The creator is Host automatically; joiners default to Participant. Transferring host demotes the old host
to Moderator. A removed user is banned (stored in DB) and cannot rejoin.

### WebSocket events

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `join_room` | C → S | `{roomId}` | username/userId come from the JWT, never from the client |
| `leave_room` | C → S | `{roomId}` | |
| `room_joined` | S → C | room, you, participants, state, requests, chat history | initial snapshot |
| `sync_state` | S → C | `{videoId, playState, currentTime, serverTime, action, by}` | after every change |
| `sync_tick` | S → C | same | every 5 s while playing |
| `play` `pause` `seek` `change_video` | C → S | `{time}` / `{time}` / `{time}` / `{videoId \| url}` | Host/Moderator only |
| `request_action` | C → S | `{type, time?, videoId?}` | Participant asks for a change |
| `approve_request` `reject_request` | C → S | `{requestId}` | Host/Moderator only |
| `request_created` `request_resolved` | S → C | request / `{status, by}` | |
| `assign_role` | C → S | `{userId, role}` | Host only |
| `role_assigned` | S → C | `{userId, username, role, participants}` | |
| `remove_participant` | C → S | `{userId}` | Host only |
| `participant_removed` | S → C | `{userId, username, participants}` | sent to everybody incl. the removed user |
| `transfer_host` / `host_transferred` | C → S / S → C | `{userId}` / `{oldHostId,newHostId,participants}` | Host only |
| `user_joined` `user_left` | S → C | `{username, userId, role?, participants}` | |
| `chat_message` | both | `{text}` / `{id, userId, username, text, createdAt}` | persisted, rate-limited |
| `reaction` | both | `{emoji}` / `{userId, username, emoji}` | whitelist of 8 emoji |
| `permission_denied` `error_message` | S → C | `{message}` | |

### Database schema (SQLite)

`users(id, username, password_hash)` · `rooms(code, name, host_id, video_id, play_state, current_time, state_updated_at)` ·
`room_members(room_code, user_id, role)` · `room_bans(room_code, user_id)` · `messages(room_code, user_id, username, text, created_at)`

### Scalability notes

* **What is done:** WebSocket-only transport, per-room Socket.IO channels (no global iteration), rooms lazily
  loaded and evicted from memory after 5 idle minutes, throttled DB writes (playback state flushed every 2 s),
  per-socket rate limits, no per-message compression, WAL-mode SQLite. One Node process comfortably held 5 000 sockets.
* **Scaling past one process:** set `REDIS_URL` to enable `@socket.io/redis-adapter` so broadcasts reach sockets
  on every instance. Because each room's authoritative state lives in the memory of one instance, put a load
  balancer in front that routes by room (the client sends `?room=CODE` in the handshake — hash on it) or move
  the room state into Redis; use PostgreSQL instead of SQLite when several instances share data.

## 📁 Project structure

```
server/src
  index.js                 bootstrap (createServer) – also used by tests
  config/                  env configuration
  db/Database.js           all SQL (SQLite)
  models/                  Room, Participant, roles (permission matrix)
  services/                RoomManager (live rooms), AuthService
  websocket/               SocketServer (io setup, ticker, Redis), MessageHandler (event logic)
  routes/ middleware/      REST API + JWT middleware
  utils/youtube.js         URL → video-id parser
server/scripts             e2e-test.js, loadtest.js
client/src
  pages/                   AuthPage, HomePage, RoomPage
  components/              Player, Chat, ParticipantList, RequestsPanel
  hooks/useRoom.js         all socket logic → React state
```

## 🎤 Viva cheat-sheet (what to say when asked)

* **Why Socket.IO?** Rooms/namespaces, auto-reconnect, acks and a Redis adapter out of the box; I force the pure
  WebSocket transport so no sticky sessions are needed.
* **How does sync work?** The server owns the state; clients only send *intents*. The server validates the role,
  updates state and broadcasts; clients apply it with latency compensation + periodic drift correction.
* **Where are roles enforced?** Only on the server (`MessageHandler`). The role comes from the JWT-verified user
  looked up in the `Room`, never from the payload. Disabled buttons in the UI are cosmetic.
* **Why authentication?** Identity by username alone lets anyone impersonate the Host; JWT in the socket
  handshake fixes that.
* **Trade-offs:** in-memory room state is fast but ties a room to one instance (solved by routing by room);
  SQLite is simple but single-node; the YouTube iframe can't be controlled by the browser without user
  interaction, hence the "Join the watch party" click that also satisfies browser autoplay rules.
* **Deployment choices:** single Render web service (API + WS + static client), `JWT_SECRET` generated by Render,
  `PORT` injected by the platform, health check at `/api/health`, free-tier sleep/ephemeral-disk caveats above.

## ⚠️ Known limitations

* Videos whose owners disabled embedding can't be played in any iframe (an error banner is shown).
* Free hosting sleeps when idle and may wipe SQLite (see deployment notes).
