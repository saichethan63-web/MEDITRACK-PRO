-- ============================================================
-- MediTrack Pro  |  06_useful_queries.sql
-- Example reports / analytics. Safe to run any time (read-only,
-- except the CALL examples at the bottom which write a backup).
-- ============================================================
USE meditrack;

-- 1. Patient list for one doctor, sickest first
SELECT patient_code, full_name, age, gender, heart_rate, blood_sugar,
       temperature_f, status, last_visit_at
FROM v_patient_overview
WHERE doctor_id = (SELECT doctor_id FROM doctors WHERE username = 'demo')
ORDER BY FIELD(status, 'critical', 'monitoring', 'stable'), last_visit_at DESC;

-- 2. Full vitals history of one patient (chronological)
SELECT visit_date, heart_rate, blood_sugar, temperature_f,
       CONCAT(bp_systolic, '/', bp_diastolic) AS blood_pressure,
       weight_kg, bmi, status, current_condition
FROM v_visit_history
WHERE patient_code = 'P100001'
ORDER BY visit_date;

-- 3. How did each patient's vitals change since their previous visit? (LAG)
SELECT full_name, visit_date, blood_sugar,
       -- CAST: subtracting UNSIGNED columns overflows when the value drops
       CAST(blood_sugar AS SIGNED) - LAG(CAST(blood_sugar AS SIGNED)) OVER w AS sugar_change,
       CAST(heart_rate  AS SIGNED) - LAG(CAST(heart_rate  AS SIGNED)) OVER w AS hr_change,
       weight_kg - LAG(weight_kg) OVER w                                      AS weight_change
FROM v_visit_history
WHERE doctor_id = 1
WINDOW w AS (PARTITION BY patient_id ORDER BY visit_date)
ORDER BY full_name, visit_date;

-- 4. Status distribution per doctor
SELECT d.username, o.status, COUNT(*) AS patients
FROM v_patient_overview o
JOIN doctors d ON d.doctor_id = o.doctor_id
GROUP BY d.username, o.status
ORDER BY d.username, FIELD(o.status, 'critical', 'monitoring', 'stable');

-- 5. Average vitals by gender (latest visit of each patient)
SELECT gender,
       COUNT(*)                     AS patients,
       ROUND(AVG(heart_rate), 1)    AS avg_heart_rate,
       ROUND(AVG(blood_sugar), 1)   AS avg_blood_sugar,
       ROUND(AVG(temperature_f), 1) AS avg_temp_f,
       ROUND(AVG(bmi), 1)           AS avg_bmi
FROM v_patient_overview
WHERE doctor_id = 1
GROUP BY gender;

-- 6. Age-group breakdown
SELECT CASE
         WHEN age < 18 THEN '0-17'
         WHEN age < 40 THEN '18-39'
         WHEN age < 60 THEN '40-59'
         ELSE '60+'
       END AS age_group,
       COUNT(*) AS patients
FROM v_patient_overview
WHERE doctor_id = 1
GROUP BY age_group
ORDER BY MIN(age);

-- 7. BMI category distribution
SELECT COALESCE(bmi_category, 'Not recorded') AS bmi_category, COUNT(*) AS patients
FROM v_patient_overview
WHERE doctor_id = 1
GROUP BY bmi_category
ORDER BY patients DESC;

-- 8. Who is allergic to a given drug? (check before prescribing)
SELECT p.patient_code, p.full_name, a.allergen
FROM patient_allergies a
JOIN patients p ON p.patient_id = a.patient_id
WHERE p.doctor_id = 1 AND a.allergen LIKE '%Penicillin%';

-- 9. Patients not seen for 30+ days (follow-up list)
SELECT patient_code, full_name, phone, last_visit_at,
       DATEDIFF(NOW(), last_visit_at) AS days_since_visit
FROM v_patient_overview
WHERE doctor_id = 1 AND last_visit_at < NOW() - INTERVAL 30 DAY
ORDER BY last_visit_at;

-- 10. Patients whose status got WORSE at their latest visit
WITH ranked AS (
  SELECT patient_id, status, visit_date,
         LAG(status) OVER (PARTITION BY patient_id ORDER BY visit_date) AS previous_status
  FROM visits
)
SELECT p.patient_code, p.full_name, r.previous_status, r.status AS current_status, r.visit_date
FROM ranked r
JOIN patients p ON p.patient_id = r.patient_id
WHERE p.doctor_id = 1
  AND FIELD(r.status, 'stable', 'monitoring', 'critical')
    > FIELD(r.previous_status, 'stable', 'monitoring', 'critical')
  AND r.visit_date = (SELECT MAX(visit_date) FROM visits WHERE patient_id = r.patient_id);

-- 11. Most common conditions
SELECT current_condition, COUNT(*) AS cases
FROM visits
WHERE doctor_id = 1 AND current_condition IS NOT NULL
GROUP BY current_condition
ORDER BY cases DESC, current_condition
LIMIT 10;

-- 12. Patients taking several medications at once (interaction review)
SELECT p.patient_code, p.full_name, COUNT(*) AS medication_count,
       GROUP_CONCAT(m.medication SEPARATOR ' | ') AS medications
FROM patient_medications m
JOIN patients p ON p.patient_id = m.patient_id
WHERE p.doctor_id = 1
GROUP BY p.patient_id, p.patient_code, p.full_name
HAVING COUNT(*) >= 2
ORDER BY medication_count DESC;

-- 13. Visits per month (workload)
SELECT DATE_FORMAT(visit_date, '%Y-%m') AS month, COUNT(*) AS visits
FROM visits
WHERE doctor_id = 1
GROUP BY month
ORDER BY month;

-- 14. Recent audit trail
SELECT a.created_at, d.username, a.action, a.entity, a.entity_id, a.details
FROM audit_log a
LEFT JOIN doctors d ON d.doctor_id = a.doctor_id
ORDER BY a.log_id DESC
LIMIT 20;

-- 15. Stored procedures / functions
CALL sp_dashboard_stats(1);
CALL sp_search_patients(1, 'diabetes', 'all');
CALL sp_search_patients(1, '', 'critical');
SELECT fn_calculate_age('1990-01-01') AS age, fn_bmi(70, 175) AS bmi;
-- CALL sp_create_backup_snapshot(1);   -- writes a snapshot, uncomment to try
