-- ============================================================
-- MediTrack Pro  |  01_schema.sql
-- Target: MySQL 8.0+
-- Creates the database, tables, constraints and the app user.
-- ============================================================

DROP DATABASE IF EXISTS meditrack;
CREATE DATABASE meditrack
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE meditrack;

-- ------------------------------------------------------------
-- doctors  <- Login / Register screens
-- ------------------------------------------------------------
CREATE TABLE doctors (
  doctor_id      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username       VARCHAR(50)   NOT NULL,
  password_hash  VARCHAR(100)  NOT NULL COMMENT 'bcrypt hash, never plain text',
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at  TIMESTAMP     NULL,
  PRIMARY KEY (doctor_id),
  UNIQUE KEY uq_doctors_username (username),
  CONSTRAINT chk_doctors_username CHECK (CHAR_LENGTH(TRIM(username)) >= 1)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- patient_code_seq  <- generates the "P100001" style IDs shown in the UI
-- ------------------------------------------------------------
CREATE TABLE patient_code_seq (
  id        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  last_val  INT UNSIGNED     NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
INSERT INTO patient_code_seq (id, last_val) VALUES (1, 100000);

-- ------------------------------------------------------------
-- patients  <- "Personal" tab + Medical History
-- One row per person: things that do not change visit-to-visit.
-- ------------------------------------------------------------
CREATE TABLE patients (
  patient_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  patient_code     VARCHAR(12)   NOT NULL COMMENT 'Shown in UI, e.g. P100001 (set by trigger)',
  doctor_id        INT UNSIGNED  NOT NULL,
  full_name        VARCHAR(120)  NOT NULL,
  date_of_birth    DATE          NOT NULL,
  gender           ENUM('Male','Female','Other') NOT NULL,
  phone            VARCHAR(30)   NULL,
  email            VARCHAR(120)  NULL,
  address          VARCHAR(255)  NULL,
  medical_history  TEXT          NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_id),
  UNIQUE KEY uq_patients_code (patient_code),
  KEY idx_patients_doctor_name (doctor_id, full_name),
  CONSTRAINT fk_patients_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (doctor_id) ON DELETE CASCADE,
  CONSTRAINT chk_patients_name CHECK (CHAR_LENGTH(TRIM(full_name)) >= 1)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- patient_allergies  <- "Allergies" field (comma separated in the UI)
-- ------------------------------------------------------------
CREATE TABLE patient_allergies (
  allergy_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id  INT UNSIGNED NOT NULL,
  allergen    VARCHAR(100) NOT NULL,
  PRIMARY KEY (allergy_id),
  UNIQUE KEY uq_allergy (patient_id, allergen),
  CONSTRAINT fk_allergy_patient FOREIGN KEY (patient_id)
    REFERENCES patients (patient_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- patient_medications  <- "Current Medications" field
-- ------------------------------------------------------------
CREATE TABLE patient_medications (
  medication_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id     INT UNSIGNED NOT NULL,
  medication     VARCHAR(150) NOT NULL COMMENT 'name + dose, e.g. Paracetamol 500mg',
  PRIMARY KEY (medication_id),
  UNIQUE KEY uq_medication (patient_id, medication),
  CONSTRAINT fk_med_patient FOREIGN KEY (patient_id)
    REFERENCES patients (patient_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- visits  <- "Vitals" tab + Chief Complaints / Condition / Doctor's Notes
-- One row per visit => full vitals history per patient.
-- bmi, bmi_category and status are computed by MySQL itself using
-- the exact same rules as the frontend.
-- ------------------------------------------------------------
CREATE TABLE visits (
  visit_id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  patient_id         INT UNSIGNED  NOT NULL,
  doctor_id          INT UNSIGNED  NOT NULL COMMENT 'doctor who recorded the visit',
  visit_date         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Vitals tab
  heart_rate         SMALLINT UNSIGNED NULL COMMENT 'BPM',
  blood_sugar        SMALLINT UNSIGNED NULL COMMENT 'mg/dL',
  temperature_f      DECIMAL(4,1)  NULL COMMENT 'degrees Fahrenheit',
  weight_kg          DECIMAL(5,1)  NULL,
  height_cm          DECIMAL(5,1)  NULL,
  bp_systolic        SMALLINT UNSIGNED NULL,
  bp_diastolic       SMALLINT UNSIGNED NULL,

  -- Medical tab
  chief_complaints   TEXT NULL,
  current_condition  TEXT NULL,
  doctors_notes      TEXT NULL,

  -- Computed columns (same rules as the JS in the frontend)
  bmi DECIMAL(4,1) GENERATED ALWAYS AS (
        ROUND(weight_kg / POW(height_cm / 100, 2), 1)
      ) STORED,
  bmi_category VARCHAR(15) GENERATED ALWAYS AS (
        CASE
          WHEN weight_kg IS NULL OR height_cm IS NULL THEN NULL
          WHEN weight_kg / POW(height_cm / 100, 2) < 18.5 THEN 'Underweight'
          WHEN weight_kg / POW(height_cm / 100, 2) < 25   THEN 'Normal weight'
          WHEN weight_kg / POW(height_cm / 100, 2) < 30   THEN 'Overweight'
          ELSE 'Obese'
        END
      ) STORED,
  status ENUM('stable','monitoring','critical') GENERATED ALWAYS AS (
        CASE
          WHEN heart_rate  > 100 OR heart_rate  < 50
            OR blood_sugar > 180 OR blood_sugar < 70
            OR temperature_f > 101 OR temperature_f < 97 THEN 'critical'
          WHEN heart_rate  > 90 OR blood_sugar > 140
            OR temperature_f > 99.5                      THEN 'monitoring'
          ELSE 'stable'
        END
      ) STORED,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (visit_id),
  KEY idx_visits_patient_date (patient_id, visit_date),
  KEY idx_visits_doctor_date  (doctor_id, visit_date),
  KEY idx_visits_status       (status),
  CONSTRAINT fk_visits_patient FOREIGN KEY (patient_id)
    REFERENCES patients (patient_id) ON DELETE CASCADE,
  CONSTRAINT fk_visits_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (doctor_id) ON DELETE CASCADE,

  CONSTRAINT chk_hr     CHECK (heart_rate    IS NULL OR heart_rate    BETWEEN 20 AND 300),
  CONSTRAINT chk_sugar  CHECK (blood_sugar   IS NULL OR blood_sugar   BETWEEN 0 AND 1000),
  CONSTRAINT chk_temp   CHECK (temperature_f IS NULL OR temperature_f BETWEEN 80 AND 115),
  CONSTRAINT chk_weight CHECK (weight_kg     IS NULL OR (weight_kg > 0 AND weight_kg <= 700)),
  CONSTRAINT chk_height CHECK (height_cm     IS NULL OR (height_cm > 0 AND height_cm <= 300)),
  CONSTRAINT chk_bp_sys CHECK (bp_systolic   IS NULL OR bp_systolic  BETWEEN 40 AND 300),
  CONSTRAINT chk_bp_dia CHECK (bp_diastolic  IS NULL OR bp_diastolic BETWEEN 20 AND 200),
  CONSTRAINT chk_bp_pair CHECK (
    (bp_systolic IS NULL AND bp_diastolic IS NULL)
    OR (bp_systolic IS NOT NULL AND bp_diastolic IS NOT NULL AND bp_systolic > bp_diastolic))
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- backup_log + backup_snapshots  <- Backup & Restore screen
-- ------------------------------------------------------------
CREATE TABLE backup_log (
  backup_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  doctor_id     INT UNSIGNED NOT NULL,
  backup_type   ENUM('export','auto','import') NOT NULL,
  record_count  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (backup_id),
  KEY idx_backup_doctor (doctor_id, created_at),
  CONSTRAINT fk_backup_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (doctor_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE backup_snapshots (
  snapshot_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  doctor_id     INT UNSIGNED NOT NULL,
  record_count  INT UNSIGNED NOT NULL DEFAULT 0,
  snapshot      JSON         NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id),
  KEY idx_snapshot_doctor (doctor_id, created_at),
  CONSTRAINT fk_snapshot_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (doctor_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- audit_log  <- who changed what (filled by triggers)
-- No foreign keys on purpose: the trail must survive deletions.
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  log_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  doctor_id   INT UNSIGNED NULL,
  action      ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  entity      VARCHAR(30)  NOT NULL,
  entity_id   INT UNSIGNED NOT NULL,
  details     JSON         NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (log_id),
  KEY idx_audit_entity (entity, entity_id),
  KEY idx_audit_doctor (doctor_id, created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Least-privilege account used by the Node API.
-- CHANGE THIS PASSWORD (and match it in server/.env) for real use.
-- ------------------------------------------------------------
CREATE USER IF NOT EXISTS 'meditrack_app'@'localhost' IDENTIFIED BY 'ChangeMe_123!';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON meditrack.* TO 'meditrack_app'@'localhost';

CREATE USER IF NOT EXISTS 'meditrack_app'@'127.0.0.1' IDENTIFIED BY 'ChangeMe_123!';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON meditrack.* TO 'meditrack_app'@'127.0.0.1';
