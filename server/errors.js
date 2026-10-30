class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps async route handlers so rejected promises reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Translate MySQL errors into friendly HTTP responses.
function errorMiddleware(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });

  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists' });
  if (err.errno === 3819) return res.status(400).json({ error: 'A value is outside the allowed medical range (check vitals and blood pressure)' });
  if (err.errno === 1644) return res.status(400).json({ error: err.sqlMessage }); // SIGNAL from triggers/procedures
  if (err.code === 'ER_DATA_TOO_LONG') return res.status(400).json({ error: 'One of the fields is too long' });

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { HttpError, wrap, errorMiddleware };
