-- =============================================================================
-- Số liệu theo ngày của Bảng lợi nhuận (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Mỗi dòng là số liệu tự động của một ngày của một shop (doanh số, giá vốn POS, ads Meta, lương, chi phí ước tính…) đúng
-- như báo cáo tính lúc lấy. Bảng lợi nhuận đọc từ đây thay vì gọi Pancake POS mỗi lần mở trang; chỉ ngày chưa có (hoặc
-- lấy khi ngày đó chưa kết thúc) mới được lấy lại từ POS. Nút "Cập nhật dữ liệu POS" lấy lại cả tháng.
--
-- CHẠY MỘT LẦN trên database đang dùng:
--     mysql -u <user> -p <database> < database/migrations/2026-11-pnl-days.sql
-- Chỉ tạo bảng MỚI, không đụng tới dữ liệu cũ. Cài mới thì database/schema.sql đã có sẵn bảng này.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS pnl_days (
  shop_id     BIGINT UNSIGNED NOT NULL COMMENT 'Mã shop trên Pancake POS',
  report_date DATE NOT NULL,
  currency    CHAR(3) NOT NULL COMMENT 'Tiền tệ của shop: VND hoặc PHP',

  -- Các số của ngày theo khoá của lib/pnl/sheet.ts ("revenue", "cogs", "zalo.fixedCost"…). {} = ngày không có số liệu.
  day_values  JSON NOT NULL,

  fetched_at  DATETIME(3) NOT NULL COMMENT 'Lúc lấy từ POS, giờ UTC',
  fetched_by  VARCHAR(190) NULL,

  PRIMARY KEY (shop_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
