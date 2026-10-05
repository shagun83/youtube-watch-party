// Accepts a full YouTube URL (watch, youtu.be, embed, shorts, live) or a bare 11-char id.
const ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseVideoId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch (_) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  let id = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (["youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/);
      if (m) id = m[2];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

module.exports = { parseVideoId };
