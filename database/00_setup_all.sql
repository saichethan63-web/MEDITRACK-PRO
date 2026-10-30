-- ============================================================
-- Runs every script in order. From inside the database/ folder:
--     mysql -u root -p < 00_setup_all.sql
-- ============================================================
SOURCE 01_schema.sql;
SOURCE 02_views.sql;
SOURCE 03_functions_procedures.sql;
SOURCE 04_triggers.sql;
-- optional: comment out the next line for an empty database
SOURCE 05_sample_data.sql;
