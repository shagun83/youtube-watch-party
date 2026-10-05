import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SERVER_URL } from "../api";

const initial = {
  conn: "connecting", // connecting | connected | reconnecting
  status: "joining", // joining | joined | error | removed
  error: null,
  room: null,
  me: null,
  participants: [],
  playback: null,
  requests: [],
  messages: [],
  reactions: [],
  toasts: [],
};

let uid = 0;

// All real-time logic for one room lives here: it owns the WebSocket, turns server events into
// React state and exposes small action functions to the UI.
export function useRoom(token, code, { onAuthFailed }) {
  const [s, setS] = useState(initial);
  const sRef = useRef(initial); // always-current copy so event handlers never read stale state
  const socketRef = useRef(null);
  const offsetRef = useRef(0); // serverTime - clientTime, measured with a few ping samples

  const patch = useCallback((p) => {
    const next = { ...sRef.current, ...(typeof p === "function" ? p(sRef.current) : p) };
    sRef.current = next;
    setS(next);
  }, []);
  const toast = useCallback((message, kind = "info") => {
    const id = ++uid;
    patch((prev) => ({ toasts: [...prev.toasts, { id, message, kind }].slice(-4) }));
    setTimeout(() => patch((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })), 4500);
  }, [patch]);
  const system = useCallback((text) => {
    patch((prev) => ({ messages: [...prev.messages, { id: `sys-${++uid}`, system: true, text }].slice(-300) }));
  }, [patch]);

  useEffect(() => {
    sRef.current = initial;
    setS(initial);
    const socket = io(SERVER_URL, {
      auth: { token },
      query: { room: code }, // lets a load balancer route all sockets of one room to the same instance
      transports: ["websocket"], // pure WebSocket: no sticky sessions needed behind a load balancer
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    const syncClock = async () => {
      let best = null;
      for (let i = 0; i < 5; i++) {
        const sample = await new Promise((resolve) => {
          const t0 = Date.now();
          socket.timeout(2000).emit("time_sync", (err, serverNow) => {
            if (err) return resolve(null);
            const t1 = Date.now();
            resolve({ rtt: t1 - t0, offset: serverNow + (t1 - t0) / 2 - t1 });
          });
        });
        if (sample && (!best || sample.rtt < best.rtt)) best = sample;
      }
      if (best) offsetRef.current = best.offset;
    };

    const applyParticipants = (list, extra = {}) =>
      patch((prev) => {
        const mine = list.find((p) => p.userId === prev.me?.userId);
        return { participants: list, me: prev.me && mine ? { ...prev.me, role: mine.role } : prev.me, ...extra };
      });

    socket.on("connect", () => {
      patch({ conn: "connected" });
      socket.emit("join_room", { roomId: code });
      syncClock();
    });
    socket.on("disconnect", () => patch({ conn: "reconnecting" }));
    socket.on("connect_error", (e) => {
      if (e.message === "AUTH_REQUIRED") onAuthFailed?.();
      else patch({ conn: "reconnecting" });
    });

    socket.on("room_joined", (d) =>
      patch({
        status: "joined", error: null, room: d.room, me: d.you, participants: d.participants,
        playback: d.state, requests: d.requests, messages: d.messages,
      })
    );
    socket.on("sync_state", (state) => patch({ playback: state }));
    socket.on("sync_tick", (state) => patch({ playback: state }));

    socket.on("user_joined", (d) => { applyParticipants(d.participants); system(`${d.username} joined`); });
    socket.on("user_left", (d) => { applyParticipants(d.participants); system(`${d.username} left`); });
    socket.on("role_assigned", (d) => {
      applyParticipants(d.participants);
      system(`${d.username} is now ${d.role}`);
      if (d.userId === sRef.current.me?.userId) toast(`You are now a ${d.role}`, "success");
    });
    socket.on("host_transferred", (d) => {
      applyParticipants(d.participants, {});
      patch((prev) => ({ room: prev.room ? { ...prev.room, hostId: d.newHostId } : prev.room }));
      system(`${d.newHostName} is now the Host`);
      if (d.newHostId === sRef.current.me?.userId) toast("You are now the Host", "success");
    });
    socket.on("participant_removed", (d) => {
      if (d.userId === sRef.current.me?.userId) {
        socket.close();
        patch({ status: "removed", error: `You were removed from the room by ${d.by}` });
        return;
      }
      patch({ participants: d.participants });
      system(`${d.username} was removed by ${d.by}`);
    });

    socket.on("request_created", ({ request }) =>
      patch((prev) => ({
        requests: [
          ...prev.requests.filter((r) => r.id !== request.id && !(r.userId === request.userId && r.type === request.type)),
          request,
        ],
      }))
    );
    socket.on("request_resolved", (d) => {
      if (d.userId === sRef.current.me?.userId && (d.status === "approved" || d.status === "rejected")) {
        toast(`Your request was ${d.status} by ${d.by}`, d.status === "approved" ? "success" : "error");
      }
      patch((prev) => ({ requests: prev.requests.filter((r) => r.id !== d.requestId) }));
    });

    socket.on("chat_message", (m) => patch((prev) => ({ messages: [...prev.messages, m].slice(-300) })));
    socket.on("reaction", (r) => {
      patch((prev) => ({ reactions: [...prev.reactions, { ...r, left: 10 + Math.random() * 80 }].slice(-30) }));
      setTimeout(() => patch((prev) => ({ reactions: prev.reactions.filter((x) => x.id !== r.id) })), 3500);
    });

    socket.on("permission_denied", (d) => toast(d.message, "error"));
    socket.on("error_message", (d) => {
      if (["ROOM_NOT_FOUND", "BANNED", "ROOM_FULL"].includes(d.code)) {
        patch({ status: "error", error: d.message });
        socket.close();
      } else toast(d.message, "error");
    });

    return () => {
      socket.emit("leave_room", { roomId: code });
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, code]);

  const emit = useCallback((event, payload = {}) => socketRef.current?.emit(event, payload), []);

  return {
    ...s,
    getServerNow: () => Date.now() + offsetRef.current,
    dismissToast: (id) => patch((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),
    actions: {
      control: (type, payload) => emit(type, payload),
      request: (type, payload) => emit("request_action", { type, ...payload }),
      approve: (requestId) => emit("approve_request", { requestId }),
      reject: (requestId) => emit("reject_request", { requestId }),
      assignRole: (userId, role) => emit("assign_role", { userId, role }),
      removeUser: (userId) => emit("remove_participant", { userId }),
      transferHost: (userId) => emit("transfer_host", { userId }),
      chat: (text) => emit("chat_message", { text }),
      react: (emoji) => emit("reaction", { emoji }),
      resync: () => emit("request_sync"),
    },
  };
}
