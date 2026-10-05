import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import RoomPage from "./pages/RoomPage";

const roomFromPath = (path) => path.match(/^\/room\/([A-Za-z0-9]+)\/?$/)?.[1]?.toUpperCase() ?? null;

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("wp_token"));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wp_user")); } catch { return null; }
  });
  const [checking, setChecking] = useState(!!localStorage.getItem("wp_token"));
  const [path, setPath] = useState(window.location.pathname);
  const [notice, setNotice] = useState("");

  const navigate = useCallback((to) => {
    window.history.pushState({}, "", to);
    setPath(to);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const logout = useCallback((message = "") => {
    localStorage.removeItem("wp_token");
    localStorage.removeItem("wp_user");
    setToken(null);
    setUser(null);
    setNotice(message);
  }, []);

  // Validate a stored token once on load
  useEffect(() => {
    if (!token) { setChecking(false); return; }
    api.me(token)
      .then((d) => { setUser(d.user); localStorage.setItem("wp_user", JSON.stringify(d.user)); })
      .catch((e) => { if (e.status === 401) logout("Your session expired, please log in again."); })
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAuth = (t, u) => {
    localStorage.setItem("wp_token", t);
    localStorage.setItem("wp_user", JSON.stringify(u));
    setToken(t);
    setUser(u);
    setNotice("");
  };

  if (checking) return <main className="center-page"><div className="spinner" /></main>;
  if (!token || !user) return <AuthPage onAuth={onAuth} notice={notice} />;

  const code = roomFromPath(path);
  if (code) {
    return <RoomPage key={code} token={token} code={code} navigate={navigate} onAuthFailed={() => logout("Please log in again.")} />;
  }
  return <HomePage token={token} user={user} onLogout={() => logout()} navigate={navigate} />;
}
