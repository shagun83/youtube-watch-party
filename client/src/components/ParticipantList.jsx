const ROLE_OPTIONS = ["Moderator", "Participant", "Viewer"];

export default function ParticipantList({ participants, me, isHost, onAssign, onRemove, onTransfer }) {
  return (
    <ul className="people">
      {participants.map((p) => {
        const isMe = p.userId === me.userId;
        const manageable = isHost && !isMe && p.role !== "Host";
        return (
          <li key={p.userId}>
            <div className="person-main">
              <span className="avatar">{p.username[0].toUpperCase()}</span>
              <span className="person-name">
                {p.username}
                {isMe && <em> (you)</em>}
              </span>
              <span className={`badge role-${p.role}`}>{p.role}</span>
            </div>
            {manageable && (
              <div className="person-actions">
                <select value={p.role} onChange={(e) => onAssign(p.userId, e.target.value)} aria-label={`Role of ${p.username}`}>
                  {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <button className="small" onClick={() => window.confirm(`Make ${p.username} the Host? You will become a Moderator.`) && onTransfer(p.userId)}>
                  Make host
                </button>
                <button className="small danger" onClick={() => window.confirm(`Remove ${p.username} from the room? They won't be able to rejoin.`) && onRemove(p.userId)}>
                  Remove
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
