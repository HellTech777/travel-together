const cookie = require("cookie");
const pool = require("../db/pool");
const verifySessionToken = require("../auth/verifySession");

const MAX_MESSAGE_LENGTH = 500;

module.exports = function registerChatSocket(io) {
  // Runs once per connection, before any events are handled: reads the same
  // httpOnly session cookie the REST API uses, straight off the raw
  // handshake headers (Socket.io connections don't go through Express's
  // cookie-parser middleware).
  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie || "");
      const user = await verifySessionToken(cookies.session_token);
      if (!user) return next(new Error("unauthorized"));
      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    /**
     * join_room: confirms membership, then moves the socket into that
     * room's channel (leaving any other room it was previously in, so a
     * member only ever receives messages for the room they're viewing).
     */
    socket.on("join_room", async (roomId, ack) => {
      const id = Number(roomId);
      if (!Number.isInteger(id)) {
        return typeof ack === "function" && ack({ error: "Invalid room id." });
      }

      try {
        const membership = await pool.query(
          "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
          [id, socket.user.id]
        );
        if (!membership.rows.length) {
          return typeof ack === "function" && ack({ error: "You're not a member of this room." });
        }

        [...socket.rooms].forEach((joinedRoom) => {
          if (joinedRoom !== socket.id) socket.leave(joinedRoom);
        });
        socket.join(String(id));
        socket.currentRoomId = id;

        return typeof ack === "function" && ack({ ok: true });
      } catch (err) {
        console.error("join_room error:", err);
        return typeof ack === "function" && ack({ error: "Something went wrong. Please try again." });
      }
    });

    /**
     * send_message: persists to D3 Chat log, then broadcasts to everyone
     * currently in that room's channel, including the sender — so every
     * client renders new messages the same way, from the same event.
     */
    socket.on("send_message", async (payload, ack) => {
      const { roomId, text } = payload || {};
      const id = Number(roomId);
      const trimmed = (text || "").trim();

      if (!Number.isInteger(id) || socket.currentRoomId !== id) {
        return typeof ack === "function" && ack({ error: "Join the room before sending messages." });
      }
      if (!trimmed) {
        return typeof ack === "function" && ack({ error: "Message can't be empty." });
      }
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        return typeof ack === "function" && ack({ error: "Message is too long." });
      }

      try {
        const inserted = await pool.query(
          `INSERT INTO messages (room_id, user_id, message_text)
           VALUES ($1, $2, $3)
           RETURNING message_id, room_id, user_id, message_text, created_at`,
          [id, socket.user.id, trimmed]
        );
        const message = { ...inserted.rows[0], sender_name: socket.user.name };

        io.to(String(id)).emit("new_message", message);
        return typeof ack === "function" && ack({ ok: true });
      } catch (err) {
        console.error("send_message error:", err);
        return typeof ack === "function" && ack({ error: "Something went wrong. Please try again." });
      }
    });

    /**
     * typing: a lightweight, non-persisted signal — broadcast to everyone
     * else in the room (not back to the sender) so a "so-and-so is typing"
     * indicator can show elsewhere.
     */
    socket.on("typing", ({ roomId } = {}) => {
      const id = Number(roomId);
      if (!Number.isInteger(id) || socket.currentRoomId !== id) return;
      socket.to(String(id)).emit("user_typing", { name: socket.user.name });
    });
  });
};
