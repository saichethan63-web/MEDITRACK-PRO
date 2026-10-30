const router = require('express').Router();
const { pool, withTransaction } = require('../db');
const { wrap, HttpError } = require('../errors');
const { requireAuth } = require('../auth');
const { toPatient, toVisit } = require('../mapper');
const { parsePatient } = require('../validate');
const repo = require('../patientRepo');

router.use(requireAuth);

// GET /api/patients?search=&status=all|critical|monitoring|stable
router.get('/', wrap(async (req, res) => {
  const search = String(req.query.search || '').slice(0, 100);
  const status = ['critical', 'monitoring', 'stable'].includes(req.query.status) ? req.query.status : 'all';
  const [sets] = await pool.query('CALL sp_search_patients(?, ?, ?)', [req.doctor.id, search, status]);
  res.json(sets[0].map(toPatient));
}));

async function loadPatient(code, doctorId) {
  const [rows] = await pool.query(
    'SELECT * FROM v_patient_overview WHERE patient_code = ? AND doctor_id = ?', [code, doctorId]);
  if (!rows.length) throw new HttpError(404, 'Patient not found');
  const [visits] = await pool.query(
    'SELECT * FROM v_visit_history WHERE patient_id = ? ORDER BY visit_date DESC, visit_id DESC',
    [rows[0].patient_id]);
  return { ...toPatient(rows[0]), visits: visits.map(toVisit) };
}

// GET /api/patients/:code  (includes visit history)
router.get('/:code', wrap(async (req, res) => {
  res.json(await loadPatient(req.params.code, req.doctor.id));
}));

// POST /api/patients
router.post('/', wrap(async (req, res) => {
  const data = parsePatient(req.body);
  const code = await withTransaction(async (conn) => {
    const { patientId, code } = await repo.insertPatient(conn, req.doctor.id, data.patient);
    await repo.replaceLists(conn, patientId, data.allergies, data.medications);
    await repo.addVisit(conn, req.doctor.id, patientId, data.visit);
    return code;
  });
  res.status(201).json(await loadPatient(code, req.doctor.id));
}));

// PUT /api/patients/:code   body.newVisit = true -> add a visit row, false -> fix the latest one
router.put('/:code', wrap(async (req, res) => {
  const data = parsePatient(req.body);
  const newVisit = req.body.newVisit !== false;
  await withTransaction(async (conn) => {
    const patientId = await repo.findOwnedPatientId(conn, req.params.code, req.doctor.id, { lock: true });
    if (!patientId) throw new HttpError(404, 'Patient not found');
    await repo.updatePatient(conn, patientId, data.patient);
    await repo.replaceLists(conn, patientId, data.allergies, data.medications);
    if (newVisit) {
      await repo.addVisit(conn, req.doctor.id, patientId, data.visit);
    } else if (!(await repo.updateLatestVisit(conn, patientId, data.visit))) {
      await repo.addVisit(conn, req.doctor.id, patientId, data.visit);
    }
  });
  res.json(await loadPatient(req.params.code, req.doctor.id));
}));

// DELETE /api/patients/:code  (visits, allergies, medications cascade)
router.delete('/:code', wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM patients WHERE patient_code = ? AND doctor_id = ?',
    [req.params.code, req.doctor.id]);
  if (!r.affectedRows) throw new HttpError(404, 'Patient not found');
  res.json({ ok: true });
}));

module.exports = router;
