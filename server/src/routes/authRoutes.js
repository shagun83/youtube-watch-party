const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");

module.exports = function authRoutes(authService, db) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again later" },
  });

  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  };

  router.post("/register", limiter, handle((req) => authService.register(req.body?.username, req.body?.password)));
  router.post("/login", limiter, handle((req) => authService.login(req.body?.username, req.body?.password)));
  router.get("/me", requireAuth(authService), (req, res) => {
    const user = db.findUserById(req.user.id);
    if (!user) return res.status(401).json({ error: "Account no longer exists" });
    res.json({ user: { id: user.id, username: user.username } });
  });
  return router;
};
