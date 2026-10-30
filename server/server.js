require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const { errorMiddleware } = require('./errors');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

// Basic security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch (e) { res.status(500).json({ ok: false, database: 'unreachable' }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// The frontend (public/index.html) is served by the same server.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(errorMiddleware);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`MediTrack Pro running at http://localhost:${port}`));
