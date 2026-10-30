// MySQL connection pool shared by all routes.
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'meditrack_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'meditrack',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',            // DATETIME values are treated as UTC
  decimalNumbers: true,     // DECIMAL columns come back as numbers, not strings
  dateStrings: ['DATE'],    // date_of_birth stays 'YYYY-MM-DD'
});

// Make NOW()/CURRENT_TIMESTAMP behave in UTC on every connection.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

/** Run fn(conn) inside a transaction; commits on success, rolls back on error. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
