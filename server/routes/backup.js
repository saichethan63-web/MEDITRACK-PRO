const router = require('express').Router();
const { pool, withTransaction } = require('../db');
const { wrap, HttpError } = require('../errors');
const { requireAuth } = require('../auth');
const { toPatient, toVisit } = require('../mapper');
const { parsePatient, parseVisit } = require('../validate');
const repo = require('../patientRepo');

router.use(requireAuth);

/** Whole practice as JSON (patients in the frontend shape + their visit history). */
async function buildExport(doctorId) {
  const [patients] = await pool.query(
    'SELECT * FROM v_patient_overview WHERE doctor_id = ? ORDER BY patient_id', [doctorId]);
  const [visits] = await pool.query(
    'SELECT * FROM v_visit_history WHERE doctor_id = ? ORDER BY visit_date, visit_id', [doctorId]);
  const byPatient = new Map();
  for (const v of visits) {
    if (!byPatient.has(v.patient_id)) byPatient.set(v.patient_id, []);
    byPatient.get(v.patient_id).push(toVisit(v));
  }
  return patients.map((p) => ({ ...toPatient(p), visits: byPatient.get(p.patient_id) || [] }));
}

// GET /api/backup/info  -> Backup Information panel
router.get('/info', wrap(async (req, res) => {
  const exported = await buildExport(req.doctor.id);
  const [[last]] = await pool.query(
    'SELECT MAX(created_at) AS last_backup FROM backup_log WHERE doctor_id = ?', [req.doctor.id]);
  res.json({
    recordCount: exported.length,
    lastBackup: last.last_backup,
    storageBytes: Buffer.byteLength(JSON.stringify(exported)),
  });
}));

// GET /api/backup/export  -> JSON file download
router.get('/export', wrap(async (req, res) => {
  const patients = await buildExport(req.doctor.id);
  if (!patients.length) throw new HttpError(400, 'No patient records to export!');
  await pool.query(
    "INSERT INTO backup_log (doctor_id, backup_type, record_count) VALUES (?, 'export', ?)",
    [req.doctor.id, patients.length]);
  res.json({
    exportDate: new Date().toISOString(),
    doctor: req.doctor.username,
    totalRecords: patients.length,
    patients,
  });
}));

// POST /api/backup/auto  -> snapshot stored inside MySQL (stored procedure)
router.post('/auto', wrap(async (req, res) => {
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM patients WHERE doctor_id = ?', [req.doctor.id]);
  if (!c.n) throw new HttpError(400, 'No patients to backup!');
  const [sets] = await pool.query('CALL sp_create_backup_snapshot(?)', [req.doctor.id]);
  res.json({ snapshotId: sets[0][0].snapshot_id, recordCount: sets[0][0].record_count });
}));

/** One imported record -> validated patient + a list of visits (handles old localStorage backups too). */
function normalizeImported(p) {
  const parsed = parsePatient(p);
  let visits;
  if (Array.isArray(p.visits) && p.visits.length) {
    visits = p.visits.map((v) => ({ date: v.date, data: parseVisit(v) }));
  } else {
    // Old frontend backup: vitals were stored directly on the patient
    visits = [{ date: p.lastVisit, data: parsed.visit }];
  }
  visits.forEach((v) => {
    const d = v.date ? new Date(v.date) : null;
    v.date = d && !Number.isNaN(d.getTime()) ? d : null; // null -> NOW()
  });
  visits.sort((a, b) => (a.date || Infinity) - (b.date || Infinity));
  const code = /^P\d{4,10}$/.test(String(p.id || '')) ? String(p.id) : null;
  return { ...parsed, visits, code };
}

// POST /api/backup/import   body: { patients: [...], mode: 'merge' | 'replace' }
router.post('/import', wrap(async (req, res) => {
  const { patients, mode } = req.body || {};
  if (!Array.isArray(patients)) throw new HttpError(400, 'Invalid backup file format!');
  if (patients.length > 5000) throw new HttpError(400, 'Backup has too many records (max 5000)');
  const replace = mode === 'replace';

  const result = await withTransaction(async (conn) => {
    if (replace) await conn.query('DELETE FROM patients WHERE doctor_id = ?', [req.doctor.id]);
    let imported = 0, duplicates = 0, invalid = 0;

    for (const raw of patients) {
      let rec;
      try { rec = normalizeImported(raw); } catch (e) { invalid++; continue; }

      let code = rec.code;
      if (code) {
        const [[existing]] = await conn.query('SELECT doctor_id FROM patients WHERE patient_code = ?', [code]);
        if (existing && existing.doctor_id === req.doctor.id) { duplicates++; continue; }
        if (existing) code = null; // belongs to another doctor: get a fresh code
      }

      await conn.query('SAVEPOINT import_one');
      try {
        const { patientId } = await repo.insertPatient(conn, req.doctor.id, rec.patient, code);
        await repo.replaceLists(conn, patientId, rec.allergies, rec.medications);
        for (const v of rec.visits) await repo.addVisit(conn, req.doctor.id, patientId, v.data, v.date);
        imported++;
      } catch (e) {
        await conn.query('ROLLBACK TO SAVEPOINT import_one');
        invalid++;
      }
    }
    await conn.query(
      "INSERT INTO backup_log (doctor_id, backup_type, record_count) VALUES (?, 'import', ?)",
      [req.doctor.id, imported]);
    return { imported, duplicates, invalid };
  });
  res.json(result);
}));

module.exports = router;
