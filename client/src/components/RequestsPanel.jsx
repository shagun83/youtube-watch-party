import { describeRequest } from "../utils/format";

export default function RequestsPanel({ requests, me, canApprove, onApprove, onReject }) {
  if (!requests.length) {
    return <p className="empty">No pending requests.<br />Participants' playback changes appear here for approval.</p>;
  }
  return (
    <ul className="requests">
      {requests.map((r) => (
        <li key={r.id}>
          <div>
            <strong>{r.userId === me.userId ? "You" : r.username}</strong> {describeRequest(r)}
          </div>
          {canApprove ? (
            <div className="req-actions">
              <button className="small ok" onClick={() => onApprove(r.id)}>Approve</button>
              <button className="small danger" onClick={() => onReject(r.id)}>Reject</button>
            </div>
          ) : (
            <small className="muted">Waiting for approval…</small>
          )}
        </li>
      ))}
    </ul>
  );
}
