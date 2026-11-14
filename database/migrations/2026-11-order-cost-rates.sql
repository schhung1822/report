-- =============================================================================
-- Đơn giá chi phí theo sản phẩm của shop Philippines (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Dịch vụ mua ngoài, giao hàng (PED → Phi và bên Phi), chi phí khác, thuế/phí/lệ phí của shop Phil = số sản phẩm bán ra trong ngày × đơn giá
-- (peso mỗi sản phẩm). Mỗi dòng là một bộ đơn giá bắt đầu có hiệu lực từ effective_date; ngày nào dùng bộ có effective_date lớn nhất
-- không vượt quá ngày đó, nên đổi đơn giá không làm đổi các ngày trước. Chưa có dòng nào thì báo cáo dùng mức mặc định
-- (74 / 577 / 84 / 10 / 15 ₱). Nhập ở trang "Chi phí cố định", tab "Đơn giá theo sản phẩm".
--
-- CHẠY MỘT LẦN trên database đang dùng:
--     mysql -u <user> -p <database> < database/migrations/2026-11-order-cost-rates.sql
-- Chỉ tạo bảng MỚI, không đụng tới dữ liệu cũ. Cài mới thì database/schema.sql đã có sẵn bảng này.
-- Chưa chạy file này thì báo cáo vẫn chạy với mức mặc định; chỉ việc lưu đơn giá mới báo cần chạy.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS order_cost_rates (
  shop_id          BIGINT UNSIGNED NOT NULL COMMENT 'Mã shop trên Pancake POS',
  effective_date   DATE NOT NULL COMMENT 'Bộ đơn giá có hiệu lực từ ngày này',
  outsourced       DECIMAL(18,2) NOT NULL COMMENT 'Dịch vụ mua ngoài, peso mỗi sản phẩm',
  shipping_ped_ph  DECIMAL(18,2) NOT NULL COMMENT 'Giao hàng từ PED đến Phi, peso mỗi sản phẩm',
  shipping_ph      DECIMAL(18,2) NOT NULL COMMENT 'Giao hàng bên Phi, peso mỗi sản phẩm',
  other_cost       DECIMAL(18,2) NOT NULL COMMENT 'Chi phí khác, peso mỗi sản phẩm',
  tax_fee          DECIMAL(18,2) NOT NULL COMMENT 'Thuế, phí và lệ phí, peso mỗi sản phẩm',
  updated_by       VARCHAR(190) NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id, effective_date),
  CONSTRAINT chk_order_cost_rates_amounts CHECK (
    outsourced >= 0 AND shipping_ped_ph >= 0 AND shipping_ph >= 0 AND other_cost >= 0 AND tax_fee >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
