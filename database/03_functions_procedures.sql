-- ============================================================
-- MediTrack Pro  |  03_functions_procedures.sql
-- Run with the mysql CLI (it understands DELIMITER).
-- ============================================================
USE meditrack;

DROP FUNCTION  IF EXISTS fn_calculate_age;
DROP FUNCTION  IF EXISTS fn_bmi;
DROP PROCEDURE IF EXISTS sp_add_visit;
DROP PROCEDURE IF EXISTS sp_search_patients;
DROP PROCEDURE IF EXISTS sp_dashboard_stats;
DROP PROCEDURE IF EXISTS sp_create_backup_snapshot;

DELIMITER $$

-- ------------------------------------------------------------
-- Age in whole years (same result as calculateAge() in the JS)
-- ------------------------------------------------------------
CREATE FUNCTION fn_calculate_age(p_dob DATE)
RETURNS INT
NO SQL
BEGIN
  IF p_dob IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN TIMESTAMPDIFF(YEAR, p_dob, CURDATE());
END$$

-- ------------------------------------------------------------
-- BMI from kg and cm (same formula as calculateBMI() in the JS)
-- ------------------------------------------------------------
CREATE FUNCTION fn_bmi(p_weight_kg DECIMAL(5,1), p_height_cm DECIMAL(5,1))
RETURNS DECIMAL(4,1)
DETERMINISTIC
BEGIN
  IF p_weight_kg IS NULL OR p_height_cm IS NULL OR p_height_cm <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN ROUND(p_weight_kg / POW(p_height_cm / 100, 2), 1);
END$$

-- ------------------------------------------------------------
-- Record a new visit for a patient the doctor owns.
-- Returns the new visit_id as a one-row result set.
-- ------------------------------------------------------------
CREATE PROCEDURE sp_add_visit(
  IN p_doctor_id    INT UNSIGNED,
  IN p_patient_id   INT UNSIGNED,
  IN p_heart_rate   SMALLINT UNSIGNED,
  IN p_blood_sugar  SMALLINT UNSIGNED,
  IN p_temperature  DECIMAL(4,1),
  IN p_weight       DECIMAL(5,1),
  IN p_height       DECIMAL(5,1),
  IN p_bp_systolic  SMALLINT UNSIGNED,
  IN p_bp_diastolic SMALLINT UNSIGNED,
  IN p_complaints   TEXT,
  IN p_condition    TEXT,
  IN p_notes        TEXT,
  IN p_visit_date   DATETIME
)
BEGIN
  DECLARE v_owner INT UNSIGNED;

  SELECT doctor_id INTO v_owner FROM patients WHERE patient_id = p_patient_id;
  IF v_owner IS NULL OR v_owner <> p_doctor_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Patient not found for this doctor';
  END IF;

  INSERT INTO visits (
    patient_id, doctor_id, visit_date,
    heart_rate, blood_sugar, temperature_f, weight_kg, height_cm,
    bp_systolic, bp_diastolic,
    chief_complaints, current_condition, doctors_notes
  ) VALUES (
    p_patient_id, p_doctor_id, COALESCE(p_visit_date, NOW()),
    p_heart_rate, p_blood_sugar, p_temperature, p_weight, p_height,
    p_bp_systolic, p_bp_diastolic,
    p_complaints, p_condition, p_notes
  );

  SELECT LAST_INSERT_ID() AS visit_id;
END$$

-- ------------------------------------------------------------
-- Patients grid: search (name / ID / complaints / condition) + status filter.
-- p_term = '' means no search; p_status = 'all' means no filter.
-- ------------------------------------------------------------
CREATE PROCEDURE sp_search_patients(
  IN p_doctor_id INT UNSIGNED,
  IN p_term      VARCHAR(100),
  IN p_status    VARCHAR(12)
)
BEGIN
  SELECT *
  FROM v_patient_overview o
  WHERE o.doctor_id = p_doctor_id
    AND (p_status IS NULL OR p_status = 'all' OR o.status = p_status)
    AND (
      p_term IS NULL OR p_term = ''
      OR LOCATE(p_term, o.full_name) > 0
      OR LOCATE(p_term, o.patient_code) > 0
      OR LOCATE(p_term, COALESCE(o.chief_complaints, '')) > 0
      OR LOCATE(p_term, COALESCE(o.current_condition, '')) > 0
    )
  ORDER BY o.last_visit_at DESC, o.patient_id DESC;
END$$

-- ------------------------------------------------------------
-- The four dashboard cards
-- ------------------------------------------------------------
CREATE PROCEDURE sp_dashboard_stats(IN p_doctor_id INT UNSIGNED)
BEGIN
  SELECT
    COUNT(*)                                                    AS total_patients,
    COALESCE(SUM(last_visit_at >= NOW() - INTERVAL 30 DAY), 0)  AS active_patients,
    COALESCE(SUM(status = 'critical'), 0)                       AS critical_patients,
    COALESCE(SUM(DATE(last_visit_at) = CURDATE()), 0)           AS todays_visits
  FROM v_patient_overview
  WHERE doctor_id = p_doctor_id;
END$$

-- ------------------------------------------------------------
-- "Auto Backup": store a full JSON snapshot of the doctor's data
-- inside the database and keep only the 5 newest snapshots.
-- ------------------------------------------------------------
CREATE PROCEDURE sp_create_backup_snapshot(IN p_doctor_id INT UNSIGNED)
BEGIN
  DECLARE v_json  JSON;
  DECLARE v_count INT UNSIGNED DEFAULT 0;
  DECLARE v_id    INT UNSIGNED;

  SELECT COUNT(*) INTO v_count FROM patients WHERE doctor_id = p_doctor_id;

  SELECT COALESCE(JSON_ARRAYAGG(
    JSON_OBJECT(
      'patient_code',    p.patient_code,
      'full_name',       p.full_name,
      'date_of_birth',   p.date_of_birth,
      'gender',          p.gender,
      'phone',           p.phone,
      'email',           p.email,
      'address',         p.address,
      'medical_history', p.medical_history,
      'allergies', (SELECT COALESCE(JSON_ARRAYAGG(a.allergen), JSON_ARRAY())
                      FROM patient_allergies a WHERE a.patient_id = p.patient_id),
      'medications', (SELECT COALESCE(JSON_ARRAYAGG(m.medication), JSON_ARRAY())
                      FROM patient_medications m WHERE m.patient_id = p.patient_id),
      'visits', (SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
                    'visit_date',        v.visit_date,
                    'heart_rate',        v.heart_rate,
                    'blood_sugar',       v.blood_sugar,
                    'temperature_f',     v.temperature_f,
                    'weight_kg',         v.weight_kg,
                    'height_cm',         v.height_cm,
                    'bp_systolic',       v.bp_systolic,
                    'bp_diastolic',      v.bp_diastolic,
                    'chief_complaints',  v.chief_complaints,
                    'current_condition', v.current_condition,
                    'doctors_notes',     v.doctors_notes)), JSON_ARRAY())
                   FROM visits v WHERE v.patient_id = p.patient_id)
    )), JSON_ARRAY())
  INTO v_json
  FROM patients p
  WHERE p.doctor_id = p_doctor_id;

  INSERT INTO backup_snapshots (doctor_id, record_count, snapshot)
  VALUES (p_doctor_id, v_count, v_json);
  SET v_id = LAST_INSERT_ID();

  INSERT INTO backup_log (doctor_id, backup_type, record_count)
  VALUES (p_doctor_id, 'auto', v_count);

  -- retention: keep the 5 newest snapshots per doctor
  DELETE FROM backup_snapshots
  WHERE doctor_id = p_doctor_id
    AND snapshot_id NOT IN (
      SELECT snapshot_id FROM (
        SELECT snapshot_id FROM backup_snapshots
        WHERE doctor_id = p_doctor_id
        ORDER BY snapshot_id DESC LIMIT 5
      ) newest
    );

  SELECT v_id AS snapshot_id, v_count AS record_count;
END$$

DELIMITER ;
