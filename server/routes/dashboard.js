const router = require('express').Router();
const { pool } = require('../db');
const { wrap } = require('../errors');
const { requireAuth } = require('../auth');
const { toPatient } = require('../mapper');

// GET /api/dashboard -> the four stat cards + 5 most recently seen patients
router.get('/', requireAuth, wrap(async (req, res) => {
  const [sets] = await pool.query('CALL sp_dashboard_stats(?)', [req.doctor.id]);
  const s = sets[0][0];
  const [recent] = await pool.query(
    'SELECT * FROM v_patient_overview WHERE doctor_id = ? ORDER BY last_visit_at DESC LIMIT 5',
    [req.doctor.id]);
  res.json({
    stats: {
      totalPatients: Number(s.total_patients),
      activePatients: Number(s.active_patients),
      criticalPatients: Number(s.critical_patients),
      todaysVisits: Number(s.todays_visits),
    },
    recent: recent.map(toPatient),
  });
}));

module.exports = router;
