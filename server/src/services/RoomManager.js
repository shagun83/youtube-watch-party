const crypto = require("crypto");
const Room = require("../models/Room");
const config = require("../config");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid typos
const DEFAULT_VIDEO = "dQw4w9WgXcQ";

// Owns all live Room objects. Rooms are loaded lazily from the DB and evicted from memory
// when idle, so memory use scales with *active* rooms, not with rooms ever created.
class RoomManager {
  constructor(database) {
    this.db = database;
    this.rooms = new Map();
    this.dirty = new Set(); // rooms whose playback state must be flushed to the DB
    this._flushTimer = setInterval(() => this.flush(), 2000);
    this._evictTimer = setInterval(() => this.evictIdle(), 60 * 1000);
    this._flushTimer.unref();
    this._evictTimer.unref();
  }

  _generateCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = crypto.randomBytes(6);
      let code = "";
      for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (!this.db.roomExists(code)) return code;
    }
    throw new Error("Could not generate a unique room code");
  }

  create(user, name) {
    const code = this._generateCode();
    const roomName = (String(name || "").trim() || `${user.username}'s room`).slice(0, 40);
    this.db.createRoom({ code, name: roomName, hostId: user.id, videoId: DEFAULT_VIDEO });
    return this.get(code);
  }

  // Returns the live Room (loading it from the DB if needed) or null.
  get(code) {
    code = String(code || "").trim().toUpperCase();
    let room = this.rooms.get(code);
    if (room) return room;
    const row = this.db.getRoom(code);
    if (!row) return null;
    room = new Room(row, this.db.getMembers(code), this.db.getBans(code));
    this.rooms.set(code, room);
    return room;
  }

  markDirty(room) { this.dirty.add(room.code); }

  flush() {
    for (const code of this.dirty) {
      const room = this.rooms.get(code);
      if (room) this.db.saveRoomState(code, room.persistable());
    }
    this.dirty.clear();
  }

  evictIdle() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.onlineCount === 0 && now - room.lastActive > config.ROOM_EVICT_MS) {
        this.db.saveRoomState(code, room.persistable());
        this.rooms.delete(code);
        this.dirty.delete(code);
      }
    }
  }

  playingRooms() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.playState === "playing" && room.onlineCount > 0) out.push(room);
    }
    return out;
  }

  stats() {
    let online = 0;
    for (const r of this.rooms.values()) online += r.onlineCount;
    return { activeRooms: this.rooms.size, onlineParticipants: online };
  }

  shutdown() {
    clearInterval(this._flushTimer);
    clearInterval(this._evictTimer);
    for (const [code, room] of this.rooms) this.db.saveRoomState(code, room.persistable());
  }
}

module.exports = RoomManager;
