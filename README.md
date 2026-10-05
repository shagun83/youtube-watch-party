# 🎬 YouTube Watch Party

A real-time YouTube Watch Party application that allows multiple users to watch YouTube videos together in synchronized rooms.

The host can control playback, assign roles, manage participants, and approve playback requests. All playback actions are synchronized through WebSockets with server-side role-based permission enforcement.

## 🌐 Live Demo

https://youtube-watch-party-s7t0.onrender.com

---

## ✨ Features

- Create and join watch party rooms
- Join rooms using a room code or shareable link
- Real-time YouTube playback synchronization
- Play, pause, seek, and change videos together
- Server-authoritative playback state
- WebSocket communication using Socket.IO
- Role-based access control
- Host, Moderator, Participant, and Viewer roles
- Host can assign roles
- Host can remove participants
- Host can transfer ownership
- Participants can request playback changes
- Host/Moderator can approve or reject requests
- Real-time participant list
- Authentication using JWT
- Password hashing with bcrypt
- Persistent room and user data using SQLite
- Persistent chat history
- Emoji reactions
- Automatic playback drift correction
- Optional Redis adapter for horizontal WebSocket scaling

---

## 🏗️ Tech Stack

### Frontend

- React 18
- Vite
- Socket.IO Client
- YouTube IFrame Player API
- CSS

### Backend

- Node.js
- Express
- Socket.IO
- JWT
- bcryptjs

### Database

- SQLite
- better-sqlite3
- WAL mode

### Optional Scaling

- Redis
- `@socket.io/redis-adapter`

### Deployment

- Render
- Single web service for frontend, backend, and WebSockets

---

## 👥 Roles & Permissions

| Action | Host | Moderator | Participant | Viewer |
|---|:---:|:---:|:---:|:---:|
| Watch videos | ✅ | ✅ | ✅ | ✅ |
| Play / Pause | ✅ | ✅ | ❌ | ❌ |
| Seek | ✅ | ✅ | ❌ | ❌ |
| Change video | ✅ | ✅ | ❌ | ❌ |
| Request playback change | — | — | ✅ | ❌ |
| Approve / Reject requests | ✅ | ✅ | ❌ | ❌ |
| Assign roles | ✅ | ❌ | ❌ | ❌ |
| Remove participants | ✅ | ❌ | ❌ | ❌ |
| Transfer host | ✅ | ❌ | ❌ | ❌ |
| Chat | ✅ | ✅ | ✅ | ✅ |
| Reactions | ✅ | ✅ | ✅ | ✅ |

The room creator automatically becomes the Host.

New users joining a room are assigned the Participant role by default.

When the Host transfers ownership, the previous Host becomes a Moderator.

Removed participants are banned from rejoining that room.

---

## 🔄 Real-Time Synchronization

The server acts as the authoritative source of playback state.

For example, when the Host pauses a video:

```text
Host Browser
     │
     │ pause event
     ▼
Socket.IO Server
     │
     ├── Validate JWT
     ├── Check user's role
     ├── Update room state
     │
     ▼
Broadcast sync_state
     │
     ├──────────────┐
     ▼              ▼
Participant 1   Participant 2
     │              │
     ▼              ▼
YouTube Player  YouTube Player