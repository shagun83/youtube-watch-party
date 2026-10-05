// End-to-end test: boots the real server on a random port with a temp SQLite file and drives it
// with real Socket.IO clients. Run with: npm test
const os = require("os");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { io: connect } = require("socket.io-client");
const { createServer } = require("../src/index");

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wp-")), "test.db");
let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

const once = (sock, event, ms = 2000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for "${event}"`)), ms);
    sock.once(event, (d) => { clearTimeout(t); res(d); });
  });
const silent = (sock, event, ms = 300) =>
  new Promise((res, rej) => {
    const h = () => rej(new Error(`unexpected "${event}"`));
    sock.once(event, h);
    setTimeout(() => { sock.off(event, h); res(); }, ms);
  });

async function api(base, method, url, body, token) {
  const r = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

(async () => {
  let srv = await createServer({ port: 0, dbPath });
  let base = `http://localhost:${srv.port}`;
  const clients = [];
  const sock = (token) => {
    const s = connect(base, { auth: { token }, transports: ["websocket"], forceNew: true });
    clients.push(s);
    return s;
  };

  console.log("Auth & REST");
  const users = {};
  for (const n of ["host", "mod", "part", "viewer", "outsider"]) {
    const r = await api(base, "POST", "/api/auth/register", { username: n, password: "secret123" });
    assert.equal(r.status, 200); users[n] = r.data;
  }
  ok("register 5 users");
  assert.equal((await api(base, "POST", "/api/auth/register", { username: "HOST", password: "secret123" })).status, 409);
  assert.equal((await api(base, "POST", "/api/auth/login", { username: "host", password: "bad" })).status, 401);
  ok("duplicate username + wrong password rejected");
  assert.equal((await api(base, "POST", "/api/rooms", {})).status, 401);
  ok("room creation requires login");
  const bad = connect(base, { auth: { token: "nope" }, transports: ["websocket"], forceNew: true });
  await once(bad, "connect_error"); bad.close();
  ok("WebSocket without valid token is refused");

  const created = await api(base, "POST", "/api/rooms", { name: "Movie night" }, users.host.token);
  const code = created.data.room.code;
  assert.equal(code.length, 6);
  assert.equal((await api(base, "GET", `/api/rooms/${code}`, null, users.part.token)).data.room.name, "Movie night");
  assert.equal((await api(base, "GET", `/api/rooms/ZZZZZZ`, null, users.part.token)).status, 404);
  ok("create room + lookup by code");

  console.log("Joining & roles");
  const H = sock(users.host.token), M = sock(users.mod.token), P = sock(users.part.token), V = sock(users.viewer.token);
  H.emit("join_room", { roomId: code });
  const hj = await once(H, "room_joined");
  assert.equal(hj.you.role, "Host");
  ok("creator joins as Host");
  P.emit("join_room", { roomId: code });
  const [pj, hUserJoined] = await Promise.all([once(P, "room_joined"), once(H, "user_joined")]);
  assert.equal(pj.you.role, "Participant");
  assert.equal(hUserJoined.username, "part");
  assert.equal(hUserJoined.participants.length, 2);
  assert.ok(pj.participants.some((p) => p.role === "Host"), "participant list includes the host");
  ok("joiner defaults to Participant, others get user_joined with participant list");
  M.emit("join_room", { roomId: code }); await once(M, "room_joined");
  V.emit("join_room", { roomId: code }); await once(V, "room_joined");

  // Host assigns roles
  H.emit("assign_role", { userId: users.mod.user.id, role: "Moderator" });
  const ra = await once(P, "role_assigned");
  assert.equal(ra.role, "Moderator");
  assert.equal(ra.participants.find((p) => p.username === "mod").role, "Moderator");
  H.emit("assign_role", { userId: users.viewer.user.id, role: "Viewer" });
  await once(P, "role_assigned");
  ok("Host assigns Moderator / Viewer, broadcast to everyone");

  P.emit("assign_role", { userId: users.viewer.user.id, role: "Moderator" });
  await once(P, "permission_denied");
  M.emit("assign_role", { userId: users.part.user.id, role: "Moderator" });
  await once(M, "permission_denied");
  ok("non-hosts cannot assign roles");

  console.log("Playback sync & enforcement");
  P.emit("play", {}); await once(P, "permission_denied");
  P.emit("change_video", { videoId: "9bZkp7q19f0" }); await once(P, "permission_denied");
  V.emit("seek", { time: 50 }); await once(V, "permission_denied");
  ok("Participant/Viewer cannot play, seek or change video");

  let waits = [H, M, P, V].map((s) => once(s, "sync_state"));
  H.emit("play", { time: 12 });
  let states = await Promise.all(waits);
  assert.ok(states.every((s) => s.playState === "playing" && Math.abs(s.currentTime - 12) < 1));
  ok("Host play -> everyone receives playing @ ~12s");

  waits = [H, P, V].map((s) => once(s, "sync_state"));
  M.emit("seek", { time: 100 });
  states = await Promise.all(waits);
  assert.ok(states.every((s) => s.action === "seek" && Math.abs(s.currentTime - 100) < 2));
  ok("Moderator seek -> everyone follows");

  waits = [H, P, V].map((s) => once(s, "sync_state"));
  M.emit("pause", { time: 101 });
  states = await Promise.all(waits);
  assert.ok(states.every((s) => s.playState === "paused" && s.currentTime === 101));
  ok("Moderator pause -> everyone paused @ 101s");

  waits = [H, M, P].map((s) => once(s, "sync_state"));
  H.emit("change_video", { videoId: "https://www.youtube.com/watch?v=9bZkp7q19f0&t=5s" });
  states = await Promise.all(waits);
  assert.ok(states.every((s) => s.videoId === "9bZkp7q19f0" && s.currentTime === 0 && s.playState === "paused"));
  ok("change_video accepts a pasted YouTube URL and syncs everyone");
  H.emit("change_video", { videoId: "not a video" }); await once(H, "error_message");
  ok("invalid video link rejected");

  console.log("Approval workflow");
  P.emit("request_action", { type: "seek", time: 33 });
  const created1 = await once(H, "request_created");
  assert.equal(created1.request.username, "part");
  waits = [H, P, V].map((s) => once(s, "sync_state"));
  const resolved = once(P, "request_resolved");
  M.emit("approve_request", { requestId: created1.request.id });
  states = await Promise.all(waits);
  assert.equal(states[0].currentTime, 33);
  assert.equal((await resolved).status, "approved");
  ok("Participant requests seek -> Moderator approves -> applied for all");

  P.emit("request_action", { type: "change_video", url: "https://youtu.be/dQw4w9WgXcQ" });
  const created2 = await once(H, "request_created");
  const rej = once(P, "request_resolved");
  H.emit("reject_request", { requestId: created2.request.id });
  assert.equal((await rej).status, "rejected");
  await silent(P, "sync_state");
  ok("rejected request changes nothing");

  P.emit("approve_request", { requestId: "whatever" }); await once(P, "permission_denied");
  V.emit("request_action", { type: "play" }); await once(V, "permission_denied");
  ok("participants can't approve; viewers can't request");

  console.log("Chat & reactions");
  const cm = once(H, "chat_message");
  P.emit("chat_message", { text: "hello everyone" });
  assert.equal((await cm).text, "hello everyone");
  const rx = once(V, "reaction");
  P.emit("reaction", { emoji: "🔥" });
  assert.equal((await rx).emoji, "🔥");
  ok("chat message + emoji reaction broadcast");

  console.log("Remove, transfer, leave");
  const lv = once(H, "user_left");
  V.emit("leave_room", { roomId: code });
  assert.equal((await lv).username, "viewer");
  ok("leave_room -> user_left broadcast");
  V.emit("join_room", { roomId: code }); await once(V, "room_joined");

  M.emit("remove_participant", { userId: users.part.user.id }); await once(M, "permission_denied");
  const pr = Promise.all([once(P, "participant_removed"), once(H, "participant_removed")]);
  H.emit("remove_participant", { userId: users.part.user.id });
  const [removedMsg] = await pr;
  assert.equal(removedMsg.username, "part");
  P.emit("play", {}); await once(P, "error_message");
  P.emit("join_room", { roomId: code });
  assert.equal((await once(P, "error_message")).code, "BANNED");
  ok("Host removes participant; they lose access and cannot rejoin");

  const ht = Promise.all([once(H, "host_transferred"), once(M, "host_transferred")]);
  H.emit("transfer_host", { userId: users.mod.user.id });
  const [t1] = await ht;
  assert.equal(t1.newHostId, users.mod.user.id);
  assert.equal(t1.participants.find((p) => p.username === "host").role, "Moderator");
  H.emit("remove_participant", { userId: users.viewer.user.id }); await once(H, "permission_denied");
  ok("transfer host: old host demoted, new host gains powers");

  console.log("Persistence");
  const finalState = new Promise((res) => M.on("sync_state", (s) => s.videoId === "jNQXAC9IVRw" && res(s)));
  M.emit("change_video", { videoId: "jNQXAC9IVRw" });
  await finalState;
  for (const c of clients) c.close();
  await srv.close();
  srv = await createServer({ port: 0, dbPath });
  base = `http://localhost:${srv.port}`;
  const M2 = sock(users.mod.token);
  M2.emit("join_room", { roomId: code });
  const again = await once(M2, "room_joined");
  assert.equal(again.you.role, "Host");
  assert.equal(again.state.videoId, "jNQXAC9IVRw");
  assert.ok(again.messages.some((m) => m.text === "hello everyone"));
  const mine = await api(base, "GET", "/api/rooms/mine", null, users.mod.token);
  assert.equal(mine.data.rooms[0].code, code);
  ok("after a full server restart the room, roles, video, chat history and host survive");
  const P2 = sock(users.part.token);
  P2.emit("join_room", { roomId: code });
  assert.equal((await once(P2, "error_message")).code, "BANNED");
  ok("ban list is persisted too");

  for (const c of clients) c.close();
  await srv.close();
  console.log(`\nAll ${passed} checks passed ✅`);
  process.exit(0);
})().catch((e) => { console.error("\n❌ FAILED:", e.message, "\n", e.stack); process.exit(1); });
