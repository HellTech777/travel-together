const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireRoomMembership = require("../middleware/requireRoomMembership");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireRoomMembership);

const HISTORY_LIMIT = 50;

/**
 * GET /api/rooms/:roomId/messages
 * The most recent messages in this room, oldest first, with the sender's
 * name joined in so the client doesn't need a separate lookup.
 */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.message_id, m.room_id, m.user_id, m.message_text, m.created_at, u.name AS sender_name
       FROM messages m
       JOIN users u ON u.user_id = m.user_id
       WHERE m.room_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [req.roomId, HISTORY_LIMIT]
    );
    return res.json({ messages: result.rows.reverse() });
  } catch (err) {
    console.error("list messages error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
