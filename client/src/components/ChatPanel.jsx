import { useEffect, useRef, useState } from "react";
import { socket } from "../socket.js";
import { getMessages } from "../api.js";
import { useAuth } from "../App.jsx";

const TYPING_EMIT_INTERVAL_MS = 1200;
const TYPING_HIDE_AFTER_MS = 2000;

export default function ChatPanel({ roomId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [typingName, setTypingName] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const { user } = useAuth();

  const logRef = useRef(null);
  const hideTypingRef = useRef(null);
  const lastTypingEmitRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setJoined(false);
    setError("");

    getMessages(roomId)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch((err) => setError(err.message));

    function joinRoom() {
      socket.emit("join_room", roomId, (res) => {
        if (cancelled) return;
        if (res?.error) setError(res.error);
        else setJoined(true);
      });
    }

    function handleNewMessage(message) {
      if (message.room_id === Number(roomId)) {
        setMessages((prev) => [...prev, message]);
      }
    }

    function handleTyping({ name }) {
      setTypingName(name);
      clearTimeout(hideTypingRef.current);
      hideTypingRef.current = setTimeout(() => setTypingName(""), TYPING_HIDE_AFTER_MS);
    }

    joinRoom();
    socket.on("connect", joinRoom); // re-join automatically after any reconnect
    socket.on("new_message", handleNewMessage);
    socket.on("user_typing", handleTyping);

    return () => {
      cancelled = true;
      socket.off("connect", joinRoom);
      socket.off("new_message", handleNewMessage);
      socket.off("user_typing", handleTyping);
      clearTimeout(hideTypingRef.current);
    };
  }, [roomId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const handleChange = (e) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTypingEmitRef.current > TYPING_EMIT_INTERVAL_MS) {
      socket.emit("typing", { roomId });
      lastTypingEmitRef.current = now;
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    socket.emit("send_message", { roomId, text: trimmed }, (res) => {
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div className="chat-panel">
      <div className="map-head">
        <h2>Trip chat</h2>
        <span className="map-hint">{joined ? "Connected" : "Connecting…"}</span>
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.map((m) => {
          const self = m.user_id === user.id;
          return (
            <div key={m.message_id} className={`msg ${self ? "self" : ""}`}>
              <div className="bubble-wrap">
                {!self && <div className="who">{m.sender_name}</div>}
                <div className="bubble">{m.message_text}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="typing-indicator">{typingName && `${typingName} is typing…`}</div>

      {error && <div className="error map-error">{error}</div>}

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          onChange={handleChange}
          placeholder="Message the group…"
          maxLength={500}
          disabled={!joined}
        />
        <button className="btn-primary" type="submit" disabled={!joined}>
          Send
        </button>
      </form>
    </div>
  );
}
