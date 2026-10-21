-- =====================================================================
-- Đề 40 - Hệ thống Đặt lịch hẹn trực tuyến
-- File: 01_schema.sql
-- Mô tả: Tạo extension, bảng, ràng buộc, index và trigger bảo vệ nghiệp vụ.
-- Chạy tự động bởi docker-entrypoint-initdb.d khi volume dữ liệu còn trống.
-- =====================================================================

-- Bắt buộc cho exclusion constraint chống chồng lấn khung giờ.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- Bảng users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name      varchar(120) NOT NULL,
  email          varchar(180) NOT NULL,
  phone          varchar(20),
  password_hash  text         NOT NULL,
  role           varchar(10)  NOT NULL DEFAULT 'user',
  is_active      boolean      NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_full_name_len_check CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  CONSTRAINT users_email_format_check CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$'),
  CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
  CONSTRAINT users_password_hash_check CHECK (char_length(password_hash) >= 50),
  CONSTRAINT users_email_key UNIQUE (email)
);

COMMENT ON TABLE users IS 'Tài khoản khách hàng và quản trị viên';
COMMENT ON COLUMN users.password_hash IS 'Mật khẩu đã băm bằng bcrypt (cost >= 12), không lưu plaintext';

-- ---------------------------------------------------------------------
-- Bảng services
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(120) NOT NULL,
  description       text,
  duration_minutes  integer      NOT NULL DEFAULT 30,
  price             numeric(12,2) NOT NULL DEFAULT 0,
  is_active         boolean      NOT NULL DEFAULT true,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT services_name_key UNIQUE (name),
  CONSTRAINT services_duration_check CHECK (duration_minutes BETWEEN 15 AND 480),
  CONSTRAINT services_price_check CHECK (price >= 0),
  CONSTRAINT services_description_len_check CHECK (description IS NULL OR char_length(description) <= 1000)
);

COMMENT ON TABLE services IS 'Danh mục dịch vụ có thể đặt lịch';
COMMENT ON COLUMN services.duration_minutes IS 'Thời lượng dịch vụ (phút), dùng để sinh khung giờ';
COMMENT ON COLUMN services.price IS 'Giá niêm yết (VND)';

-- ---------------------------------------------------------------------
-- Bảng time_slots
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_slots (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id  integer     NOT NULL,
  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  status      varchar(12) NOT NULL DEFAULT 'available',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_slots_service_fk FOREIGN KEY (service_id)
    REFERENCES services (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT time_slots_status_check CHECK (status IN ('available', 'booked', 'blocked')),
  CONSTRAINT time_slots_time_order_check CHECK (end_time > start_time),
  CONSTRAINT time_slots_service_start_key UNIQUE (service_id, start_time),
  -- Chống hai khung giờ chồng lấn của cùng một dịch vụ.
  CONSTRAINT time_slots_no_overlap EXCLUDE USING gist (
    service_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
);

COMMENT ON TABLE time_slots IS 'Khung giờ của dịch vụ: available (trống), booked (đã đặt), blocked (bị khoá)';

CREATE INDEX IF NOT EXISTS time_slots_status_start_idx ON time_slots (status, start_time);
CREATE INDEX IF NOT EXISTS time_slots_service_start_idx ON time_slots (service_id, start_time);

-- ---------------------------------------------------------------------
-- Bảng appointments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        integer     NOT NULL,
  slot_id        integer     NOT NULL,
  status         varchar(12) NOT NULL DEFAULT 'pending',
  note           varchar(500),
  cancel_reason  varchar(255),
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT appointments_slot_fk FOREIGN KEY (slot_id)
    REFERENCES time_slots (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT appointments_status_check CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  CONSTRAINT appointments_cancelled_at_check CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT appointments_confirmed_at_check CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

COMMENT ON TABLE appointments IS 'Lịch hẹn; mỗi khung giờ chỉ có tối đa 1 lịch hẹn đang hoạt động';


-- ---------------------------------------------------------------------
-- Trigger: tự cập nhật updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS services_set_updated_at ON services;
CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS time_slots_set_updated_at ON time_slots;
CREATE TRIGGER time_slots_set_updated_at
  BEFORE UPDATE ON time_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Trigger: chỉ cho tạo lịch hẹn trên khung giờ đang trống.
-- Đây là lớp bảo vệ cuối cùng, kể cả khi có client ghi trực tiếp vào DB.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION appointments_require_available_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status  varchar(12);
  v_start   timestamptz;
BEGIN
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  SELECT status, start_time
    INTO v_status, v_start
    FROM time_slots
   WHERE id = NEW.slot_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND: khung gio % khong ton tai', NEW.slot_id
      USING ERRCODE = '23503';
  END IF;

  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE: khung gio % da duoc dat hoac bi khoa', NEW.slot_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_start <= now() THEN
    RAISE EXCEPTION 'SLOT_IN_PAST: khung gio % da qua', NEW.slot_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_slot_must_be_available ON appointments;
CREATE TRIGGER trg_appointments_slot_must_be_available
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_require_available_slot();

-- ---------------------------------------------------------------------
-- Trigger: chặn chuyển trạng thái không hợp lệ (đã huỷ/hoàn thành -> active)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION appointments_guard_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'completed') AND NEW.status IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: khong the khoi phuc lich hen da %', OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_status_transition ON appointments;
CREATE TRIGGER trg_appointments_status_transition
  BEFORE UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_guard_status_transition();

-- RÀNG BUỘC CHỐNG ĐẶT TRÙNG Ở TẦNG DATABASE:
-- mỗi slot_id chỉ được có duy nhất 1 appointment pending/confirmed.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_active_per_slot
  ON appointments (slot_id)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS appointments_user_created_idx ON appointments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON appointments (status);
