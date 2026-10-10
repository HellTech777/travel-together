const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireRoomMembership = require("../middleware/requireRoomMembership");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireRoomMembership);

const CATEGORIES = ["food", "hotel", "attraction"];

/**
 * GET /api/rooms/:roomId/pins
 * Every pin in this room, with its live vote count and whether the
 * signed-in member has voted for it — sorted most-voted first.
 */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.pin_id, p.name, p.category, p.latitude, p.longitude, p.description, p.created_at,
              (SELECT COUNT(*)::int FROM votes v WHERE v.pin_id = p.pin_id) AS vote_count,
              EXISTS(SELECT 1 FROM votes v WHERE v.pin_id = p.pin_id AND v.user_id = $2) AS has_voted
       FROM pins p
       WHERE p.room_id = $1
       ORDER BY vote_count DESC, p.created_at ASC`,
      [req.roomId, req.user.id]
    );
    return res.json({ pins: result.rows });
  } catch (err) {
    console.error("list pins error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/rooms/:roomId/pins
 * Pins a new place to this room's shared map.
 */
router.post("/", async (req, res) => {
  const { name, category, description, latitude, longitude } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Give the pin a name." });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Category must be food, hotel, or attraction." });
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Pin location is missing or invalid." });
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO pins (room_id, name, category, latitude, longitude, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING pin_id, name, category, latitude, longitude, description, created_at`,
      [req.roomId, name.trim(), category, lat, lng, (description || "").trim() || null, req.user.id]
    );
    const pin = inserted.rows[0];
    return res.status(201).json({ pin: { ...pin, vote_count: 0, has_voted: false } });
  } catch (err) {
    console.error("create pin error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/rooms/:roomId/pins/:pinId/vote
 * Toggles the signed-in member's vote: casts it if they hadn't voted,
 * retracts it if they had. Matches the "Vote Request [action]" flow from
 * the data dictionary, with the action inferred from current state.
 */
router.post("/:pinId/vote", async (req, res) => {
  const pinId = Number(req.params.pinId);
  if (!Number.isInteger(pinId)) {
    return res.status(400).json({ error: "Invalid pin id." });
  }

  try {
    const pinCheck = await pool.query("SELECT pin_id FROM pins WHERE pin_id = $1 AND room_id = $2", [
      pinId,
      req.roomId,
    ]);
    if (!pinCheck.rows.length) {
      return res.status(404).json({ error: "Pin not found in this room." });
    }

    const existing = await pool.query("SELECT 1 FROM votes WHERE pin_id = $1 AND user_id = $2", [
      pinId,
      req.user.id,
    ]);

    if (existing.rows.length) {
      await pool.query("DELETE FROM votes WHERE pin_id = $1 AND user_id = $2", [pinId, req.user.id]);
    } else {
      await pool.query("INSERT INTO votes (pin_id, user_id) VALUES ($1, $2)", [pinId, req.user.id]);
    }

    const result = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM votes WHERE pin_id = $1) AS vote_count,
              EXISTS(SELECT 1 FROM votes WHERE pin_id = $1 AND user_id = $2) AS has_voted`,
      [pinId, req.user.id]
    );
    return res.json({ pin_id: pinId, ...result.rows[0] });
  } catch (err) {
    console.error("toggle vote error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
