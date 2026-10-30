const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { wrap, HttpError } = require('../errors');
const { signToken, requireAuth } = require('../auth');

// Very small in-memory brute-force guard: N failed logins / 15 min per IP (default 10).
const fails = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 10);
function tooManyFails(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  fails.set(ip, list);
  return list.length >= MAX_FAILS;
}
const recordFail = (ip) => fails.set(ip, [...(fails.get(ip) || []), Date.now()]);

// POST /api/auth/register
router.post('/register', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) throw new HttpError(400, 'Please fill in all fields');
  if (username.length > 50) throw new HttpError(400, 'Username must be at most 50 characters');
  if (password.length < 4) throw new HttpError(400, 'Password must be at least 4 characters!');
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query('INSERT INTO doctors (username, password_hash) VALUES (?, ?)', [username, hash]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Username already exists! Please choose another.');
    throw e;
  }
  res.status(201).json({ ok: true });
}));

// POST /api/auth/login
router.post('/login', wrap(async (req, res) => {
  if (tooManyFails(req.ip)) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) throw new HttpError(400, 'Please enter both username and password');

  const [rows] = await pool.query('SELECT * FROM doctors WHERE username = ?', [username]);
  if (!rows.length) { recordFail(req.ip); throw new HttpError(401, 'Username not found. Please register first.'); }
  if (!(await bcrypt.compare(password, rows[0].password_hash))) {
    recordFail(req.ip);
    throw new HttpError(401, 'Incorrect password!');
  }
  await pool.query('UPDATE doctors SET last_login_at = NOW() WHERE doctor_id = ?', [rows[0].doctor_id]);
  res.json({ token: signToken(rows[0]), user: { username: rows[0].username } });
}));

// GET /api/auth/me
router.get('/me', requireAuth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT username FROM doctors WHERE doctor_id = ?', [req.doctor.id]);
  if (!rows.length) throw new HttpError(401, 'Account no longer exists');
  res.json({ username: rows[0].username });
}));

module.exports = router;
