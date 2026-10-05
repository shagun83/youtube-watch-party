const crypto = require("crypto");
const Participant = require("./Participant");
const { ROLES } = require("./roles");

const MAX_PENDING_REQUESTS = 50;

// In-memory, authoritative state of one watch room. Pure logic: it never touches sockets
// or SQL itself, so it is easy to test. MessageHandler wires it to the network and the DB.
class Room {
  constructor(row, members = [], bans = []) {
    this.code = row.code;
    this.name = row.name;
    this.hostId = row.host_id;
    this.videoId = row.video_id;
    this.playState = row.play_state; // 'playing' | 'paused'
    this.baseTime = row.current_time; // video position (s) at `updatedAt`
    this.updatedAt = row.state_updated_at;
    this.version = 0;
    this.participants = new Map(); // userId -> Participant (members, online or not)
    this.bans = new Set(bans);
    this.requests = new Map(); // requestId -> pending change request
    this.lastActive = Date.now();

    // A room persisted as "playing" is loaded paused at its last saved position:
    // nobody was watching while it sat in the database.
    if (this.playState === "playing") this.playState = "paused";
    for (const m of members) {
      this.participants.set(m.userId, new Participant(m));
    }
  }

  // ---- playback state --------------------------------------------------------------
  currentTime(now = Date.now()) {
    if (this.playState !== "playing") return this.baseTime;
    return this.baseTime + Math.max(0, now - this.updatedAt) / 1000;
  }

  playbackSnapshot(action = "state", by = null) {
    const now = Date.now();
    return {
      videoId: this.videoId,
      playState: this.playState,
      currentTime: this.currentTime(now),
      serverTime: now,
      version: this.version,
      action,
      by,
    };
  }

  persistable() {
    return {
      videoId: this.videoId,
      playState: this.playState,
      currentTime: this.currentTime(),
      updatedAt: Date.now(),
    };
  }

  play(time) {
    if (Number.isFinite(time)) this.baseTime = Math.max(0, time);
    else this.baseTime = this.currentTime();
    this.playState = "playing";
    this.updatedAt = Date.now();
    this.version++;
  }
  pause(time) {
    this.baseTime = Number.isFinite(time) ? Math.max(0, time) : this.currentTime();
    this.playState = "paused";
    this.updatedAt = Date.now();
    this.version++;
  }
  seek(time) {
    this.baseTime = Math.max(0, time);
    this.updatedAt = Date.now();
    this.version++;
  }
  changeVideo(videoId) {
    this.videoId = videoId;
    this.baseTime = 0;
    this.playState = "paused";
    this.updatedAt = Date.now();
    this.version++;
  }

  // ---- participants ----------------------------------------------------------------
  get(userId) { return this.participants.get(userId); }
  isBanned(userId) { return this.bans.has(userId); }
  get onlineCount() {
    let n = 0;
    for (const p of this.participants.values()) if (p.online) n++;
    return n;
  }
  onlineParticipants() {
    const out = [];
    for (const p of this.participants.values()) if (p.online) out.push(p.toJSON());
    // Host first, then moderators, then everyone else alphabetically
    const rank = { Host: 0, Moderator: 1, Participant: 2, Viewer: 3 };
    return out.sort((a, b) => rank[a.role] - rank[b.role] || a.username.localeCompare(b.username));
  }

  addMember(userId, username, role = ROLES.PARTICIPANT) {
    let p = this.participants.get(userId);
    if (!p) {
      p = new Participant({ userId, username, role });
      this.participants.set(userId, p);
    }
    return p;
  }
  removeMember(userId) { this.participants.delete(userId); }
  ban(userId) { this.bans.add(userId); }

  setRole(userId, role) {
    const p = this.participants.get(userId);
    if (p) p.role = role;
    return p;
  }

  transferHost(newHostId) {
    const oldHost = this.participants.get(this.hostId);
    const newHost = this.participants.get(newHostId);
    if (!newHost) return null;
    if (oldHost) oldHost.role = ROLES.MODERATOR;
    newHost.role = ROLES.HOST;
    this.hostId = newHostId;
    return { oldHost, newHost };
  }

  // ---- approval workflow -------------------------------------------------------------
  addRequest(participant, type, payload) {
    if (this.requests.size >= MAX_PENDING_REQUESTS) return null;
    // One pending request per user per action type keeps the queue from being spammed
    for (const r of this.requests.values()) {
      if (r.userId === participant.userId && r.type === type) this.requests.delete(r.id);
    }
    const req = {
      id: crypto.randomBytes(5).toString("hex"),
      userId: participant.userId,
      username: participant.username,
      type, // play | pause | seek | change_video
      payload,
      createdAt: Date.now(),
    };
    this.requests.set(req.id, req);
    return req;
  }
  takeRequest(id) {
    const r = this.requests.get(id);
    if (r) this.requests.delete(id);
    return r;
  }
  dropRequestsOf(userId) {
    const dropped = [];
    for (const r of this.requests.values()) {
      if (r.userId === userId) {
        this.requests.delete(r.id);
        dropped.push(r.id);
      }
    }
    return dropped;
  }
  pendingRequests() { return Array.from(this.requests.values()); }

  touch() { this.lastActive = Date.now(); }
}

module.exports = Room;
