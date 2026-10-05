const { Server } = require("socket.io");
const config = require("../config");
const { socketAuth } = require("../middleware/auth");
const MessageHandler = require("./MessageHandler");

// Creates the Socket.IO server, wires auth + handlers, the drift-correction ticker and the
// optional Redis adapter used for horizontal scaling.
class SocketServer {
  constructor(httpServer, { authService, roomManager, db }) {
    this.roomManager = roomManager;
    this.io = new Server(httpServer, {
      cors: {
        origin: config.CLIENT_URLS.length ? config.CLIENT_URLS : true,
        credentials: true,
      },
      transports: ["websocket", "polling"],
      maxHttpBufferSize: 1e5,
      pingInterval: 25000,
      pingTimeout: 30000,
      perMessageDeflate: false, // compression costs CPU/memory per connection at 1000s of sockets
    });

    this.io.use(socketAuth(authService));
    this.io.on("connection", (socket) => new MessageHandler(this.io, socket, { roomManager, db }).register());

    // Periodically re-broadcast the position of playing rooms so clients can correct drift
    this.ticker = setInterval(() => {
      for (const room of roomManager.playingRooms()) {
        this.io.to(room.code).emit("sync_tick", room.playbackSnapshot("tick"));
      }
    }, config.SYNC_TICK_MS);
    this.ticker.unref();
  }

  async enableRedis() {
    if (!config.REDIS_URL) return false;
    const { createClient } = require("redis");
    const { createAdapter } = require("@socket.io/redis-adapter");
    const pub = createClient({ url: config.REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    this.io.adapter(createAdapter(pub, sub));
    this.redisClients = [pub, sub];
    return true;
  }

  async close() {
    clearInterval(this.ticker);
    await new Promise((r) => this.io.close(r));
    for (const c of this.redisClients || []) await c.quit().catch(() => {});
  }
}

module.exports = SocketServer;
