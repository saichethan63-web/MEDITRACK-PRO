// End-to-end smoke test. Start the server first, then run:  node test/smoke.js
// Uses the sample data (demo / demo1234, drsmith / doctor123) and creates its own temporary doctor.
const BASE = process.env.BASE || 'http://localhost:3000/api';
let passed = 0, failed = 0;

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  return { status: res.status, data };
}
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + ' ' + extra); }
}

(async () => {
  console.log('Auth');
  let r = await call('POST', '/auth/login', { username: 'demo', password: 'wrong' });
  check('wrong password -> 401', r.status === 401 && /Incorrect/.test(r.data.error));
  r = await call('POST', '/auth/login', { username: 'nobody', password: 'x' });
  check('unknown user -> 401', r.status === 401 && /not found/.test(r.data.error));
  r = await call('GET', '/patients');
  check('no token -> 401', r.status === 401);
  r = await call('GET', '/patients', null, 'garbage');
  check('bad token -> 401', r.status === 401);
  r = await call('POST', '/auth/login', { username: 'demo', password: 'demo1234' });
  check('demo login', r.status === 200 && r.data.token);
  const demo = r.data.token;
  r = await call('POST', '/auth/login', { username: 'drsmith', password: 'doctor123' });
  const smith = r.data.token;

  const uname = 'tester_' + Date.now();
  r = await call('POST', '/auth/register', { username: uname, password: 'abc' });
  check('short password rejected', r.status === 400);
  r = await call('POST', '/auth/register', { username: uname, password: 'abcd1234' });
  check('register', r.status === 201);
  r = await call('POST', '/auth/register', { username: uname.toUpperCase(), password: 'abcd1234' });
  check('duplicate username (case-insensitive) -> 409', r.status === 409);
  r = await call('POST', '/auth/login', { username: uname, password: 'abcd1234' });
  const tester = r.data.token;
  r = await call('GET', '/auth/me', null, tester);
  check('/me returns username', r.data.username === uname);

  console.log('Dashboard + list');
  r = await call('GET', '/dashboard', null, demo);
  check('dashboard stats', r.status === 200 && r.data.stats.totalPatients === 10 && r.data.stats.criticalPatients === 3, JSON.stringify(r.data.stats));
  check('dashboard recent = 5', r.data.recent.length === 5);
  r = await call('GET', '/patients', null, demo);
  check('demo has 10 patients', r.data.length === 10);
  const aarav = r.data.find((p) => p.name === 'Aarav Sharma');
  check('frontend shape (id, bpm, sugar, bloodPressure, status)',
    aarav.id === 'P100001' && aarav.bpm === 96 && aarav.sugar === 195 && aarav.bloodPressure === '142/92' && aarav.status === 'critical', JSON.stringify(aarav));
  check('allergies/meds joined', aarav.allergies === 'Penicillin' && aarav.medications === 'Metformin 500mg, Amlodipine 5mg');
  r = await call('GET', '/patients?status=critical', null, demo);
  check('status filter', r.data.length === 3 && r.data.every((p) => p.status === 'critical'));
  r = await call('GET', '/patients?search=diabetes', null, demo);
  check('search by latest condition', r.data.length === 1 && r.data[0].name === 'Meera Pillai', String(r.data.length));
  r = await call('GET', '/patients?search=p100003', null, demo);
  check('search by id (case-insensitive)', r.data.length === 1 && r.data[0].name === 'Rohan Mehta');
  r = await call('GET', "/patients?search=' OR '1'='1", null, demo);
  check('SQL injection attempt returns nothing', r.status === 200 && r.data.length === 0);
  r = await call('GET', '/patients?search=%25', null, demo);
  check('% is treated literally', r.status === 200 && r.data.length === 0);

  console.log('Isolation between doctors');
  r = await call('GET', '/patients', null, smith);
  check('drsmith sees only 2', r.data.length === 2);
  r = await call('GET', '/patients/P100001', null, smith);
  check("drsmith cannot read demo's patient", r.status === 404);
  r = await call('DELETE', '/patients/P100001', null, smith);
  check("drsmith cannot delete demo's patient", r.status === 404);
  r = await call('PUT', '/patients/P100001', { name: 'Hacked', dob: '1990-01-01', gender: 'Male' }, smith);
  check("drsmith cannot edit demo's patient", r.status === 404);

  console.log('Validation');
  const base = { name: 'Test Patient', dob: '1990-05-05', gender: 'Female' };
  r = await call('POST', '/patients', { ...base, name: '' }, tester);
  check('name required', r.status === 400);
  r = await call('POST', '/patients', { ...base, dob: '2999-01-01' }, tester);
  check('future DOB rejected', r.status === 400 && /future/.test(r.data.error));
  r = await call('POST', '/patients', { ...base, gender: 'x' }, tester);
  check('bad gender rejected', r.status === 400);
  r = await call('POST', '/patients', { ...base, bpm: 999 }, tester);
  check('heart rate out of range', r.status === 400);
  r = await call('POST', '/patients', { ...base, bpm: 'abc' }, tester);
  check('non-numeric heart rate', r.status === 400);
  r = await call('POST', '/patients', { ...base, bloodPressure: '80/120' }, tester);
  check('systolic <= diastolic rejected', r.status === 400);
  r = await call('POST', '/patients', { ...base, bloodPressure: 'high' }, tester);
  check('malformed BP rejected', r.status === 400);
  r = await call('POST', '/patients', { ...base, email: 'nope' }, tester);
  check('bad email rejected', r.status === 400);

  console.log('Create / read / edit / delete');
  r = await call('POST', '/patients', {
    ...base, phone: '+1 555', email: 'a@b.co', address: "O'Brien St", bpm: '72', sugar: '120', temp: '98.6',
    weight: '60', height: '165', bloodPressure: '120/80', complaints: 'Headache', condition: 'Migraine',
    allergies: 'Penicillin, pollen ; dust, PENICILLIN', medications: 'Paracetamol 500mg', history: 'None',
    notes: 'Rest',
  }, tester);
  check('create -> 201', r.status === 201, JSON.stringify(r.data));
  const p = r.data;
  check('code generated by trigger', /^P\d{6}$/.test(p.id), p.id);
  check('BMI + status computed by MySQL', p.bmi === 22 && p.bmiCategory === 'Normal weight' && p.status === 'stable', `${p.bmi} ${p.status}`);
  check('allergies de-duplicated', p.allergies === 'Penicillin, pollen, dust', p.allergies);
  check('quote in address preserved', p.address === "O'Brien St");
  check('one visit created', p.visits.length === 1 && p.visitCount === 1);

  r = await call('PUT', '/patients/' + p.id, { ...base, bpm: '130', sugar: '120', temp: '98.6', weight: '60', height: '165', bloodPressure: '135/90', allergies: 'Dust', newVisit: true }, tester);
  check('edit with newVisit=true adds a visit', r.data.visits.length === 2 && r.data.status === 'critical', JSON.stringify(r.data.visits.length));
  check('allergy list replaced', r.data.allergies === 'Dust');
  // (the next PUT sends no allergies, so the form semantics clear them)
  r = await call('PUT', '/patients/' + p.id, { ...base, bpm: '85', sugar: '120', temp: '98.6', weight: '60', height: '165', bloodPressure: '125/82', newVisit: false }, tester);
  check('edit with newVisit=false fixes latest visit', r.data.visits.length === 2 && r.data.bpm === 85 && r.data.status === 'stable');
  check('older visit untouched', r.data.visits[1].bpm === 72);

  r = await call('GET', '/backup/info', null, tester);
  check('backup info', r.data.recordCount === 1 && r.data.lastBackup === null && r.data.storageBytes > 100);

  console.log('Backup / restore');
  r = await call('GET', '/backup/export', null, tester);
  check('export includes visit history', r.status === 200 && r.data.totalRecords === 1 && r.data.patients[0].visits.length === 2);
  const exported = r.data;
  r = await call('POST', '/backup/auto', null, tester);
  check('auto backup (stored procedure)', r.status === 200 && r.data.recordCount === 1);
  r = await call('GET', '/backup/info', null, tester);
  check('last backup recorded', r.data.lastBackup !== null);

  r = await call('POST', '/backup/import', { patients: exported.patients, mode: 'merge' }, tester);
  check('merge import skips duplicates', r.data.imported === 0 && r.data.duplicates === 1, JSON.stringify(r.data));
  r = await call('POST', '/backup/import', { patients: exported.patients, mode: 'replace' }, tester);
  check('replace import restores', r.data.imported === 1, JSON.stringify(r.data));
  r = await call('GET', '/patients/' + p.id, null, tester);
  check('code + visit history survive round-trip', r.status === 200 && r.data.visits.length === 2 && r.data.allergies === '');

  // Legacy backup produced by the OLD localStorage frontend
  const legacyCode = 'P' + (600000 + Math.floor(Math.random() * 300000));
  const legacy = { patients: [
    { id: legacyCode, name: 'Legacy One', dob: '1970-01-01', gender: 'Male', phone: '', email: '', address: '', bpm: '60', sugar: '90',
      temp: '98.2', weight: '80', height: '180', bloodPressure: '118/76', complaints: 'old', condition: 'old', allergies: 'Nuts',
      medications: '', history: '', notes: '', lastVisit: '2025-03-01T10:00:00.000Z', age: 55 },
    { id: 'P555556', name: '', dob: '1970-01-01', gender: 'Male' },
    { id: 'P555557', name: 'Bad Vitals', dob: '1970-01-01', gender: 'Male', bpm: '9999' },
  ] };
  r = await call('POST', '/backup/import', { ...legacy, mode: 'merge' }, tester);
  check('legacy import: 1 ok, 2 invalid skipped', r.data.imported === 1 && r.data.invalid === 2, JSON.stringify(r.data));
  r = await call('GET', '/patients/' + legacyCode, null, tester);
  check('legacy code kept and visit dated from lastVisit', r.status === 200 && r.data.visits[0].date.startsWith('2025-03-01'));
  r = await call('POST', '/backup/import', { patients: 'nope' }, tester);
  check('bad import format -> 400', r.status === 400);

  console.log('New patient after import gets a non-colliding code');
  r = await call('POST', '/patients', base, tester);
  check('create after import', r.status === 201 && r.data.id !== legacyCode, r.data.id);

  console.log('Delete');
  r = await call('DELETE', '/patients/' + p.id, null, tester);
  check('delete', r.status === 200);
  r = await call('GET', '/patients/' + p.id, null, tester);
  check('deleted patient is gone', r.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
