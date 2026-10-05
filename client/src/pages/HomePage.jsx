import { useEffect, useState } from "react";
import { api } from "../api";

export default function HomePage({ token, user, onLogout, navigate }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.myRooms(token).then((d) => setRooms(d.rooms)).catch(() => {});
  }, [token]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { room } = await api.createRoom(token, name);
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const join = async (e) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/^.*\/room\//i, "");
    if (!clean) return;
    setBusy(true);
    setError("");
    try {
      const { room } = await api.roomInfo(token, clean);
      if (room.banned) throw new Error("You were removed from this room");
      navigate(`/room/${room.code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <header className="topbar">
        <div className="brand"><span className="logo sm">▶</span> Watch Party</div>
        <div className="top-right">
          <span className="muted">Signed in as <strong>{user.username}</strong></span>
          <button className="small" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="home-grid">
        <form className="card" onSubmit={create}>
          <h2>Create a room</h2>
          <p className="muted">You become the Host with full control.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name (optional)" maxLength={40} />
          <button className="primary-btn" disabled={busy}>Create room</button>
        </form>

        <form className="card" onSubmit={join}>
          <h2>Join a room</h2>
          <p className="muted">Enter a room code or paste an invite link.</p>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code e.g. K7M2QX" />
          <button className="primary-btn alt" disabled={busy || !code.trim()}>Join room</button>
        </form>
      </div>
      {error && <p className="error center">{error}</p>}

      {rooms.length > 0 && (
        <section className="card wide">
          <h2>Your rooms</h2>
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.code}>
                <div>
                  <strong>{r.name}</strong>
                  <small className="muted"> · {r.code}</small>
                </div>
                <div className="room-list-right">
                  <span className={`badge role-${r.role}`}>{r.role}</span>
                  <button className="small" onClick={() => navigate(`/room/${r.code}`)}>Open</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
