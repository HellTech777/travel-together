const verifySessionToken = require("../auth/verifySession");

/**
 * Verifies the session_token cookie via the shared helper (JWT check, plus
 * a cross-check that it still matches the token stored on the user's row).
 */
module.exports = async function requireAuth(req, res, next) {
  const token = req.cookies?.session_token;
  if (!token) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }

  const user = await verifySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }

  req.user = user;
  return next();
};
