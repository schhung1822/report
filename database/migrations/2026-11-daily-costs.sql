-- =============================================================================
-- Bảng chi phí kế toán theo ngày (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Kế toán tổng hợp chi phí từng ngày (và từng kênh Zalo/Page với shop Việt Nam). Bảng này lưu từng ô của danh sách đó,
-- nhập bằng file Excel mẫu ở trang "Chi phí cố định". Ngày nào có số trong bảng này thì báo cáo dùng số kế toán thay cho
-- số ước tính (chi phí hằng tháng, lương nhân sự, Ads Meta) của đúng ngày và khoản đó.
--
-- CHẠY MỘT LẦN trên database đang dùng:
--     mysql -u <user> -p <database> < database/migrations/2026-11-daily-costs.sql
-- Chỉ tạo bảng MỚI, không đụng tới dữ liệu cũ. Cài mới thì database/schema.sql đã có sẵn bảng này.
-- Chưa chạy file này thì báo cáo vẫn chạy như cũ; chỉ trang nhập bảng chi phí theo ngày báo cần chạy.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS daily_costs (
  shop_id     BIGINT UNSIGNED NOT NULL COMMENT 'Mã shop trên Pancake POS',
  cost_date   DATE NOT NULL,

  -- Kênh của dòng: 'zalo' / 'page' (shop Việt Nam); chuỗi rỗng = cả shop (shop Philippines).
  channel     VARCHAR(8) NOT NULL DEFAULT '',

  -- Khoản chi phí: return_provision, fixed_cost, other_cost, cogs, shipping_ped_ph, shipping_ph, tax_fee
  -- (lương nhập ở bảng cost_entries qua tab "Lương nhân sự"; ads lấy tự động từ Meta, không lưu ở đây)
  line_key    VARCHAR(40) NOT NULL,

  amount      DECIMAL(18,2) NOT NULL COMMENT 'Số tiền theo tiền tệ của shop (VND hoặc PHP)',

  updated_by  VARCHAR(190) NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id, cost_date, channel, line_key),
  CONSTRAINT chk_daily_costs_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
