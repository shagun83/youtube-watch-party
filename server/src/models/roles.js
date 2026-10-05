const ROLES = Object.freeze({
  HOST: "Host",
  MODERATOR: "Moderator",
  PARTICIPANT: "Participant",
  VIEWER: "Viewer",
});
const ASSIGNABLE_ROLES = [ROLES.MODERATOR, ROLES.PARTICIPANT, ROLES.VIEWER];

// Permission matrix - the single source of truth used by Room + MessageHandler.
const PERMISSIONS = {
  [ROLES.HOST]: { control: true, request: false, approve: true, manageRoles: true, remove: true, transfer: true, chat: true },
  [ROLES.MODERATOR]: { control: true, request: false, approve: true, manageRoles: false, remove: false, transfer: false, chat: true },
  [ROLES.PARTICIPANT]: { control: false, request: true, approve: false, manageRoles: false, remove: false, transfer: false, chat: true },
  [ROLES.VIEWER]: { control: false, request: false, approve: false, manageRoles: false, remove: false, transfer: false, chat: true },
};

const can = (role, perm) => !!PERMISSIONS[role]?.[perm];

module.exports = { ROLES, ASSIGNABLE_ROLES, PERMISSIONS, can };
