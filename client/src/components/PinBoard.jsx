import { useEffect, useRef, useState, useCallback } from "react";
import { listPins, createPin, toggleVote } from "../api.js";
import { CATEGORY_META } from "../categoryMeta.js";

const PIN_PATH =
  "M12,0.8 C5.8,0.8 0.8,5.8 0.8,12 C0.8,20.5 12,33 12,33 C12,33 23.2,20.5 23.2,12 C23.2,5.8 18.2,0.8 12,0.8 Z";

export default function PinBoard({ roomId }) {
  const [pins, setPins] = useState([]);
  const [selectedPinId, setSelectedPinId] = useState(null);
  const [draftPoint, setDraftPoint] = useState(null); // {x, y} while placing a new pin
  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState("attraction");
  const [draftDescription, setDraftDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mapRef = useRef(null);

  const refresh = useCallback(() => {
    listPins(roomId)
      .then((data) => setPins(data.pins))
      .catch((err) => setError(err.message));
  }, [roomId]);

  useEffect(() => {
    refresh();
    // Light polling so members roughly see each other's pins and votes
    // until real-time chat brings websockets into the project.
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleMapClick = (e) => {
    if (draftPoint) return; // already placing one — finish or cancel it first
    const rect = mapRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setSelectedPinId(null);
    setDraftPoint({ x, y });
    setDraftName("");
    setDraftCategory("attraction");
    setDraftDescription("");
    setError("");
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!draftName.trim()) {
      setError("Give the pin a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createPin(roomId, {
        name: draftName.trim(),
        category: draftCategory,
        description: draftDescription.trim(),
        latitude: draftPoint.y,
        longitude: draftPoint.x,
      });
      setDraftPoint(null);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVote = async (pinId) => {
    setError("");
    try {
      await toggleVote(roomId, pinId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const selectedPin = pins.find((p) => p.pin_id === selectedPinId);
  const ranked = [...pins].sort((a, b) => b.vote_count - a.vote_count);

  return (
    <div className="pin-board">
      <div className="pin-board-map-col">
        <div className="map-head">
          <h2>Shared map</h2>
          <span className="map-hint">Click anywhere to drop a pin</span>
        </div>

        <div className="map-stage" ref={mapRef} onClick={handleMapClick}>
          <svg className="map-grid" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="-10" y="-10" width="130" height="130" fill="#F2EFE9" />
            <g stroke="#FFFFFF" strokeWidth="0.6">
              <line x1="0" y1="20" x2="100" y2="20" />
              <line x1="0" y1="40" x2="100" y2="40" />
              <line x1="0" y1="60" x2="100" y2="60" />
              <line x1="0" y1="80" x2="100" y2="80" />
              <line x1="20" y1="0" x2="20" y2="100" />
              <line x1="40" y1="0" x2="40" y2="100" />
              <line x1="60" y1="0" x2="60" y2="100" />
              <line x1="80" y1="0" x2="80" y2="100" />
            </g>
          </svg>

          {pins.map((pin) => (
            <button
              key={pin.pin_id}
              type="button"
              className="map-pin"
              style={{ left: `${pin.longitude}%`, top: `${pin.latitude}%` }}
              onClick={(e) => {
                e.stopPropagation();
                setDraftPoint(null);
                setSelectedPinId(pin.pin_id);
              }}
            >
              <svg viewBox="0 0 24 34" className="pin-svg">
                <path d={PIN_PATH} fill={CATEGORY_META[pin.category].color} stroke="#fff" strokeWidth="1.2" />
              </svg>
              <span className="pin-votes">{pin.vote_count}</span>
            </button>
          ))}

          {draftPoint && (
            <div className="map-pin draft" style={{ left: `${draftPoint.x}%`, top: `${draftPoint.y}%` }}>
              <svg viewBox="0 0 24 34" className="pin-svg">
                <path d={PIN_PATH} fill="#16232E" stroke="#fff" strokeWidth="1.2" />
              </svg>
            </div>
          )}

          <div className="map-legend">
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <span key={key} className="legend-item">
                <span className="legend-dot" style={{ background: meta.color }} />
                {meta.label}
              </span>
            ))}
          </div>
        </div>

        {error && <div className="error map-error">{error}</div>}

        {draftPoint && (
          <form className="pin-form" onSubmit={handleCreate}>
            <label>
              Name
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                autoFocus
                required
              />
            </label>
            <label>
              Category
              <select value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                <option value="attraction">See &amp; do</option>
                <option value="food">Food</option>
                <option value="hotel">Stay</option>
              </select>
            </label>
            <label>
              Notes (optional)
              <input type="text" value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} />
            </label>
            <div className="pin-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setDraftPoint(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Adding…" : "Add pin"}
              </button>
            </div>
          </form>
        )}

        {selectedPin && (
          <div className="pin-detail">
            <div className="pin-detail-head">
              <h3>{selectedPin.name}</h3>
              <span className="cat-badge" style={{ background: CATEGORY_META[selectedPin.category].color }}>
                {CATEGORY_META[selectedPin.category].label}
              </span>
            </div>
            {selectedPin.description && <p className="muted">{selectedPin.description}</p>}
            <button
              type="button"
              className={`vote-btn ${selectedPin.has_voted ? "voted" : ""}`}
              onClick={() => handleVote(selectedPin.pin_id)}
            >
              {selectedPin.has_voted ? "★ Voted" : "☆ Vote for this"} · {selectedPin.vote_count}
            </button>
          </div>
        )}
      </div>

      <div className="pin-board-list-col">
        <div className="map-head">
          <h2>Top voted</h2>
        </div>
        {ranked.length === 0 && <p className="muted small-pad">No pins yet — click the map to add the first one.</p>}
        <div className="voted-list">
          {ranked.map((pin) => (
            <div key={pin.pin_id} className="voted-item">
              <span className="legend-dot" style={{ background: CATEGORY_META[pin.category].color }} />
              <span className="voted-name">{pin.name}</span>
              <button
                type="button"
                className={`vote-btn small ${pin.has_voted ? "voted" : ""}`}
                onClick={() => handleVote(pin.pin_id)}
              >
                {pin.vote_count}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
