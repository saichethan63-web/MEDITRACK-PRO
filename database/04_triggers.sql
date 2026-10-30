-- ============================================================
-- MediTrack Pro  |  04_triggers.sql
-- Run with the mysql CLI (it understands DELIMITER).
-- ============================================================
USE meditrack;

DROP TRIGGER IF EXISTS trg_patients_bi;
DROP TRIGGER IF EXISTS trg_patients_bu;
DROP TRIGGER IF EXISTS trg_patients_ai;
DROP TRIGGER IF EXISTS trg_patients_au;
DROP TRIGGER IF EXISTS trg_patients_ad;
DROP TRIGGER IF EXISTS trg_visits_bi;
DROP TRIGGER IF EXISTS trg_visits_ai;
DROP TRIGGER IF EXISTS trg_visits_au;
DROP TRIGGER IF EXISTS trg_visits_ad;

DELIMITER $$

-- ------------------------------------------------------------
-- PATIENTS
-- ------------------------------------------------------------

-- Before insert: validate DOB, tidy text, generate the P1xxxxx code
-- (unless the caller supplied one, e.g. when importing an old backup).
CREATE TRIGGER trg_patients_bi BEFORE INSERT ON patients
FOR EACH ROW
BEGIN
  DECLARE v_next  INT UNSIGNED;
  DECLARE v_taken TINYINT DEFAULT 0;

  IF NEW.date_of_birth > CURDATE() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future';
  END IF;

  SET NEW.full_name = TRIM(NEW.full_name);
  SET NEW.email     = NULLIF(TRIM(NEW.email), '');
  SET NEW.phone     = NULLIF(TRIM(NEW.phone), '');

  IF NEW.patient_code IS NULL OR NEW.patient_code = '' THEN
    -- take the next number, skipping any code already used (e.g. restored from a backup)
    REPEAT
      UPDATE patient_code_seq SET last_val = last_val + 1 WHERE id = 1;
      SELECT last_val INTO v_next FROM patient_code_seq WHERE id = 1;
      SET v_taken = EXISTS (SELECT 1 FROM patients WHERE patient_code = CONCAT('P', v_next));
    UNTIL v_taken = 0 END REPEAT;
    SET NEW.patient_code = CONCAT('P', v_next);
  END IF;
END$$

CREATE TRIGGER trg_patients_bu BEFORE UPDATE ON patients
FOR EACH ROW
BEGIN
  IF NEW.date_of_birth > CURDATE() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future';
  END IF;
  SET NEW.full_name = TRIM(NEW.full_name);
  SET NEW.email     = NULLIF(TRIM(NEW.email), '');
  SET NEW.phone     = NULLIF(TRIM(NEW.phone), '');
END$$

CREATE TRIGGER trg_patients_ai AFTER INSERT ON patients
FOR EACH ROW
  INSERT INTO audit_log (doctor_id, action, entity, entity_id, details)
  VALUES (NEW.doctor_id, 'INSERT', 'patient', NEW.patient_id,
          JSON_OBJECT('patient_code', NEW.patient_code, 'full_name', NEW.full_name))$$

CREATE TRIGGER trg_patients_au AFTER UPDATE ON patients
FOR EACH ROW
  INSERT INTO audit_log (doctor_id, action, entity, entity_id, details)
  VALUES (NEW.doctor_id, 'UPDATE', 'patient', NEW.patient_id,
          JSON_OBJECT('patient_code', NEW.patient_code,
                      'old_name', OLD.full_name, 'new_name', NEW.full_name))$$

CREATE TRIGGER trg_patients_ad AFTER DELETE ON patients
FOR EACH ROW
  INSERT INTO audit_log (doctor_id, action, entity, entity_id, details)
  VALUES (OLD.doctor_id, 'DELETE', 'patient', OLD.patient_id,
          JSON_OBJECT('patient_code', OLD.patient_code, 'full_name', OLD.full_name))$$

-- ------------------------------------------------------------
-- VISITS
-- ------------------------------------------------------------

-- A visit cannot be dated in the future (1 day of clock-skew tolerance).
CREATE TRIGGER trg_visits_bi BEFORE INSERT ON visits
FOR EACH ROW
BEGIN
  IF NEW.visit_date > NOW() + INTERVAL 1 DAY THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Visit date cannot be in the future';
  END IF;
END$$

CREATE TRIGGER trg_visits_ai AFTER INSERT ON visits
FOR EACH ROW
  INSERT INTO audit_log (doctor_id, action, entity, entity_id, details)
  VALUES (NEW.doctor_id, 'INSERT', 'visit', NEW.visit_id,
          JSON_OBJECT('patient_id', NEW.patient_id, 'status', NEW.status))$$

CREATE TRIGGER trg_visits_au AFTER UPDATE ON visits
FOR EACH ROW
  INSERT INTO audit_log (doctor_id, action, entity, entity_id, details)
  VALUES (NEW.doctor_id, 'UPDATE', 'visit', NEW.visit_id,
          JSON_OBJECT('patient_id', NEW.patient_id,
                      'old_status', OLD.status, 'new_status', NEW.status))$$

CREATE TRIGGER trg_visits_ad AFTER DELETE ON visits
FOR EACH ROW
  INSERT INTO audit_log (doctor_id, action, entity, entity_id, details)
  VALUES (OLD.doctor_id, 'DELETE', 'visit', OLD.visit_id,
          JSON_OBJECT('patient_id', OLD.patient_id))$$

DELIMITER ;
