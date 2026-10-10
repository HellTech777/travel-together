const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth); // every room route requires a signed-in member

// Excludes 0/O/1/I/L so a code is easy to read aloud or type from memory.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * POST /api/rooms
 * Creates a room and makes the creator its first member, in one transaction.
 */
router.post("/", async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Give your trip a name." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let room = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const code = generateCode();
      const result = await client.query(
        `INSERT INTO rooms (name, join_code, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (join_code) DO NOTHING
         RETURNING room_id, name, join_code, created_at`,
        [name.trim(), code, req.user.id]
      );
      if (result.rows.length) room = result.rows[0];
    }

    if (!room) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Couldn't generate a room code. Please try again." });
    }

    await client.query("INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)", [
      room.room_id,
      req.user.id,
    ]);

    await client.query("COMMIT");
    return res.status(201).json({ room });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("create room error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/rooms/join
 * Looks a room up by its join code and adds the member. Joining a room
 * you're already in is harmless (ON CONFLICT DO NOTHING).
 */
router.post("/join", async (req, res) => {
  const { joinCode } = req.body || {};
  if (!joinCode || !joinCode.trim()) {
    return res.status(400).json({ error: "Enter a room code." });
  }

  try {
    const roomResult = await pool.query(
      "SELECT room_id, name, join_code, created_at FROM rooms WHERE join_code = $1",
      [joinCode.trim().toUpperCase()]
    );
    const room = roomResult.rows[0];
    if (!room) {
      return res.status(404).json({ error: "No room found with that code." });
    }

    await pool.query(
      `INSERT INTO room_members (room_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.room_id, req.user.id]
    );

    return res.json({ room });
  } catch (err) {
    console.error("join room error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/rooms/mine
 * Every room the signed-in member belongs to, most recent first.
 */
router.get("/mine", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.room_id, r.name, r.join_code, r.created_at
       FROM rooms r
       JOIN room_members m ON m.room_id = r.room_id
       WHERE m.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    return res.json({ rooms: result.rows });
  } catch (err) {
    console.error("list rooms error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/rooms/:roomId
 * One room's details \u2014 only returned if the signed-in member actually
 * belongs to it, so this also acts as an access check for the room board.
 */
router.get("/:roomId", async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId)) {
    return res.status(400).json({ error: "Invalid room id." });
  }

  try {
    const result = await pool.query(
      `SELECT r.room_id, r.name, r.join_code, r.created_at,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.room_id) AS member_count
       FROM rooms r
       JOIN room_members m ON m.room_id = r.room_id
       WHERE r.room_id = $1 AND m.user_id = $2`,
      [roomId, req.user.id]
    );
    const room = result.rows[0];
    if (!room) {
      return res.status(404).json({ error: "Room not found, or you're not a member." });
    }
    return res.json({ room });
  } catch (err) {
    console.error("get room error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
