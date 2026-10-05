import { useEffect, useRef, useState } from "react";

export default function Chat({ messages, me, onSend }) {
  const [text, setText] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 && <p className="empty">No messages yet. Say hi 👋</p>}
        {messages.map((m) =>
          m.system ? (
            <div key={m.id} className="chat-system">{m.text}</div>
          ) : (
            <div key={m.id} className={`chat-msg ${m.userId === me.userId ? "mine" : ""}`}>
              <span className="chat-name">{m.username}</span>
              <span className="chat-text">{m.text}</span>
            </div>
          )
        )}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" maxLength={500} />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
