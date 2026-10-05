const http = require("http");
const config = require("./config");
const Database = require("./db/Database");
const RoomManager = require("./services/RoomManager");
const { AuthService } = require("./services/AuthService");
const SocketServer = require("./websocket/SocketServer");
const createApp = require("./app");

// Builds the whole backend. Exported so tests / the load test can boot it on any port.
async function createServer({ port = config.PORT, dbPath = config.DATABASE_PATH } = {}) {
  const db = new Database(dbPath);
  const roomManager = new RoomManager(db);
  const authService = new AuthService(db);
  const app = createApp({ authService, roomManager, db });
  const httpServer = http.createServer(app);
  const sockets = new SocketServer(httpServer, { authService, roomManager, db });
  const redis = await sockets.enableRedis();

  await new Promise((resolve) => httpServer.listen(port, resolve));
  const actualPort = httpServer.address().port;

  const close = async () => {
    roomManager.shutdown();
    await sockets.close();
    await new Promise((r) => httpServer.close(r));
    db.close();
  };
  return { httpServer, io: sockets.io, db, roomManager, authService, port: actualPort, redis, close };
}

module.exports = { createServer };

if (require.main === module) {
  createServer().then((s) => {
    if (config.JWT_SECRET === "dev-secret-change-me") {
      console.warn("[warn] JWT_SECRET is not set - using an insecure development default");
    }
    console.log(`Watch Party server listening on :${s.port} (db: ${config.DATABASE_PATH}, redis: ${s.redis ? "on" : "off"})`);
    const stop = async () => { await s.close(); process.exit(0); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  });
}
