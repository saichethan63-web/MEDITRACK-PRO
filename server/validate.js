// Input validation / normalisation for patient payloads.
const { HttpError } = require('./errors');

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

function num(value, label, { min, max, integer = false }) {
  if (isBlank(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number`);
  if (n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}`);
  return n;
}

function text(value, label, maxLen, { required = false } = {}) {
  const s = isBlank(value) ? '' : String(value).trim();
  if (required && !s) throw new HttpError(400, `${label} is required`);
  if (s.length > maxLen) throw new HttpError(400, `${label} must be at most ${maxLen} characters`);
  return s || null;
}

function parseBP(value) {
  if (isBlank(value)) return { sys: null, dia: null };
  const m = String(value).trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!m) throw new HttpError(400, 'Blood pressure must look like 120/80');
  const sys = Number(m[1]);
  const dia = Number(m[2]);
  if (sys <= dia) throw new HttpError(400, 'Systolic pressure must be higher than diastolic');
  if (sys < 40 || sys > 300 || dia < 20 || dia > 200) throw new HttpError(400, 'Blood pressure is outside the allowed range');
  return { sys, dia };
}

/** "Penicillin, Pollen; Dust" -> ['Penicillin','Pollen','Dust'] (case-insensitive de-dupe). */
function splitList(value, label, maxLen) {
  if (isBlank(value)) return [];
  const parts = Array.isArray(value) ? value : String(value).split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const raw of parts) {
    const item = String(raw).trim();
    if (!item) continue;
    if (item.length > maxLen) throw new HttpError(400, `Each ${label} must be at most ${maxLen} characters`);
    const key = item.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  }
  return out;
}

function parseDob(value) {
  if (isBlank(value)) throw new HttpError(400, 'Date of birth is required');
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, 'Date of birth is not a valid date');
  if (s > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Date of birth cannot be in the future');
  return s;
}

/** Vitals + visit notes from a form body or an imported visit record. */
function parseVisit(b) {
  const { sys, dia } = parseBP(b.bloodPressure);
  return {
    heart_rate: num(b.bpm, 'Heart rate', { min: 20, max: 300, integer: true }),
    blood_sugar: num(b.sugar, 'Blood sugar', { min: 0, max: 1000, integer: true }),
    temperature_f: num(b.temp, 'Temperature', { min: 80, max: 115 }),
    weight_kg: num(b.weight, 'Weight', { min: 0.1, max: 700 }),
    height_cm: num(b.height, 'Height', { min: 1, max: 300 }),
    bp_systolic: sys,
    bp_diastolic: dia,
    chief_complaints: text(b.complaints, 'Chief complaints', 20000),
    current_condition: text(b.condition, 'Current condition', 20000),
    doctors_notes: text(b.notes, "Doctor's notes", 20000),
  };
}

/** Validates the body sent by the "Add / Edit patient" form (or one imported record). */
function parsePatient(b) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Missing patient data');
  const gender = ['Male', 'Female', 'Other'].includes(b.gender) ? b.gender : null;
  if (!gender) throw new HttpError(400, 'Gender must be Male, Female or Other');
  const email = text(b.email, 'Email', 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email address is not valid');

  return {
    patient: {
      full_name: text(b.name, 'Full name', 120, { required: true }),
      date_of_birth: parseDob(b.dob),
      gender,
      phone: text(b.phone, 'Phone', 30),
      email,
      address: text(b.address, 'Address', 255),
      medical_history: text(b.history, 'Medical history', 20000),
    },
    allergies: splitList(b.allergies, 'allergy', 100),
    medications: splitList(b.medications, 'medication', 150),
    visit: parseVisit(b),
  };
}

module.exports = { parsePatient, parseVisit, splitList, isBlank };
