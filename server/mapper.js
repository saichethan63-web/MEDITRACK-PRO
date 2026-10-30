// Converts between DB rows (snake_case) and the object shape the frontend
// already uses (id, name, bpm, sugar, bloodPressure, ...).

const bp = (sys, dia) => (sys != null && dia != null ? `${sys}/${dia}` : '');

function toPatient(r) {
  return {
    id: r.patient_code,
    name: r.full_name,
    dob: r.date_of_birth,
    age: r.age,
    gender: r.gender,
    phone: r.phone || '',
    email: r.email || '',
    address: r.address || '',
    bpm: r.heart_rate,
    sugar: r.blood_sugar,
    temp: r.temperature_f,
    weight: r.weight_kg,
    height: r.height_cm,
    bloodPressure: bp(r.bp_systolic, r.bp_diastolic),
    bmi: r.bmi,
    bmiCategory: r.bmi_category,
    complaints: r.chief_complaints || '',
    condition: r.current_condition || '',
    allergies: r.allergies || '',
    medications: r.medications || '',
    history: r.medical_history || '',
    notes: r.doctors_notes || '',
    status: r.status,
    visitCount: r.visit_count,
    lastVisit: r.last_visit_at,
  };
}

function toVisit(r) {
  return {
    id: r.visit_id,
    date: r.visit_date,
    bpm: r.heart_rate,
    sugar: r.blood_sugar,
    temp: r.temperature_f,
    weight: r.weight_kg,
    height: r.height_cm,
    bloodPressure: bp(r.bp_systolic, r.bp_diastolic),
    bmi: r.bmi,
    status: r.status,
    complaints: r.chief_complaints || '',
    condition: r.current_condition || '',
    notes: r.doctors_notes || '',
  };
}

module.exports = { toPatient, toVisit };
