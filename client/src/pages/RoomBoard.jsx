import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getRoom } from "../api.js";
import { useAuth } from "../App.jsx";
import PinBoard from "../components/PinBoard.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import ItineraryBoard from "../components/ItineraryBoard.jsx";

export default function RoomBoard() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setError("");
    setRoom(null);
    getRoom(roomId)
      .then((data) => setRoom(data.room))
      .catch((err) => setError(err.message));
  }, [roomId]);

  if (error) {
    return (
      <div className="screen">
        <div className="card">
          <div className="error">{error}</div>
          <Link to="/rooms">Back to your rooms</Link>
        </div>
      </div>
    );
  }

  if (!room) return null;

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-header-left">
          <div className="brand-mark small">T</div>
          <div>
            <h1>{room.name}</h1>
            <p className="muted tight">
              Code: <span className="code-badge">{room.join_code}</span>
              {" · "}
              {room.member_count} member{Number(room.member_count) === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="room-header-right">
          <button type="button" className="btn-secondary" onClick={() => navigate("/rooms")}>
            Your rooms
          </button>
          <button type="button" className="btn-secondary" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="board-layout">
        <ChatPanel roomId={room.room_id} />
        <PinBoard roomId={room.room_id} />
      </div>

      <ItineraryBoard roomId={room.room_id} />

      <p className="muted roadmap-note">Route optimization comes next.</p>
    </div>
  );
}
