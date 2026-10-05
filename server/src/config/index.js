// Central place for all environment-driven configuration.
const fs = require("fs");
const path = require("path");

// Minimal .env loader (platforms like Render/Railway inject env vars directly)
try {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      if (line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch (_) {}

const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

module.exports = {
  PORT: num(process.env.PORT, 5000),
  JWT_SECRET: process.env.JWT_SECRET || "dev-secret-change-me",
  JWT_EXPIRES_IN: "7d",
  CLIENT_URLS: (process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  DATABASE_PATH:
    process.env.DATABASE_PATH || path.join(__dirname, "..", "..", "data", "watchparty.db"),
  MAX_ROOM_SIZE: num(process.env.MAX_ROOM_SIZE, 100),
  REDIS_URL: process.env.REDIS_URL || "",
  BCRYPT_ROUNDS: num(process.env.BCRYPT_ROUNDS, 10),
  // How long an empty room stays cached in memory before eviction (state stays in the DB)
  ROOM_EVICT_MS: num(process.env.ROOM_EVICT_MS, 5 * 60 * 1000),
  // Server -> clients drift-correction tick for playing rooms
  SYNC_TICK_MS: num(process.env.SYNC_TICK_MS, 5000),
  CHAT_HISTORY: 100,
  CLIENT_DIST: path.join(__dirname, "..", "..", "..", "client", "dist"),
};
