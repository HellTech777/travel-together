import { useEffect, useState, useCallback } from "react";
import { listPins, getItinerary, placeStop, removeStop, optimizeDay } from "../api.js";
import { CATEGORY_META } from "../categoryMeta.js";

const MAX_DAYS = 14;

export default function ItineraryBoard({ roomId }) {
  const [pins, setPins] = useState([]);
  const [stops, setStops] = useState([]);
  const [daySummaries, setDaySummaries] = useState([]);
  const [activeDay, setActiveDay] = useState(1);
  const [dayCount, setDayCount] = useState(1);
  const [dragOverDay, setDragOverDay] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    Promise.all([listPins(roomId), getItinerary(roomId)])
      .then(([pinsData, itineraryData]) => {
        setPins(pinsData.pins);
        setStops(itineraryData.stops);
        setDaySummaries(itineraryData.days);
        const maxDay = itineraryData.stops.reduce((max, s) => Math.max(max, s.day_number), 1);
        setDayCount((current) => Math.max(current, maxDay));
      })
      .catch((err) => setError(err.message));
  }, [roomId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const stopDayByPin = new Map(stops.map((s) => [s.pin_id, s.day_number]));
  const activeDayStops = stops
    .filter((s) => s.day_number === activeDay)
    .sort((a, b) => a.stop_order - b.stop_order);
  const activeDaySummary = daySummaries.find((d) => d.day_number === activeDay);
  const rankedPins = [...pins].sort((a, b) => b.vote_count - a.vote_count);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  const handleOptimize = () => {
    setError("");
    setOptimizing(true);
    optimizeDay(roomId, activeDay)
      .then(refresh)
      .catch((err) => setError(err.message))
      .finally(() => setOptimizing(false));
  };

  const handlePlace = (pinId, dayNumber, beforePinId = null) => {
    setError("");
    placeStop(roomId, pinId, dayNumber, beforePinId)
      .then(refresh)
      .catch((err) => setError(err.message));
  };

  const handleRemove = (pinId) => {
    setError("");
    removeStop(roomId, pinId)
      .then(refresh)
      .catch((err) => setError(err.message));
  };

  const handleDragStart = (e, pinId) => {
    e.dataTransfer.setData("text/plain", String(pinId));
    e.dataTransfer.effectAllowed = "move";
  };

  const readDraggedPinId = (e) => {
    const value = Number(e.dataTransfer.getData("text/plain"));
    return Number.isInteger(value) ? value : null;
  };

  const handleDropOnList = (e) => {
    e.preventDefault();
    setDragOverDay(false);
    const pinId = readDraggedPinId(e);
    if (pinId != null) handlePlace(pinId, activeDay);
  };

  const handleDropOnItem = (e, targetPinId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDay(false);
    const pinId = readDraggedPinId(e);
    if (pinId != null && pinId !== targetPinId) handlePlace(pinId, activeDay, targetPinId);
  };

  return (
    <div className="itinerary-panel">
      <div className="map-head">
        <h2>Itinerary</h2>
        <span className="map-hint">Drag a pin in, drag to reorder</span>
      </div>

      <div className="day-tabs">
        {days.map((day) => {
          const count = stops.filter((s) => s.day_number === day).length;
          return (
            <button
              key={day}
              type="button"
              className={`day-tab ${day === activeDay ? "active" : ""}`}
              onClick={() => setActiveDay(day)}
            >
              Day {day}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
        {dayCount < MAX_DAYS && (
          <button
            type="button"
            className="day-tab add-day"
            onClick={() => setDayCount((c) => Math.min(c + 1, MAX_DAYS))}
          >
            + Add day
          </button>
        )}
      </div>

      {error && <div className="error map-error">{error}</div>}

      {activeDayStops.length >= 2 && (
        <div className="day-summary">
          <span>
            <strong>{activeDayStops.length} stops</strong>
            {activeDaySummary
              ? ` · ${Number(activeDaySummary.distance_km).toFixed(1)} km · ~${activeDaySummary.duration_min} min walking`
              : " · not yet optimized"}
          </span>
          <button type="button" className="optimize-btn" onClick={handleOptimize} disabled={optimizing}>
            {optimizing ? "Optimizing…" : "Optimize route"}
          </button>
        </div>
      )}

      <div className="itinerary-layout">
        <ul
          className={`day-list ${dragOverDay ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverDay(true);
          }}
          onDragLeave={() => setDragOverDay(false)}
          onDrop={handleDropOnList}
        >
          {activeDayStops.length === 0 && (
            <li className="empty-slot">Drag a pin here to schedule it for Day {activeDay}</li>
          )}
          {activeDayStops.map((stop, i) => (
            <li
              key={stop.pin_id}
              className="itin-item"
              draggable
              onDragStart={(e) => handleDragStart(e, stop.pin_id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDropOnItem(e, stop.pin_id)}
            >
              <span className="order-num">{i + 1}</span>
              <span className="legend-dot" style={{ background: CATEGORY_META[stop.category].color }} />
              <span className="im-name">{stop.name}</span>
              <select
                className="day-select"
                value={activeDay}
                onChange={(e) => handlePlace(stop.pin_id, Number(e.target.value))}
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))}
              </select>
              <button type="button" className="im-remove" onClick={() => handleRemove(stop.pin_id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>

        <div className="itinerary-source">
          <div className="room-list-label">All pins</div>
          {rankedPins.length === 0 && (
            <p className="muted small-pad">No pins yet — add some on the map above.</p>
          )}
          {rankedPins.map((pin) => {
            const scheduledDay = stopDayByPin.get(pin.pin_id);
            return (
              <div
                key={pin.pin_id}
                className="voted-item"
                draggable
                onDragStart={(e) => handleDragStart(e, pin.pin_id)}
              >
                <span className="legend-dot" style={{ background: CATEGORY_META[pin.category].color }} />
                <span className="voted-name">{pin.name}</span>
                {scheduledDay ? (
                  <span className="code-badge">Day {scheduledDay}</span>
                ) : (
                  <span className="pin-votes-tag">{pin.vote_count} votes</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
