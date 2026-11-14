-- =============================================================================
-- Giá vốn trung bình theo danh mục của shop Philippines (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Giá vốn trong ngày của shop Phil = số sản phẩm bán ra của từng danh mục (giày dép / đồ bộ / quần áo lẻ) × giá vốn trung bình
-- của danh mục (peso mỗi sản phẩm). Mỗi dòng là một bộ giá vốn bắt đầu có hiệu lực từ effective_date; ngày nào dùng bộ có
-- effective_date lớn nhất không vượt quá ngày đó, nên đổi giá vốn không làm đổi các ngày trước. Chưa có dòng nào thì báo cáo
-- không tự tính giá vốn (giá vốn nhập tay theo ngày vẫn dùng bình thường). Nhập ở trang "Chi phí cố định", tab
-- "Giá vốn theo danh mục".
--
-- CHẠY MỘT LẦN trên database đang dùng:
--     mysql -u <user> -p <database> < database/migrations/2026-11-category-cogs-rates.sql
-- Chỉ tạo bảng MỚI, không đụng tới dữ liệu cũ. Cài mới thì database/schema.sql đã có sẵn bảng này.
-- Chưa chạy file này thì báo cáo vẫn chạy như cũ; chỉ việc lưu giá vốn mới báo cần chạy.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS category_cogs_rates (
  shop_id         BIGINT UNSIGNED NOT NULL COMMENT 'Mã shop trên Pancake POS',
  effective_date  DATE NOT NULL COMMENT 'Bộ giá vốn có hiệu lực từ ngày này',
  shoes           DECIMAL(18,2) NOT NULL COMMENT 'Giày dép: giá vốn trung bình, peso mỗi sản phẩm',
  sets            DECIMAL(18,2) NOT NULL COMMENT 'Đồ bộ: giá vốn trung bình, peso mỗi sản phẩm',
  clothes         DECIMAL(18,2) NOT NULL COMMENT 'Quần áo lẻ: giá vốn trung bình, peso mỗi sản phẩm',
  updated_by      VARCHAR(190) NULL,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id, effective_date),
  CONSTRAINT chk_category_cogs_rates_amounts CHECK (shoes >= 0 AND sets >= 0 AND clothes >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
