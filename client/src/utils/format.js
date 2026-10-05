export function formatTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function describeRequest(r) {
  switch (r.type) {
    case "play": return "wants to play the video";
    case "pause": return "wants to pause the video";
    case "seek": return `wants to jump to ${formatTime(r.payload?.time)}`;
    case "change_video": return `wants to change the video (${r.payload?.videoId})`;
    default: return "sent a request";
  }
}
