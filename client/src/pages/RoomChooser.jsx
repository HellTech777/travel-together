import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, joinRoom, getMyRooms } from "../api.js";
import { useAuth } from "../App.jsx";

export default function RoomChooser() {
  const [mode, setMode] = useState("create"); // "create" | "join"
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [myRooms, setMyRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    getMyRooms()
      .then((data) => setMyRooms(data.rooms))
      .catch(() => setMyRooms([]))
      .finally(() => setLoadingRooms(false));
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await createRoom(roomName);
      navigate(`/rooms/${data.room.room_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await joinRoom(joinCode);
      navigate(`/rooms/${data.room.room_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="card wide">
        <div className="brand-mark">T</div>
        <h1>Hi, {user.name}</h1>
        <p className="muted">Create a new trip, or join one a friend already started.</p>

        {!loadingRooms && myRooms.length > 0 && (
          <div className="room-list">
            <div className="room-list-label">Your trips</div>
            {myRooms.map((room) => (
              <button
                key={room.room_id}
                type="button"
                className="room-item"
                onClick={() => navigate(`/rooms/${room.room_id}`)}
              >
                <span>{room.name}</span>
                <span className="code-badge">{room.join_code}</span>
              </button>
            ))}
          </div>
        )}

        <div className="tab-row">
          <button
            type="button"
            className={`tab ${mode === "create" ? "active" : ""}`}
            onClick={() => setMode("create")}
          >
            Create a room
          </button>
          <button
            type="button"
            className={`tab ${mode === "join" ? "active" : ""}`}
            onClick={() => setMode("join")}
          >
            Join a room
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {mode === "create" ? (
          <form onSubmit={handleCreate}>
            <label>
              Trip name
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Lisbon Long Weekend"
                required
              />
            </label>
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create room"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <label>
              Room code
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. 7K2PXQ"
                maxLength={8}
                required
              />
            </label>
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Joining…" : "Join room"}
            </button>
          </form>
        )}

        <button type="button" className="btn-secondary" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
