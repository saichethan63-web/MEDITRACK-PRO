-- ============================================================
-- MediTrack Pro  |  02_views.sql
-- ============================================================
USE meditrack;

-- ------------------------------------------------------------
-- Most recent visit of every patient
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_latest_visit AS
SELECT *
FROM (
  SELECT v.*,
         ROW_NUMBER() OVER (
           PARTITION BY v.patient_id
           ORDER BY v.visit_date DESC, v.visit_id DESC
         ) AS rn
  FROM visits v
) ranked
WHERE rn = 1;

-- ------------------------------------------------------------
-- One row per patient = everything the Patients grid / modal shows
-- (personal info + latest vitals + allergies + medications + status)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_patient_overview AS
SELECT
  p.patient_id,
  p.patient_code,
  p.doctor_id,
  p.full_name,
  p.date_of_birth,
  TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE())                AS age,
  p.gender,
  p.phone,
  p.email,
  p.address,
  p.medical_history,
  (SELECT GROUP_CONCAT(a.allergen ORDER BY a.allergy_id SEPARATOR ', ')
     FROM patient_allergies a WHERE a.patient_id = p.patient_id)  AS allergies,
  (SELECT GROUP_CONCAT(m.medication ORDER BY m.medication_id SEPARATOR ', ')
     FROM patient_medications m WHERE m.patient_id = p.patient_id) AS medications,
  (SELECT COUNT(*) FROM visits vc WHERE vc.patient_id = p.patient_id) AS visit_count,
  lv.visit_id                                                     AS latest_visit_id,
  COALESCE(lv.visit_date, p.created_at)                           AS last_visit_at,
  lv.heart_rate,
  lv.blood_sugar,
  lv.temperature_f,
  lv.weight_kg,
  lv.height_cm,
  lv.bp_systolic,
  lv.bp_diastolic,
  lv.bmi,
  lv.bmi_category,
  COALESCE(lv.status, 'stable')                                   AS status,
  lv.chief_complaints,
  lv.current_condition,
  lv.doctors_notes,
  p.created_at,
  p.updated_at
FROM patients p
LEFT JOIN v_latest_visit lv ON lv.patient_id = p.patient_id;

-- ------------------------------------------------------------
-- Critical patients that need attention first
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_critical_patients AS
SELECT doctor_id, patient_code, full_name, age, gender,
       heart_rate, blood_sugar, temperature_f, last_visit_at
FROM v_patient_overview
WHERE status = 'critical'
ORDER BY last_visit_at DESC;

-- ------------------------------------------------------------
-- Per-doctor practice summary (dashboard cards in one query)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_doctor_summary AS
SELECT
  d.doctor_id,
  d.username,
  COUNT(o.patient_id)                                                  AS total_patients,
  COALESCE(SUM(o.last_visit_at >= NOW() - INTERVAL 30 DAY), 0)         AS active_patients,
  COALESCE(SUM(o.status = 'critical'), 0)                              AS critical_patients,
  COALESCE(SUM(o.status = 'monitoring'), 0)                            AS monitoring_patients,
  COALESCE(SUM(o.status = 'stable'), 0)                                AS stable_patients
FROM doctors d
LEFT JOIN v_patient_overview o ON o.doctor_id = d.doctor_id
GROUP BY d.doctor_id, d.username;

-- ------------------------------------------------------------
-- Full visit history with patient name (modal "Visit History")
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_visit_history AS
SELECT
  v.visit_id, v.patient_id, p.patient_code, p.full_name, p.doctor_id,
  v.visit_date, v.heart_rate, v.blood_sugar, v.temperature_f,
  v.weight_kg, v.height_cm, v.bp_systolic, v.bp_diastolic,
  v.bmi, v.bmi_category, v.status,
  v.chief_complaints, v.current_condition, v.doctors_notes
FROM visits v
JOIN patients p ON p.patient_id = v.patient_id;
