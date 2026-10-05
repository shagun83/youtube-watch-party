// Load test: spawns the real server as a separate process, then connects USERS real WebSocket
// clients spread over ROOMS rooms and measures join time + broadcast latency.
//   npm run loadtest                      -> 1000 users / 20 rooms (50 per room)
//   USERS=5000 ROOMS=100 npm run loadtest -> 5000 users / 100 rooms (50 per room)
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { io: connect } = require("socket.io-client");

const USERS = Number(process.env.USERS || 1000);
const ROOMS = Number(process.env.ROOMS || 20);
const PORT = Number(process.env.LT_PORT || 5055);
const SECRET = "loadtest-secret";
process.env.JWT_SECRET = SECRET;

const Database = require("../src/db/Database");
const { AuthService } = require("../src/services/AuthService");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const rss = (pid) => Math.round(Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024);

(async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wp-load-")), "load.db");
  const perRoom = Math.ceil(USERS / ROOMS);
  console.log(`Preparing ${USERS} users and ${ROOMS} rooms (~${perRoom} users per room)...`);

  // Seed users + rooms directly in the DB (bcrypt for 5000 users would just benchmark bcrypt)
  const db = new Database(dbPath);
  const auth = new AuthService(db);
  const users = [];
  db.db.transaction(() => {
    for (let i = 0; i < USERS; i++) users.push(db.createUser(`user${i}`, "x"));
  })();
  const rooms = [];
  for (let r = 0; r < ROOMS; r++) {
    const code = `LOAD${String(r).padStart(2, "0")}`;
    const host = users[r * perRoom];
    db.createRoom({ code, name: `Load room ${r}`, hostId: host.id, videoId: "dQw4w9WgXcQ" });
    rooms.push({ code, hostIdx: r * perRoom });
  }
  db.close();

  const server = spawn("node", [path.join(__dirname, "..", "src", "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, JWT_SECRET: SECRET, MAX_ROOM_SIZE: String(perRoom + 10) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await sleep(1500);
  const baseRss = rss(server.pid);

  const clients = [];
  const joinTimes = [];
  let failures = 0;
  const t0 = Date.now();
  const joinOne = (idx) =>
    new Promise((resolve) => {
      const room = rooms[Math.min(ROOMS - 1, Math.floor(idx / perRoom))];
      const s = connect(`http://localhost:${PORT}`, {
        auth: { token: auth.signToken(users[idx]) },
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      const start = Date.now();
      const timer = setTimeout(() => { failures++; resolve(null); }, 30000);
      s.on("connect", () => s.emit("join_room", { roomId: room.code }));
      s.on("room_joined", () => { clearTimeout(timer); joinTimes.push(Date.now() - start); resolve(s); });
      s.on("error_message", () => { clearTimeout(timer); failures++; resolve(null); });
      s.on("connect_error", () => { clearTimeout(timer); failures++; resolve(null); });
      s.roomCode = room.code;
      s.userIdx = idx;
      clients.push(s);
    });

  const BATCH = 100;
  for (let i = 0; i < USERS; i += BATCH) {
    await Promise.all(Array.from({ length: Math.min(BATCH, USERS - i) }, (_, k) => joinOne(i + k)));
  }
  const connectSecs = ((Date.now() - t0) / 1000).toFixed(1);
  const connected = clients.filter((c) => c.connected).length;
  console.log(`\nConnected & joined: ${connected}/${USERS} in ${connectSecs}s (failures: ${failures})`);
  console.log(`Join latency  p50=${pct(joinTimes, 0.5)}ms  p95=${pct(joinTimes, 0.95)}ms  max=${Math.max(...joinTimes)}ms`);
  console.log(`Server memory: ${baseRss}MB idle -> ${rss(server.pid)}MB with ${connected} sockets`);

  // Every room's host presses play at the same moment -> measure fan-out latency to every viewer
  const lat = [];
  let received = 0;
  const expected = connected - rooms.length; // everybody except the hosts
  for (const c of clients) {
    c.on("sync_state", (s) => {
      if (s.action === "play" && c.userIdx % perRoom !== 0) { received++; lat.push(Date.now() - c.sentAt); }
    });
  }
  const hostSockets = rooms.map((r) => clients.find((c) => c.userIdx === r.hostIdx && c.connected)).filter(Boolean);
  const sentAt = Date.now();
  clients.forEach((c) => (c.sentAt = sentAt));
  hostSockets.forEach((h) => h.emit("play", { time: 5 }));
  const waitUntil = Date.now() + 15000;
  while (received < expected && Date.now() < waitUntil) await sleep(50);
  console.log(`\n${hostSockets.length} hosts pressed PLAY simultaneously -> ${received}/${expected} viewers received the sync`);
  if (lat.length) console.log(`Fan-out latency p50=${pct(lat, 0.5)}ms  p95=${pct(lat, 0.95)}ms  max=${Math.max(...lat)}ms`);

  // Chat storm: every user sends one message, each room broadcasts to ~perRoom users
  let chats = 0;
  const chatStart = Date.now();
  for (const c of clients) c.on("chat_message", () => chats++);
  for (const c of clients) if (c.connected) c.emit("chat_message", { text: "hi" });
  const chatWait = Date.now() + 20000;
  const chatExpected = connected * perRoom;
  while (chats < chatExpected * 0.999 && Date.now() < chatWait) await sleep(100);
  console.log(`\nChat storm: ${connected} messages -> ${chats} deliveries (${Math.round((chats / chatExpected) * 100)}%) in ${((Date.now() - chatStart) / 1000).toFixed(1)}s`);
  console.log(`Server memory after load: ${rss(server.pid)}MB`);

  const ok = connected === USERS && received >= expected * 0.999;
  console.log(ok ? "\nLOAD TEST PASSED ✅" : "\nLOAD TEST FAILED ❌");
  clients.forEach((c) => c.close());
  server.kill("SIGTERM");
  await sleep(500);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
