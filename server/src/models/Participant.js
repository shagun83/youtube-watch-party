const { can } = require("./roles");

// One logged-in user inside one room. A user may have several sockets (multiple tabs/devices).
class Participant {
  constructor({ userId, username, role }) {
    this.userId = userId;
    this.username = username;
    this.role = role;
    this.sockets = new Set(); // socket ids currently connected for this user in this room
  }
  get online() { return this.sockets.size > 0; }
  can(perm) { return can(this.role, perm); }
  toJSON() {
    return { userId: this.userId, username: this.username, role: this.role, online: this.online };
  }
}

module.exports = Participant;
