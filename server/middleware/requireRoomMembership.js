const pool = require("../db/pool");

/**
 * Runs after requireAuth. Confirms req.user belongs to the room named in
 * the URL (:roomId) before letting a request touch that room's pins, votes,
 * chat, or itinerary — this is what keeps one room's data from leaking to
 * someone who was never invited to it.
 */
module.exports = async function requireRoomMembership(req, res, next) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId)) {
    return res.status(400).json({ error: "Invalid room id." });
  }

  try {
    const result = await pool.query(
      "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(403).json({ error: "You're not a member of this room." });
    }
    req.roomId = roomId;
    return next();
  } catch (err) {
    console.error("room membership check error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
