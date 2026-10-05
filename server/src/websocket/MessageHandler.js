const config = require("../config");
const { ROLES, ASSIGNABLE_ROLES } = require("../models/roles");
const { parseVideoId } = require("../utils/youtube");

const EMOJIS = new Set(["👍", "❤️", "😂", "😮", "👏", "🔥", "😢", "🎉"]);
const REQUEST_TYPES = new Set(["play", "pause", "seek", "change_video"]);
const MAX_TIME = 24 * 3600 * 10;

// One MessageHandler instance per connected socket. It translates network events into
// Room operations, and ALWAYS validates permissions on the server before mutating anything -
// the UI disabling a button is only cosmetic.
class MessageHandler {
  constructor(io, socket, { roomManager, db }) {
    this.io = io;
    this.socket = socket;
    this.rooms = roomManager;
    this.db = db;
    this.user = socket.data.user; // { id, username } from the verified JWT
    this.buckets = new Map();
  }

  register() {
    const s = this.socket;
    this.on("join_room", this.joinRoom);
    this.on("leave_room", this.leaveRoom);
    this.on("play", (p) => this.control("play", p));
    this.on("pause", (p) => this.control("pause", p));
    this.on("seek", (p) => this.control("seek", p));
    this.on("change_video", (p) => this.control("change_video", p));
    this.on("request_action", this.requestAction);
    this.on("approve_request", (p) => this.resolveRequest(p, true));
    this.on("reject_request", (p) => this.resolveRequest(p, false));
    this.on("assign_role", this.assignRole);
    this.on("remove_participant", this.removeParticipant);
    this.on("transfer_host", this.transferHost);
    this.on("chat_message", this.chat);
    this.on("reaction", this.reaction);
    this.on("request_sync", this.requestSync);
    s.on("time_sync", (ack) => typeof ack === "function" && ack(Date.now()));
    s.on("disconnect", () => this.detach());
  }

  // Wraps every handler: tolerates garbage payloads and never lets an exception kill the server
  on(event, fn) {
    this.socket.on(event, (payload) => {
      try {
        fn.call(this, payload && typeof payload === "object" ? payload : {});
      } catch (err) {
        console.error(`[ws] ${event} failed:`, err);
        this.socket.emit("error_message", { message: "Something went wrong" });
      }
    });
  }

  // ---- helpers -----------------------------------------------------------------------------
  deny(event, message) {
    this.socket.emit("permission_denied", { event, message });
  }
  fail(message, code) {
    this.socket.emit("error_message", { message, code });
  }
  // Simple sliding-window limiter per socket and bucket
  allow(key, max, windowMs) {
    const now = Date.now();
    const b = this.buckets.get(key) || { start: now, n: 0 };
    if (now - b.start > windowMs) { b.start = now; b.n = 0; }
    b.n++;
    this.buckets.set(key, b);
    return b.n <= max;
  }
  // Resolves the room + the caller's Participant, verifying this very socket is in the room
  context() {
    const code = this.socket.data.roomCode;
    const room = code && this.rooms.get(code);
    const me = room && room.get(this.user.id);
    if (!room || !me || !me.sockets.has(this.socket.id)) {
      this.fail("You are not in a room", "NOT_IN_ROOM");
      return null;
    }
    room.touch();
    return { room, me };
  }
  emitRoom(room, event, payload) {
    this.io.to(room.code).emit(event, payload);
  }

  // ---- join / leave ----------------------------------------------------------------------
  joinRoom({ roomId }) {
    const room = this.rooms.get(roomId);
    if (!room) return this.fail("Room not found", "ROOM_NOT_FOUND");
    if (room.isBanned(this.user.id)) return this.fail("You were removed from this room", "BANNED");

    if (this.socket.data.roomCode && this.socket.data.roomCode !== room.code) this.detach();

    let me = room.get(this.user.id);
    if (!(me && me.online) && room.onlineCount >= config.MAX_ROOM_SIZE) {
      return this.fail(`This room is full (${config.MAX_ROOM_SIZE} users)`, "ROOM_FULL");
    }
    if (!me) {
      me = room.addMember(this.user.id, this.user.username, ROLES.PARTICIPANT); // joiners default to Participant
      this.db.addMemberIfMissing(room.code, this.user.id, ROLES.PARTICIPANT);
    }
    const wasOnline = me.online;
    me.sockets.add(this.socket.id);
    this.socket.join(room.code);
    this.socket.join(`${room.code}#${this.user.id}`); // per-user channel (used for removal)
    this.socket.data.roomCode = room.code;
    room.touch();

    const participants = room.onlineParticipants();
    this.socket.emit("room_joined", {
      room: { code: room.code, name: room.name, hostId: room.hostId, capacity: config.MAX_ROOM_SIZE },
      you: { userId: me.userId, username: me.username, role: me.role },
      participants,
      state: room.playbackSnapshot("join"),
      requests: room.pendingRequests(),
      messages: this.db.getRecentMessages(room.code, config.CHAT_HISTORY),
    });
    this.socket.emit("sync_state", room.playbackSnapshot("join"));
    if (!wasOnline) {
      this.socket.to(room.code).emit("user_joined", {
        userId: me.userId, username: me.username, role: me.role, participants,
      });
    }
  }

  leaveRoom() {
    this.detach(true);
  }

  // Removes THIS socket from its room (explicit leave, room switch or disconnect)
  detach(explicit = false) {
    const code = this.socket.data.roomCode;
    if (!code) return;
    this.socket.data.roomCode = null;
    this.socket.leave(code);
    this.socket.leave(`${code}#${this.user.id}`);
    const room = this.rooms.rooms.get(code);
    const me = room && room.get(this.user.id);
    if (!me) return;
    me.sockets.delete(this.socket.id);
    room.touch();
    if (!me.online) {
      for (const id of room.dropRequestsOf(me.userId)) {
        this.emitRoom(room, "request_resolved", { requestId: id, status: "cancelled" });
      }
      this.emitRoom(room, "user_left", {
        userId: me.userId, username: me.username, participants: room.onlineParticipants(),
      });
    }
    if (explicit) this.socket.emit("left_room", { roomId: code });
  }

  requestSync() {
    const ctx = this.context();
    if (ctx) this.socket.emit("sync_state", ctx.room.playbackSnapshot("resync"));
  }

  // ---- playback (Host / Moderator only) -------------------------------------------------------
  control(type, payload) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    if (!me.can("control")) {
      return this.deny(type, "Only the Host or a Moderator can control playback. You can send a request instead.");
    }
    if (!this.allow("control", 20, 5000)) return this.fail("Slow down a little", "RATE_LIMIT");
    const err = this.applyAction(room, type, payload, me.username);
    if (err) this.fail(err);
  }

  // Shared by direct control and approved requests. Returns an error string or null.
  applyAction(room, type, payload, by) {
    const time = Number(payload?.time);
    const hasTime = payload?.time !== undefined && Number.isFinite(time) && time >= 0 && time < MAX_TIME;
    switch (type) {
      case "play": hasTime ? room.play(time) : room.play(); break;
      case "pause": hasTime ? room.pause(time) : room.pause(); break;
      case "seek":
        if (!hasTime) return "Invalid seek time";
        room.seek(time);
        break;
      case "change_video": {
        const id = parseVideoId(payload?.videoId ?? payload?.url);
        if (!id) return "That doesn't look like a valid YouTube link or video ID";
        room.changeVideo(id);
        break;
      }
      default: return "Unknown action";
    }
    this.rooms.markDirty(room);
    this.emitRoom(room, "sync_state", room.playbackSnapshot(type, by));
    return null;
  }

  // ---- approval workflow (Participants ask, Host/Moderator decide) ---------------------------------
  requestAction(payload) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    if (me.can("control")) return this.fail("You can do that directly - no approval needed");
    if (!me.can("request")) return this.deny("request_action", "Viewers can only watch. Ask the Host for the Participant role.");
    if (!this.allow("request", 6, 10000)) return this.fail("Too many requests, wait a moment", "RATE_LIMIT");

    const type = String(payload.type || "");
    if (!REQUEST_TYPES.has(type)) return this.fail("Unknown request type");
    const data = {};
    if (type === "seek") {
      const t = Number(payload.time);
      if (!Number.isFinite(t) || t < 0 || t > MAX_TIME) return this.fail("Invalid seek time");
      data.time = t;
    } else if (type === "change_video") {
      const id = parseVideoId(payload.videoId ?? payload.url);
      if (!id) return this.fail("That doesn't look like a valid YouTube link or video ID");
      data.videoId = id;
    }
    const req = room.addRequest(me, type, data);
    if (!req) return this.fail("Too many pending requests in this room");
    this.emitRoom(room, "request_created", { request: req });
  }

  resolveRequest(payload, approve) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    if (!me.can("approve")) return this.deny(approve ? "approve_request" : "reject_request", "Only the Host or a Moderator can review requests");
    const req = room.takeRequest(String(payload.requestId || ""));
    if (!req) return this.fail("That request was already handled");
    if (approve) {
      // play/pause use the live server position; seek/change_video use what was requested
      const err = this.applyAction(room, req.type, req.payload, req.username);
      if (err) return this.fail(err);
    }
    this.emitRoom(room, "request_resolved", {
      requestId: req.id,
      status: approve ? "approved" : "rejected",
      type: req.type,
      userId: req.userId,
      username: req.username,
      by: me.username,
    });
  }

  // ---- role management (Host only) ----------------------------------------------------------------
  assignRole({ userId, role }) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    if (!me.can("manageRoles")) return this.deny("assign_role", "Only the Host can assign roles");
    const target = room.get(Number(userId));
    if (!target) return this.fail("That user is not in this room");
    if (target.userId === room.hostId) return this.fail("The Host's role can't be changed. Use Transfer Host instead.");
    if (!ASSIGNABLE_ROLES.includes(role)) return this.fail("Invalid role");

    room.setRole(target.userId, role);
    this.db.setMemberRole(room.code, target.userId, role);
    if (!target.can("request") && !target.can("control")) {
      for (const id of room.dropRequestsOf(target.userId)) {
        this.emitRoom(room, "request_resolved", { requestId: id, status: "cancelled" });
      }
    }
    this.emitRoom(room, "role_assigned", {
      userId: target.userId, username: target.username, role, by: me.username,
      participants: room.onlineParticipants(),
    });
  }

  removeParticipant({ userId, ban = true }) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    if (!me.can("remove")) return this.deny("remove_participant", "Only the Host can remove participants");
    const target = room.get(Number(userId));
    if (!target) return this.fail("That user is not in this room");
    if (target.userId === me.userId) return this.fail("You can't remove yourself");

    for (const id of room.dropRequestsOf(target.userId)) {
      this.emitRoom(room, "request_resolved", { requestId: id, status: "cancelled" });
    }
    room.removeMember(target.userId);
    this.db.removeMember(room.code, target.userId);
    if (ban !== false) {
      room.ban(target.userId);
      this.db.banUser(room.code, target.userId);
    }
    // Tell everyone (the removed user included) first, then kick their sockets out of the channel
    this.emitRoom(room, "participant_removed", {
      userId: target.userId, username: target.username, by: me.username,
      participants: room.onlineParticipants(),
    });
    const personal = `${room.code}#${target.userId}`;
    this.io.in(personal).socketsLeave([room.code, personal]);
  }

  transferHost({ userId }) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    if (!me.can("transfer")) return this.deny("transfer_host", "Only the Host can transfer the Host role");
    const target = room.get(Number(userId));
    if (!target || target.userId === me.userId) return this.fail("Pick another participant");
    room.transferHost(target.userId);
    this.db.setHost(room.code, target.userId, me.userId);
    this.emitRoom(room, "host_transferred", {
      oldHostId: me.userId, newHostId: target.userId, newHostName: target.username,
      participants: room.onlineParticipants(),
    });
  }

  // ---- chat & reactions ---------------------------------------------------------------------------
  chat({ text }) {
    const ctx = this.context();
    if (!ctx) return;
    const { room, me } = ctx;
    const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!clean) return;
    if (!this.allow("chat", 5, 3000)) return this.fail("You're sending messages too fast", "RATE_LIMIT");
    const msg = this.db.saveMessage(room.code, me.userId, me.username, clean);
    this.emitRoom(room, "chat_message", msg);
  }

  reaction({ emoji }) {
    const ctx = this.context();
    if (!ctx) return;
    if (!EMOJIS.has(emoji)) return;
    if (!this.allow("reaction", 10, 3000)) return;
    const { room, me } = ctx;
    this.emitRoom(room, "reaction", {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId: me.userId, username: me.username, emoji,
    });
  }
}

module.exports = MessageHandler;
