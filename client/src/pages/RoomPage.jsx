import { useRef, useState } from "react";
import { useRoom } from "../hooks/useRoom";
import { parseVideoId } from "../utils/youtube";
import Player from "../components/Player";
import ParticipantList from "../components/ParticipantList";
import RequestsPanel from "../components/RequestsPanel";
import Chat from "../components/Chat";

const EMOJIS = ["👍", "❤️", "😂", "😮", "👏", "🔥", "😢", "🎉"];

export default function RoomPage({ token, code, navigate, onAuthFailed }) {
  const r = useRoom(token, code, { onAuthFailed });
  const [tab, setTab] = useState("chat");
  const [videoInput, setVideoInput] = useState("");
  const [copied, setCopied] = useState(false);
  const playbackRef = useRef(null);
  playbackRef.current = r.playback;

  if (r.status === "joining") {
    return <main className="center-page"><div className="card"><div className="spinner" /><p>Joining room {code}…</p></div></main>;
  }
  if (r.status === "error" || r.status === "removed") {
    return (
      <main className="center-page">
        <div className="card">
          <h2>{r.status === "removed" ? "Removed from room" : "Can't join this room"}</h2>
          <p className="error">{r.error}</p>
          <button className="primary-btn" onClick={() => navigate("/")}>Back to home</button>
        </div>
      </main>
    );
  }

  const { me, room, participants, requests, actions } = r;
  const isHost = me.role === "Host";
  const canControl = isHost || me.role === "Moderator";
  const canRequest = me.role === "Participant";
  const link = `${window.location.origin}/room/${room.code}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const onAction = (type, payload) => (canControl ? actions.control(type, payload) : actions.request(type, payload));

  const submitVideo = (e) => {
    e.preventDefault();
    const id = parseVideoId(videoInput);
    if (!id) return window.alert("Please paste a valid YouTube link (youtube.com/watch?v=…, youtu.be/…) or an 11-character video ID.");
    onAction("change_video", { videoId: id });
    setVideoInput("");
  };

  return (
    <div className="room">
      <header className="topbar">
        <div className="brand" onClick={() => navigate("/")} role="button">
          <span className="logo sm">▶</span> {room.name}
        </div>
        <div className="top-right">
          <span className={`dot ${r.conn}`} title={r.conn} />
          <span className="muted hide-sm">{r.conn === "connected" ? "Live" : "Reconnecting…"}</span>
          <span className={`badge role-${me.role}`}>{me.role}</span>
          <button className="small" onClick={copyLink}>{copied ? "Copied ✓" : `Code ${room.code} · Copy link`}</button>
          <button className="small" onClick={actions.resync} title="Re-sync with the room">⟳ Sync</button>
          <button className="small danger" onClick={() => navigate("/")}>Leave</button>
        </div>
      </header>

      <div className="room-body">
        <section className="stage">
          <div className="stage-video">
            <Player
              playback={r.playback}
              canControl={canControl}
              canRequest={canRequest}
              onAction={onAction}
              getServerNow={r.getServerNow}
              onEnded={(d) => playbackRef.current?.playState === "playing" && actions.control("pause", { time: d })}
            />
            <div className="reactions-layer">
              {r.reactions.map((x) => (
                <span key={x.id} className="floater" style={{ left: `${x.left}%` }}>
                  {x.emoji}<small>{x.username}</small>
                </span>
              ))}
            </div>
          </div>

          <form className="video-form" onSubmit={submitVideo}>
            <input
              value={videoInput}
              onChange={(e) => setVideoInput(e.target.value)}
              placeholder={me.role === "Viewer" ? "Viewers can't change the video" : "Paste a YouTube link to play together…"}
              disabled={me.role === "Viewer"}
            />
            <button className="primary-btn" disabled={me.role === "Viewer" || !videoInput.trim()}>
              {canControl ? "Change video" : "Request change"}
            </button>
          </form>

          <div className="emoji-bar">
            {EMOJIS.map((e) => <button key={e} onClick={() => actions.react(e)} aria-label={`React ${e}`}>{e}</button>)}
          </div>
        </section>

        <aside className="sidebar">
          <div className="tabs three">
            <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>Chat</button>
            <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>People ({participants.length})</button>
            <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>
              Requests{requests.length > 0 && <span className="count">{requests.length}</span>}
            </button>
          </div>
          <div className="tab-body">
            {tab === "chat" && <Chat messages={r.messages} me={me} onSend={actions.chat} />}
            {tab === "people" && (
              <ParticipantList participants={participants} me={me} isHost={isHost} onAssign={actions.assignRole} onRemove={actions.removeUser} onTransfer={actions.transferHost} />
            )}
            {tab === "requests" && (
              <RequestsPanel requests={requests} me={me} canApprove={canControl} onApprove={actions.approve} onReject={actions.reject} />
            )}
          </div>
        </aside>
      </div>

      <div className="toasts">
        {r.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => r.dismissToast(t.id)}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}
