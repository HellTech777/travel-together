const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

/**
 * Verifies a session_token the same way everywhere it's checked: the JWT
 * signature/expiry, then a cross-check against the token stored on the
 * user's row in D1 Users (so a logout invalidates it immediately, on every
 * connection type). Used by requireAuth (HTTP, reads the cookie via
 * cookie-parser) and by the Socket.io handshake (reads the same cookie
 * straight off the raw request headers).
 *
 * Returns the public user object, or null if the token is missing/invalid.
 */
async function verifySessionToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      "SELECT user_id, name, email, session_token FROM users WHERE user_id = $1",
      [payload.id]
    );
    const user = result.rows[0];
    if (!user || user.session_token !== token) return null;
    return { id: user.user_id, name: user.name, email: user.email };
  } catch (err) {
    return null;
  }
}

module.exports = verifySessionToken;
