-- =============================================================================
-- Số cộng dồn của shop Philippines đã ngừng hoạt động (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Báo cáo của kế toán có thêm một shop Phil cũ không còn bán nữa, nên "Tổng cộng dồn" của họ lớn hơn của app (chỉ đọc các shop còn
-- chạy trên Pancake). Mỗi nhóm shop Phil có tối đa MỘT dòng ở đây (lưu dưới mã shop chính, giống các chi phí nhập tay khác): các số
-- này được cộng vào thẻ "Tổng cộng dồn" ở mục IV của báo cáo Phil. Nhập ở trang "Chi phí cố định", tab "Shop Phil cũ".
--
-- CHẠY MỘT LẦN trên database đang dùng:
--     mysql -u <user> -p <database> < database/migrations/2026-11-ph-legacy-totals.sql
-- Chỉ tạo bảng MỚI, không đụng tới dữ liệu cũ. Cài mới thì database/schema.sql đã có sẵn bảng này.
-- Chưa chạy file này thì báo cáo vẫn chạy bình thường (không cộng gì); chỉ việc lưu số mới báo cần chạy.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ph_legacy_totals (
  shop_id          BIGINT UNSIGNED NOT NULL COMMENT 'Mã shop Phil chính trên Pancake POS (nhóm shop dùng chung)',
  label            VARCHAR(190) NULL COMMENT 'Tên shop cũ, để dễ nhớ',
  revenue          DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Doanh số cộng thêm vào số tiền ở thẻ Tổng cộng dồn, peso',
  confirmed        DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Doanh số thành công, mẫu số của tỷ lệ hoàn, peso',
  returned         DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Giá trị đơn hoàn, tử số của tỷ lệ hoàn, peso',
  orders           INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Số đơn (mẫu số của đơn hoàn/đơn)',
  refunded         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Số đơn hoàn',
  note             VARCHAR(255) NULL,
  updated_by       VARCHAR(190) NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id),
  CONSTRAINT chk_ph_legacy_totals CHECK (revenue >= 0 AND confirmed >= 0 AND returned >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
