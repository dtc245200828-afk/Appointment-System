-- =====================================================================
-- File: 03_seed.sql
-- Dữ liệu mẫu: tài khoản demo, dịch vụ, khung giờ 14 ngày và vài lịch hẹn.
-- LƯU Ý: mật khẩu demo chỉ dùng cho môi trường học tập, phải đổi khi triển khai thật.
--   admin@appointment.local / Admin@12345   (role = admin)
--   customer1@example.com    / Demo@12345    (role = user)
--   customer2@example.com    / Demo@12345    (role = user)
-- =====================================================================

SET TIME ZONE 'Asia/Ho_Chi_Minh';

-- ---------------------------------------------------------------------
-- Người dùng (bcrypt cost 12)
-- ---------------------------------------------------------------------
INSERT INTO users (full_name, email, phone, password_hash, role)
VALUES
  ('Quản trị viên', 'admin@appointment.local', '0900000001',
   '$2b$12$DoLIBy7KFTNtDUb/5UBEduHXSaEzdgDkZhpuxaHTOoxHBW1AZOaee', 'admin'),
  ('Nguyễn Văn An', 'customer1@example.com', '0900000002',
   '$2b$12$PipPPLMkryPbZakhMS0n.eMTI2sVFXbBL4Lmho4ODp5vMVDDtO/Di', 'user'),
  ('Trần Thị Bình', 'customer2@example.com', '0900000003',
   '$2b$12$PipPPLMkryPbZakhMS0n.eMTI2sVFXbBL4Lmho4ODp5vMVDDtO/Di', 'user')
ON CONFLICT (email) DO NOTHING;

-- ---------------------------------------------------------------------
-- Dịch vụ
-- ---------------------------------------------------------------------
INSERT INTO services (name, description, duration_minutes, price)
VALUES
  ('Tư vấn tổng quát', 'Tư vấn và kiểm tra sức khoẻ tổng quát cùng bác sĩ chuyên khoa.', 30, 200000),
  ('Xét nghiệm máu', 'Lấy mẫu và trả kết quả xét nghiệm máu cơ bản trong ngày.', 20, 150000),
  ('Siêu âm ổ bụng', 'Siêu âm tổng quát ổ bụng, có hình ảnh và kết luận của bác sĩ.', 30, 300000),
  ('Khám răng định kỳ', 'Khám, vệ sinh răng miệng và tư vấn chăm sóc răng.', 45, 250000),
  ('Vật lý trị liệu', 'Phục hồi chức năng và trị liệu cơ xương khớp.', 60, 350000)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- Khung giờ: 14 ngày kể từ hôm nay, 6 khung giờ/ngày/dịch vụ
-- (giờ Việt Nam, lưu dạng timestamptz).
-- ---------------------------------------------------------------------
INSERT INTO time_slots (service_id, start_time, end_time)
SELECT sv.id,
       (d.day + t.slot_time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
       (d.day + t.slot_time + make_interval(mins => sv.duration_minutes)) AT TIME ZONE 'Asia/Ho_Chi_Minh'
  FROM services sv
  CROSS JOIN generate_series(
        (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
        (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 13,
        interval '1 day'
      ) AS d(day)
  CROSS JOIN (
        VALUES (time '08:00'), (time '09:30'), (time '11:00'),
               (time '13:30'), (time '15:00'), (time '16:30')
      ) AS t(slot_time)
 WHERE sv.is_active = true
   AND (d.day + t.slot_time) AT TIME ZONE 'Asia/Ho_Chi_Minh' > now()
ON CONFLICT (service_id, start_time) DO NOTHING;

-- ---------------------------------------------------------------------
-- Vài lịch hẹn mẫu để giao diện admin có dữ liệu
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_user1   integer;
  v_user2   integer;
  v_slot1   integer;
  v_slot2   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM appointments) THEN
    RAISE NOTICE 'Đã có lịch hẹn, bỏ qua bước seed appointments.';
    RETURN;
  END IF;

  SELECT id INTO v_user1 FROM users WHERE email = 'customer1@example.com';
  SELECT id INTO v_user2 FROM users WHERE email = 'customer2@example.com';

  SELECT id INTO v_slot1
    FROM time_slots
   WHERE status = 'available' AND start_time > now() + interval '1 day'
   ORDER BY start_time
   LIMIT 1;

  SELECT id INTO v_slot2
    FROM time_slots
   WHERE status = 'available' AND start_time > now() + interval '1 day' AND id <> v_slot1
   ORDER BY start_time DESC
   LIMIT 1;

  IF v_user1 IS NULL OR v_slot1 IS NULL THEN
    RAISE NOTICE 'Thiếu dữ liệu để seed appointments.';
    RETURN;
  END IF;

  INSERT INTO appointments (user_id, slot_id, status, note)
  VALUES (v_user1, v_slot1, 'pending', 'Đặt lịch mẫu - chờ xác nhận');
  UPDATE time_slots SET status = 'booked' WHERE id = v_slot1;

  IF v_user2 IS NOT NULL AND v_slot2 IS NOT NULL THEN
    INSERT INTO appointments (user_id, slot_id, status, note, confirmed_at)
    VALUES (v_user2, v_slot2, 'confirmed', 'Đặt lịch mẫu - đã xác nhận', now());
    UPDATE time_slots SET status = 'booked' WHERE id = v_slot2;
  END IF;

  RAISE NOTICE 'Đã tạo lịch hẹn mẫu.';
END;
$$;

\echo '--- Thống kê dữ liệu seed ---'
SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM services) AS services,
       (SELECT count(*) FROM time_slots) AS time_slots,
       (SELECT count(*) FROM time_slots WHERE status = 'available' AND start_time > now()) AS slots_available,
       (SELECT count(*) FROM appointments) AS appointments;
