const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { HttpError } = require('./errors');

let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(48).toString('hex');
  console.warn('[warn] JWT_SECRET is not set - using a random one. Everyone is logged out on every restart.');
}

const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

const signToken = (doctor) =>
  jwt.sign({ id: doctor.doctor_id, username: doctor.username }, secret, { expiresIn });

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please sign in'));
  try {
    const payload = jwt.verify(token, secret);
    req.doctor = { id: payload.id, username: payload.username };
    next();
  } catch (e) {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
}

module.exports = { signToken, requireAuth };
