const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 12;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function signToken(user) {
  return jwt.sign(
    { id: user.user_id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function publicUser(user) {
  return { id: user.user_id, name: user.name, email: user.email };
}

/**
 * POST /api/auth/register
 * Field validation -> duplicate-email check -> hash password -> create user -> session
 */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are all required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const existing = await pool.query("SELECT user_id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const inserted = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id, name, email`,
      [name.trim(), email.toLowerCase().trim(), passwordHash]
    );
    const user = inserted.rows[0];

    const token = signToken(user);
    await pool.query("UPDATE users SET session_token = $1 WHERE user_id = $2", [token, user.user_id]);

    res.cookie("session_token", token, COOKIE_OPTIONS);
    return res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/auth/login
 * SELECT by email -> compare password hash -> create session
 * Uses one generic error message for "no such user" and "wrong password" so the
 * response never reveals whether an email address is registered.
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Enter your email and password." });
  }

  const invalidCredentials = () => res.status(401).json({ error: "Incorrect email or password." });

  try {
    const result = await pool.query(
      "SELECT user_id, name, email, password_hash FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];
    if (!user) return invalidCredentials();

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) return invalidCredentials();

    const token = signToken(user);
    await pool.query("UPDATE users SET session_token = $1 WHERE user_id = $2", [token, user.user_id]);

    res.cookie("session_token", token, COOKIE_OPTIONS);
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/auth/logout
 * Clears the session both in the database and the browser cookie.
 */
router.post("/logout", requireAuth, async (req, res) => {
  try {
    await pool.query("UPDATE users SET session_token = NULL WHERE user_id = $1", [req.user.id]);
    res.clearCookie("session_token", COOKIE_OPTIONS);
    return res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/auth/me
 * Lets the frontend check "am I still signed in?" on page load/refresh.
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
