-- =====================================================================
-- File: 02_roles.sql
-- Tạo tài khoản database theo nguyên tắc đặc quyền tối thiểu:
--   * app_user      : chỉ SELECT/INSERT/UPDATE/DELETE trên bảng nghiệp vụ,
--                     KHÔNG có quyền DDL, không superuser, không CREATEDB/CREATEROLE.
--   * exporter_user : chỉ pg_monitor để postgres_exporter đọc thống kê.
-- Mật khẩu lấy từ biến môi trường của container PostgreSQL
-- (truyền vào bởi docker compose từ file .env).
-- =====================================================================

\set ON_ERROR_STOP on

\getenv app_db_password APP_DB_PASSWORD
\getenv exporter_db_password EXPORTER_DB_PASSWORD

SELECT (coalesce(:'app_db_password', '') = '' OR length(:'app_db_password') < 16) AS weak_app_password \gset
\if :weak_app_password
\echo 'FATAL: biến APP_DB_PASSWORD chưa được đặt hoặc ngắn hơn 16 ký tự.'
DO $$ BEGIN RAISE EXCEPTION 'APP_DB_PASSWORD missing or too weak (min 16 chars)'; END $$;
\endif

SELECT (coalesce(:'exporter_db_password', '') = '' OR length(:'exporter_db_password') < 16) AS weak_exporter_password \gset
\if :weak_exporter_password
\echo 'FATAL: biến EXPORTER_DB_PASSWORD chưa được đặt hoặc ngắn hơn 16 ký tự.'
DO $$ BEGIN RAISE EXCEPTION 'EXPORTER_DB_PASSWORD missing or too weak (min 16 chars)'; END $$;
\endif

-- ---------------------------------------------------------------------
-- Role ứng dụng (quyền tối thiểu)
-- ---------------------------------------------------------------------
SELECT format('CREATE ROLE app_user LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'app_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
\gexec

ALTER ROLE app_user WITH LOGIN PASSWORD :'app_db_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT CONNECT ON DATABASE :"DBNAME" TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Không cho app_user tạo object trong schema public (chỉ DML).
REVOKE CREATE ON SCHEMA public FROM app_user;

-- ---------------------------------------------------------------------
-- Role cho postgres_exporter (chỉ đọc thống kê)
-- ---------------------------------------------------------------------
SELECT format('CREATE ROLE exporter_user LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'exporter_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exporter_user')
\gexec

ALTER ROLE exporter_user WITH LOGIN PASSWORD :'exporter_db_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT CONNECT ON DATABASE :"DBNAME" TO exporter_user;
GRANT pg_monitor TO exporter_user;
GRANT USAGE ON SCHEMA public TO exporter_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO exporter_user;

-- Quyền mặc định cho object được tạo sau này (không cần grant lại thủ công).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO exporter_user;

-- ---------------------------------------------------------------------
-- Thu hẹp quyền mặc định trên database
-- ---------------------------------------------------------------------
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO PUBLIC;

-- Ghi nhận role hiện có để kiểm tra sau khi khởi động.
\echo '--- Danh sách role nghiệp vụ ---'
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
  FROM pg_roles
 WHERE rolname IN ('app_user', 'exporter_user')
 ORDER BY rolname;
