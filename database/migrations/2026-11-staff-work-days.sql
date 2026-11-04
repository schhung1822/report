-- =============================================================================
-- Lương và thưởng nhân sự tính theo công thực tế (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Thêm vào bảng cost_entries:
--   * cột work_days : "số công chuẩn" của tháng. Với khoản hằng tháng của nhân sự có work_days, chi phí mỗi ngày
--                     = amount / work_days và CHỈ tính cho những ngày nhân sự đó có đơn hoặc doanh thu trong POS.
--   * loại chi phí 'bonus' : thưởng nhân sự (báo cáo tính chung vào lương).
--
-- CHẠY MỘT LẦN trên database đang dùng (đã có bảng cost_entries từ trước):
--     mysql -u <user> -p <database> < database/migrations/2026-11-staff-work-days.sql
-- Cài mới thì không cần: database/schema.sql đã có sẵn hai thay đổi này.
-- Chưa chạy file này thì báo cáo vẫn lấy chi phí như cũ; chỉ việc lưu lương theo công sẽ báo lỗi cho tới khi chạy.
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE cost_entries
  MODIFY COLUMN cost_type ENUM(
    'salary_sale_cskh',
    'salary_other',
    'bonus',
    'fixed_cost',
    'other_cost',
    'ads_cost',
    'return_provision'
  ) NOT NULL,
  ADD COLUMN work_days TINYINT UNSIGNED NULL
    COMMENT 'Số công chuẩn của tháng; có giá trị = lương/thưởng tháng chia cho số công, chỉ tính ngày nhân sự có đơn'
    AFTER period,
  ADD CONSTRAINT chk_cost_entries_work_days CHECK (
    work_days IS NULL OR (work_days BETWEEN 1 AND 31 AND scope = 'staff' AND period = 'monthly')
  );
