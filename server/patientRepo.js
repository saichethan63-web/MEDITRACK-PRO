// Shared DB helpers used by the patient and backup routes.
// Every function takes a connection so callers control the transaction.

async function findOwnedPatientId(conn, code, doctorId, { lock = false } = {}) {
  const [rows] = await conn.query(
    `SELECT patient_id FROM patients WHERE patient_code = ? AND doctor_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [code, doctorId]
  );
  return rows.length ? rows[0].patient_id : null;
}

/** Insert the patients row; the trigger fills patient_code unless one is supplied. */
async function insertPatient(conn, doctorId, p, code = null) {
  const [res] = await conn.query(
    `INSERT INTO patients
       (patient_code, doctor_id, full_name, date_of_birth, gender, phone, email, address, medical_history)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, doctorId, p.full_name, p.date_of_birth, p.gender, p.phone, p.email, p.address, p.medical_history]
  );
  const [[row]] = await conn.query('SELECT patient_code FROM patients WHERE patient_id = ?', [res.insertId]);
  return { patientId: res.insertId, code: row.patient_code };
}

async function updatePatient(conn, patientId, p) {
  await conn.query(
    `UPDATE patients SET full_name = ?, date_of_birth = ?, gender = ?, phone = ?, email = ?,
                         address = ?, medical_history = ?
     WHERE patient_id = ?`,
    [p.full_name, p.date_of_birth, p.gender, p.phone, p.email, p.address, p.medical_history, patientId]
  );
}

/** Replace the allergy and medication lists of a patient. */
async function replaceLists(conn, patientId, allergies, medications) {
  await conn.query('DELETE FROM patient_allergies WHERE patient_id = ?', [patientId]);
  await conn.query('DELETE FROM patient_medications WHERE patient_id = ?', [patientId]);
  if (allergies.length) {
    await conn.query('INSERT INTO patient_allergies (patient_id, allergen) VALUES ?',
      [allergies.map((a) => [patientId, a])]);
  }
  if (medications.length) {
    await conn.query('INSERT INTO patient_medications (patient_id, medication) VALUES ?',
      [medications.map((m) => [patientId, m])]);
  }
}

/** New visit through the stored procedure (it re-checks ownership). */
async function addVisit(conn, doctorId, patientId, v, visitDate = null) {
  const [rows] = await conn.query('CALL sp_add_visit(?,?,?,?,?,?,?,?,?,?,?,?,?)', [
    doctorId, patientId,
    v.heart_rate, v.blood_sugar, v.temperature_f, v.weight_kg, v.height_cm,
    v.bp_systolic, v.bp_diastolic,
    v.chief_complaints, v.current_condition, v.doctors_notes,
    visitDate,
  ]);
  return rows[0][0].visit_id;
}

/** Overwrite the most recent visit (used when the doctor is only fixing a typo). */
async function updateLatestVisit(conn, patientId, v) {
  const [[latest]] = await conn.query(
    'SELECT visit_id FROM visits WHERE patient_id = ? ORDER BY visit_date DESC, visit_id DESC LIMIT 1',
    [patientId]
  );
  if (!latest) return null;
  await conn.query(
    `UPDATE visits SET heart_rate = ?, blood_sugar = ?, temperature_f = ?, weight_kg = ?, height_cm = ?,
                       bp_systolic = ?, bp_diastolic = ?, chief_complaints = ?, current_condition = ?,
                       doctors_notes = ?
     WHERE visit_id = ?`,
    [v.heart_rate, v.blood_sugar, v.temperature_f, v.weight_kg, v.height_cm,
     v.bp_systolic, v.bp_diastolic, v.chief_complaints, v.current_condition, v.doctors_notes,
     latest.visit_id]
  );
  return latest.visit_id;
}

module.exports = { findOwnedPatientId, insertPatient, updatePatient, replaceLists, addVisit, updateLatestVisit };
