const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireRoomMembership = require("../middleware/requireRoomMembership");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireRoomMembership);

/**
 * GET /api/rooms/:roomId/itinerary
 * Every scheduled stop in the room, across all days, with pin details
 * joined in, plus any day-level distance/duration summaries produced by
 * P5 (Optimize). A day only has a summary once it's been optimized.
 */
router.get("/", async (req, res) => {
  try {
    const stops = await pool.query(
      `SELECT s.stop_id, s.day_number, s.stop_order, p.pin_id, p.name, p.category,
              p.latitude, p.longitude, p.description
       FROM itinerary_stops s
       JOIN pins p ON p.pin_id = s.pin_id
       WHERE s.room_id = $1
       ORDER BY s.day_number ASC, s.stop_order ASC`,
      [req.roomId]
    );
    const days = await pool.query(
      `SELECT day_number, distance_km, duration_min, optimized_at
       FROM itinerary_days
       WHERE room_id = $1`,
      [req.roomId]
    );
    return res.json({ stops: stops.rows, days: days.rows });
  } catch (err) {
    console.error("list itinerary error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * PUT /api/rooms/:roomId/itinerary/stops/:pinId
 * Places a pin at a day + position in one step — covers adding it for the
 * first time, reordering it within a day, and moving it to a different day,
 * all through the same upsert. "Position" is expressed as "insert before
 * this other pin" (beforePinId), or end-of-day if omitted, and translated
 * into a fractional stop_order so existing rows never need renumbering.
 */
router.put("/stops/:pinId", async (req, res) => {
  const pinId = Number(req.params.pinId);
  const dayNumber = Number(req.body?.dayNumber);
  const beforePinId = req.body?.beforePinId != null ? Number(req.body.beforePinId) : null;

  if (!Number.isInteger(pinId)) {
    return res.status(400).json({ error: "Invalid pin id." });
  }
  if (!Number.isInteger(dayNumber) || dayNumber < 1) {
    return res.status(400).json({ error: "Invalid day number." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pinCheck = await client.query("SELECT pin_id FROM pins WHERE pin_id = $1 AND room_id = $2", [
      pinId,
      req.roomId,
    ]);
    if (!pinCheck.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pin not found in this room." });
    }

    const existingStop = await client.query(
      "SELECT day_number FROM itinerary_stops WHERE room_id = $1 AND pin_id = $2",
      [req.roomId, pinId]
    );
    const oldDay = existingStop.rows[0]?.day_number ?? null;

    // Current stops in the destination day, excluding the pin being placed
    // (relevant when it's already in this same day and just being reordered).
    const dayStops = await client.query(
      `SELECT pin_id, stop_order FROM itinerary_stops
       WHERE room_id = $1 AND day_number = $2 AND pin_id != $3
       ORDER BY stop_order ASC`,
      [req.roomId, dayNumber, pinId]
    );
    const rows = dayStops.rows;
    const targetIndex = beforePinId != null ? rows.findIndex((r) => r.pin_id === beforePinId) : -1;

    let newOrder;
    if (targetIndex === -1) {
      // No target, or the target wasn't found (e.g. stale client) — append.
      newOrder = rows.length ? Number(rows[rows.length - 1].stop_order) + 1 : 0;
    } else {
      const nextOrder = Number(rows[targetIndex].stop_order);
      const prevOrder = targetIndex > 0 ? Number(rows[targetIndex - 1].stop_order) : null;
      newOrder = prevOrder != null ? (prevOrder + nextOrder) / 2 : nextOrder - 1;
    }

    const upserted = await client.query(
      `INSERT INTO itinerary_stops (room_id, pin_id, day_number, stop_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, pin_id)
       DO UPDATE SET day_number = EXCLUDED.day_number, stop_order = EXCLUDED.stop_order
       RETURNING stop_id, day_number, stop_order`,
      [req.roomId, pinId, dayNumber, newOrder]
    );

    // Adding, moving, or reordering a stop invalidates any stored route for
    // every day it touched — a stale distance/time is worse than none.
    const affectedDays = [...new Set([oldDay, dayNumber].filter((d) => d != null))];
    if (affectedDays.length) {
      await client.query("DELETE FROM itinerary_days WHERE room_id = $1 AND day_number = ANY($2::int[])", [
        req.roomId,
        affectedDays,
      ]);
    }

    await client.query("COMMIT");
    return res.json({ stop: { ...upserted.rows[0], pin_id: pinId } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("place stop error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/rooms/:roomId/itinerary/stops/:pinId
 * Removes a pin from the itinerary entirely — it stays on the map/vote list.
 */
router.delete("/stops/:pinId", async (req, res) => {
  const pinId = Number(req.params.pinId);
  if (!Number.isInteger(pinId)) {
    return res.status(400).json({ error: "Invalid pin id." });
  }

  try {
    const existing = await pool.query(
      "SELECT day_number FROM itinerary_stops WHERE room_id = $1 AND pin_id = $2",
      [req.roomId, pinId]
    );
    await pool.query("DELETE FROM itinerary_stops WHERE room_id = $1 AND pin_id = $2", [req.roomId, pinId]);

    if (existing.rows[0]) {
      await pool.query("DELETE FROM itinerary_days WHERE room_id = $1 AND day_number = $2", [
        req.roomId,
        existing.rows[0].day_number,
      ]);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("remove stop error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

const WALKING_SPEED_KMH = 4.6;
const DISTANCE_SCALE = 0.09; // same placeholder scale used everywhere else on the map

function euclideanDistance(a, b) {
  return Math.hypot(Number(a.longitude) - Number(b.longitude), Number(a.latitude) - Number(b.latitude));
}

/**
 * POST /api/rooms/:roomId/itinerary/days/:dayNumber/optimize
 * Reorders a day's stops with a nearest-neighbor pass (starting from a
 * hotel stop if the day has one), estimates total distance/time, and
 * stores both. This is the one place a whole day's stop_order values get
 * renumbered together — safe here because it's one explicit, authoritative
 * action recomputing the full sequence, not an incremental drag.
 */
router.post("/days/:dayNumber/optimize", async (req, res) => {
  const dayNumber = Number(req.params.dayNumber);
  if (!Number.isInteger(dayNumber) || dayNumber < 1) {
    return res.status(400).json({ error: "Invalid day number." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const stopsResult = await client.query(
      `SELECT s.stop_id, p.pin_id, p.category, p.latitude, p.longitude
       FROM itinerary_stops s
       JOIN pins p ON p.pin_id = s.pin_id
       WHERE s.room_id = $1 AND s.day_number = $2
       ORDER BY s.stop_order ASC`,
      [req.roomId, dayNumber]
    );
    const stops = stopsResult.rows;

    if (stops.length < 2) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Add at least 2 stops to optimize a route." });
    }

    // Nearest-neighbor: start from a hotel stop if the day has one, else
    // wherever the list currently starts, then always hop to whichever
    // remaining stop is closest.
    const remaining = [...stops];
    const hotelIndex = remaining.findIndex((s) => s.category === "hotel");
    const ordered = remaining.splice(hotelIndex >= 0 ? hotelIndex : 0, 1);
    while (remaining.length) {
      const current = ordered[ordered.length - 1];
      let bestIndex = 0;
      let bestDist = Infinity;
      remaining.forEach((s, i) => {
        const d = euclideanDistance(current, s);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      });
      ordered.push(...remaining.splice(bestIndex, 1));
    }

    let rawDistance = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
      rawDistance += euclideanDistance(ordered[i], ordered[i + 1]);
    }
    const distanceKm = rawDistance * DISTANCE_SCALE;
    const durationMin = Math.round((distanceKm / WALKING_SPEED_KMH) * 60);

    for (let i = 0; i < ordered.length; i++) {
      await client.query("UPDATE itinerary_stops SET stop_order = $1 WHERE stop_id = $2", [i, ordered[i].stop_id]);
    }

    await client.query(
      `INSERT INTO itinerary_days (room_id, day_number, distance_km, duration_min, optimized_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (room_id, day_number)
       DO UPDATE SET distance_km = EXCLUDED.distance_km, duration_min = EXCLUDED.duration_min, optimized_at = now()`,
      [req.roomId, dayNumber, distanceKm, durationMin]
    );

    await client.query("COMMIT");
    return res.json({ distance_km: distanceKm, duration_min: durationMin });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("optimize route error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  } finally {
    client.release();
  }
});

module.exports = router;
