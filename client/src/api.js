export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

async function request(method, url, body, token) {
  const res = await fetch(SERVER_URL + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (username, password) => request("POST", "/api/auth/register", { username, password }),
  login: (username, password) => request("POST", "/api/auth/login", { username, password }),
  me: (token) => request("GET", "/api/auth/me", null, token),
  createRoom: (token, name) => request("POST", "/api/rooms", { name }, token),
  roomInfo: (token, code) => request("GET", `/api/rooms/${encodeURIComponent(code)}`, null, token),
  myRooms: (token) => request("GET", "/api/rooms/mine", null, token),
};
