const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class AuthService {
  constructor(database) {
    this.db = database;
  }

  async register(username, password) {
    username = String(username || "").trim();
    password = String(password || "");
    if (!USERNAME_RE.test(username)) {
      throw new AuthError("Username must be 3-20 characters: letters, numbers, _ . -");
    }
    if (password.length < 6 || password.length > 72) {
      throw new AuthError("Password must be 6-72 characters");
    }
    if (this.db.findUserByName(username)) throw new AuthError("Username is already taken", 409);
    const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    let user;
    try {
      user = this.db.createUser(username, hash);
    } catch (e) {
      if (String(e.code).startsWith("SQLITE_CONSTRAINT")) throw new AuthError("Username is already taken", 409);
      throw e;
    }
    return { user, token: this.signToken(user) };
  }

  async login(username, password) {
    const row = this.db.findUserByName(String(username || "").trim());
    const ok = row && (await bcrypt.compare(String(password || ""), row.password_hash));
    if (!ok) throw new AuthError("Invalid username or password", 401);
    const user = { id: row.id, username: row.username };
    return { user, token: this.signToken(user) };
  }

  signToken(user) {
    return jwt.sign({ sub: user.id, username: user.username }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN,
    });
  }

  // Returns { id, username } or null
  verifyToken(token) {
    try {
      const p = jwt.verify(String(token || ""), config.JWT_SECRET);
      return { id: Number(p.sub), username: p.username };
    } catch (_) {
      return null;
    }
  }
}

module.exports = { AuthService, AuthError };
