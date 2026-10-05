import { useCallback, useEffect, useRef, useState } from "react";
import { loadYouTubeApi } from "../utils/youtube";
import { formatTime } from "../utils/format";

// YouTube IFrame player + custom controls.
//  - The YouTube UI is hidden and covered by an overlay, so every play/pause/seek goes through OUR
//    controls -> through the server's permission check -> broadcast back to everyone.
//  - Host/Moderator controls act directly; Participant controls send an approval request.
export default function Player({ playback, canControl, canRequest, onAction, getServerNow, onEnded }) {
  const holder = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const startedRef = useRef(false);
  const loadedVideo = useRef(null);
  const pbRef = useRef(playback);
  const canControlRef = useRef(canControl);
  const [started, setStarted] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [scrub, setScrub] = useState(null);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);

  canControlRef.current = canControl;
  pbRef.current = playback;

  const targetTime = useCallback(
    (pb) => (pb.playState === "playing" ? pb.currentTime + (getServerNow() - pb.serverTime) / 1000 : pb.currentTime),
    [getServerNow]
  );

  // Make the local player match the room's authoritative state
  const apply = useCallback(
    (pb) => {
      const p = playerRef.current;
      if (!p || !readyRef.current || !pb) return;
      const target = Math.max(0, targetTime(pb));

      if (loadedVideo.current !== pb.videoId) {
        loadedVideo.current = pb.videoId;
        setError(null);
        if (startedRef.current && pb.playState === "playing") p.loadVideoById({ videoId: pb.videoId, startSeconds: target });
        else p.cueVideoById({ videoId: pb.videoId, startSeconds: target });
        return;
      }
      if (!startedRef.current) return; // wait for the user's first click (browser autoplay policy)

      const hard = ["seek", "join", "resync", "change_video"].includes(pb.action);
      const threshold = hard ? 0.4 : pb.action === "tick" ? 1.5 : 0.8;
      const drift = Math.abs(p.getCurrentTime() - target);
      if (drift > threshold) p.seekTo(target, true);

      const st = p.getPlayerState();
      if (pb.playState === "playing") {
        if (st !== 1 && st !== 3) p.playVideo();
      } else {
        if (st === 1 || st === 3 || drift > threshold) p.pauseVideo();
      }
    },
    [targetTime]
  );

  // Create the player once
  useEffect(() => {
    let destroyed = false;
    loadYouTubeApi().then((YT) => {
      if (destroyed || !holder.current) return;
      const el = document.createElement("div");
      holder.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        videoId: pbRef.current?.videoId,
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, fs: 0, iv_load_policy: 3 },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            loadedVideo.current = pbRef.current?.videoId;
            e.target.setVolume(80);
            setDur(e.target.getDuration() || 0);
            // position the paused/cued video at the room's current time
            const pb = pbRef.current;
            if (pb) e.target.cueVideoById({ videoId: pb.videoId, startSeconds: Math.max(0, targetTime(pb)) });
          },
          onStateChange: (e) => {
            if (e.data === 0 && canControlRef.current) onEnded?.(e.target.getDuration());
            if (e.data === 1 || e.data === 5) setDur(e.target.getDuration() || 0);
          },
          onError: () => setError("This video can't be played here (the owner may have disabled embedding)."),
        },
      });
    });
    return () => {
      destroyed = true;
      readyRef.current = false;
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to every server state update
  useEffect(() => { apply(playback); }, [playback, apply]);

  // Progress readout
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p || !readyRef.current || typeof p.getCurrentTime !== "function") return;
      setCur(p.getCurrentTime() || 0);
      const d = p.getDuration?.();
      if (d) setDur(d);
    }, 300);
    return () => clearInterval(t);
  }, []);

  const startWatching = () => {
    startedRef.current = true;
    setStarted(true);
    apply(pbRef.current);
    const p = playerRef.current;
    if (p && pbRef.current?.playState === "playing") p.playVideo();
  };

  const playing = playback?.playState === "playing";
  const act = (type, payload) => onAction(type, payload);
  const togglePlay = () => act(playing ? "pause" : "play", { time: playerRef.current?.getCurrentTime?.() ?? 0 });
  const skip = (delta) => act("seek", { time: Math.max(0, (playerRef.current?.getCurrentTime?.() ?? 0) + delta) });
  const commitSeek = () => {
    if (scrub !== null) act("seek", { time: scrub });
    setScrub(null);
  };
  const interactive = canControl || canRequest;
  const verb = canControl ? "" : " (request)";

  const changeVolume = (v) => {
    setVolume(v);
    playerRef.current?.setVolume(v);
    if (v > 0 && muted) { setMuted(false); playerRef.current?.unMute(); }
  };
  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (muted) { p.unMute(); setMuted(false); } else { p.mute(); setMuted(true); }
  };

  return (
    <div className="player">
      <div className="player-frame">
        <div ref={holder} className="player-holder" />
        {/* Transparent shield: viewers cannot click through to the native YouTube UI */}
        <div className="player-shield" onClick={() => started && interactive && togglePlay()} />
        {!started && (
          <button className="player-start" onClick={startWatching}>
            <span className="big-play">▶</span>
            <span>Join the watch party</span>
            <small>Click to start synced playback</small>
          </button>
        )}
        {error && <div className="player-error">{error}</div>}
      </div>

      <div className="controls">
        <button className="icon-btn" onClick={() => skip(-10)} disabled={!interactive} title={`Back 10s${verb}`}>⏪</button>
        <button className="icon-btn primary" onClick={togglePlay} disabled={!interactive} title={`${playing ? "Pause" : "Play"}${verb}`}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="icon-btn" onClick={() => skip(10)} disabled={!interactive} title={`Forward 10s${verb}`}>⏩</button>
        <span className="time">{formatTime(scrub ?? cur)}</span>
        <input
          className="seek"
          type="range"
          min={0}
          max={Math.max(1, Math.floor(dur))}
          step={1}
          value={Math.min(scrub ?? cur, Math.max(1, dur))}
          disabled={!interactive}
          onChange={(e) => setScrub(Number(e.target.value))}
          onMouseUp={commitSeek}
          onTouchEnd={commitSeek}
          onKeyUp={commitSeek}
          title={interactive ? `Seek${verb}` : "Viewers can't seek"}
        />
        <span className="time">{formatTime(dur)}</span>
        <button className="icon-btn" onClick={toggleMute} title={muted ? "Unmute (only you)" : "Mute (only you)"}>{muted || volume === 0 ? "🔇" : "🔊"}</button>
        <input className="volume" type="range" min={0} max={100} value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} />
      </div>
      {!canControl && (
        <p className="hint">
          {canRequest
            ? "You're a Participant: play, pause, seek and video changes are sent to the Host/Moderators for approval."
            : "You're a Viewer: you can watch, chat and react, but not control playback."}
        </p>
      )}
    </div>
  );
}
