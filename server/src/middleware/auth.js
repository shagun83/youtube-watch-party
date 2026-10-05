// Express middleware: requires "Authorization: Bearer <jwt>"
function requireAuth(authService) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const user = authService.verifyToken(header.startsWith("Bearer ") ? header.slice(7) : "");
    if (!user) return res.status(401).json({ error: "Please log in first" });
    req.user = user;
    next();
  };
}

// Socket.IO middleware: token comes from the handshake `auth` payload, so an
// unauthenticated client can never even open a WebSocket connection.
function socketAuth(authService) {
  return (socket, next) => {
    const user = authService.verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("AUTH_REQUIRED"));
    socket.data.user = user;
    next();
  };
}

module.exports = { requireAuth, socketAuth };
