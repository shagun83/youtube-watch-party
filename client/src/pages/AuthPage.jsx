import { useState } from "react";
import { api } from "../api";

export default function AuthPage({ onAuth, notice }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(notice || "");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      onAuth(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center-page">
      <form className="card auth" onSubmit={submit}>
        <div className="logo">▶</div>
        <h1>YouTube Watch Party</h1>
        <p className="muted">Watch together, perfectly in sync.</p>

        <div className="tabs two">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Log in</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Sign up</button>
        </div>

        <label>Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="e.g. alex_22" required />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="At least 6 characters" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary-btn" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
      </form>
    </main>
  );
}
