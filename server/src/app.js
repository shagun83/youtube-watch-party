const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config");
const authRoutes = require("./routes/authRoutes");
const roomRoutes = require("./routes/roomRoutes");

function createApp({ authService, roomManager, db }) {
  const app = express();
  app.set("trust proxy", 1); // behind Render/Railway proxies
  app.use(cors({ origin: config.CLIENT_URLS.length ? config.CLIENT_URLS : true }));
  app.use(express.json({ limit: "10kb" }));

  app.get("/api/health", (req, res) =>
    res.json({ status: "ok", uptime: process.uptime(), ...roomManager.stats(), ...db.stats() })
  );
  app.use("/api/auth", authRoutes(authService, db));
  app.use("/api/rooms", roomRoutes({ authService, roomManager, db }));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  // In production the same service also serves the built React app (single deployment)
  const indexHtml = path.join(config.CLIENT_DIST, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.CLIENT_DIST, { maxAge: "1h", index: false }));
    app.get(/^\/(?!socket\.io).*/, (req, res) => res.sendFile(indexHtml));
  } else {
    app.get("/", (req, res) => res.json({ message: "YouTube Watch Party API is running" }));
  }
  return app;
}

module.exports = createApp;
