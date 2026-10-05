// SQLite persistence layer (better-sqlite3). All SQL lives here so the rest of the app
// never touches SQL directly - swapping to PostgreSQL later only means re-implementing this class.
const fs = require("fs");
const path = require("path");
const BetterSqlite = require("better-sqlite3");

class Database {
  constructor(filePath) {
    if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new BetterSqlite(filePath);
    this.db.pragma("journal_mode = WAL"); // concurrent readers + fast writes
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this._migrate();
    this._prepare();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        code             TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        host_id          INTEGER NOT NULL REFERENCES users(id),
        video_id         TEXT NOT NULL,
        play_state       TEXT NOT NULL DEFAULT 'paused',
        current_time     REAL NOT NULL DEFAULT 0,
        state_updated_at INTEGER NOT NULL,
        created_at       INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_members (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id),
        role      TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (room_code, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_members_user ON room_members(user_id);
      CREATE TABLE IF NOT EXISTS room_bans (
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL,
        PRIMARY KEY (room_code, user_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL,
        username   TEXT NOT NULL,
        text       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_code, id);
    `);
  }

  _prepare() {
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      insertUser: p("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"),
      userByName: p("SELECT * FROM users WHERE username = ?"),
      userById: p("SELECT id, username, created_at FROM users WHERE id = ?"),

      insertRoom: p(
        `INSERT INTO rooms (code, name, host_id, video_id, play_state, current_time, state_updated_at, created_at)
         VALUES (?, ?, ?, ?, 'paused', 0, ?, ?)`
      ),
      roomByCode: p("SELECT * FROM rooms WHERE code = ?"),
      updateState: p(
        "UPDATE rooms SET video_id = ?, play_state = ?, current_time = ?, state_updated_at = ? WHERE code = ?"
      ),
      updateHost: p("UPDATE rooms SET host_id = ? WHERE code = ?"),

      upsertMember: p(
        `INSERT INTO room_members (room_code, user_id, role, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(room_code, user_id) DO UPDATE SET role = excluded.role`
      ),
      insertMemberIfMissing: p(
        "INSERT OR IGNORE INTO room_members (room_code, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      ),
      membersOfRoom: p(
        `SELECT m.user_id AS userId, u.username, m.role FROM room_members m
         JOIN users u ON u.id = m.user_id WHERE m.room_code = ?`
      ),
      deleteMember: p("DELETE FROM room_members WHERE room_code = ? AND user_id = ?"),
      roomsOfUser: p(
        `SELECT r.code, r.name, r.host_id AS hostId, m.role, r.created_at AS createdAt
         FROM room_members m JOIN rooms r ON r.code = m.room_code
         WHERE m.user_id = ? ORDER BY r.created_at DESC LIMIT 20`
      ),

      insertBan: p("INSERT OR IGNORE INTO room_bans (room_code, user_id) VALUES (?, ?)"),
      bansOfRoom: p("SELECT user_id AS userId FROM room_bans WHERE room_code = ?"),

      insertMessage: p(
        "INSERT INTO messages (room_code, user_id, username, text, created_at) VALUES (?, ?, ?, ?, ?)"
      ),
      recentMessages: p(
        `SELECT id, user_id AS userId, username, text, created_at AS createdAt FROM messages
         WHERE room_code = ? ORDER BY id DESC LIMIT ?`
      ),
      countUsers: p("SELECT COUNT(*) AS n FROM users"),
      countRooms: p("SELECT COUNT(*) AS n FROM rooms"),
    };
    this.transaction = (fn) => this.db.transaction(fn);
  }

  // ---- users
  createUser(username, passwordHash) {
    const info = this.q.insertUser.run(username, passwordHash, Date.now());
    return { id: Number(info.lastInsertRowid), username };
  }
  findUserByName(username) { return this.q.userByName.get(username); }
  findUserById(id) { return this.q.userById.get(id); }

  // ---- rooms
  createRoom({ code, name, hostId, videoId }) {
    const now = Date.now();
    this.db.transaction(() => {
      this.q.insertRoom.run(code, name, hostId, videoId, now, now);
      this.q.upsertMember.run(code, hostId, "Host", now);
    })();
  }
  getRoom(code) { return this.q.roomByCode.get(code); }
  roomExists(code) { return !!this.q.roomByCode.get(code); }
  saveRoomState(code, { videoId, playState, currentTime, updatedAt }) {
    this.q.updateState.run(videoId, playState, currentTime, updatedAt, code);
  }
  getMembers(code) { return this.q.membersOfRoom.all(code); }
  setMemberRole(code, userId, role) { this.q.upsertMember.run(code, userId, role, Date.now()); }
  addMemberIfMissing(code, userId, role) { this.q.insertMemberIfMissing.run(code, userId, role, Date.now()); }
  removeMember(code, userId) { this.q.deleteMember.run(code, userId); }
  setHost(code, newHostId, oldHostId) {
    this.db.transaction(() => {
      this.q.updateHost.run(newHostId, code);
      this.q.upsertMember.run(code, newHostId, "Host", Date.now());
      this.q.upsertMember.run(code, oldHostId, "Moderator", Date.now());
    })();
  }
  getRoomsOfUser(userId) { return this.q.roomsOfUser.all(userId); }
  banUser(code, userId) { this.q.insertBan.run(code, userId); }
  getBans(code) { return this.q.bansOfRoom.all(code).map((r) => r.userId); }

  // ---- chat
  saveMessage(code, userId, username, text) {
    const createdAt = Date.now();
    const info = this.q.insertMessage.run(code, userId, username, text, createdAt);
    return { id: Number(info.lastInsertRowid), userId, username, text, createdAt };
  }
  getRecentMessages(code, limit) { return this.q.recentMessages.all(code, limit).reverse(); }

  stats() {
    return { users: this.q.countUsers.get().n, rooms: this.q.countRooms.get().n };
  }
  close() { this.db.close(); }
}

module.exports = Database;
