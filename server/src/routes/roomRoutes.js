const express = require("express");
const { requireAuth } = require("../middleware/auth");
const config = require("../config");

module.exports = function roomRoutes({ authService, roomManager, db }) {
  const router = express.Router();
  router.use(requireAuth(authService));

  // Create a room - the creator automatically becomes Host
  router.post("/", (req, res) => {
    const room = roomManager.create(req.user, req.body?.name);
    res.status(201).json({ room: { code: room.code, name: room.name } });
  });

  // Rooms this user belongs to (persistent rooms)
  router.get("/mine", (req, res) => {
    res.json({ rooms: db.getRoomsOfUser(req.user.id) });
  });

  // Room info before joining (also validates a code typed into the join box)
  router.get("/:code", (req, res) => {
    const room = roomManager.get(req.params.code);
    if (!room) return res.status(404).json({ error: "Room not found" });
    res.json({
      room: {
        code: room.code,
        name: room.name,
        online: room.onlineCount,
        capacity: config.MAX_ROOM_SIZE,
        banned: room.isBanned(req.user.id),
      },
    });
  });

  return router;
};
