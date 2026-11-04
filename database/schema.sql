-- =============================================================================
-- Cơ sở dữ liệu chi phí cố định cho báo cáo (MySQL 8.0.16+ hoặc MariaDB 10.2+)
--
-- Cách chạy:
--   1. Tạo database (bỏ qua nếu đã có):
--        CREATE DATABASE baocao CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2. Chạy file này trên database đó:
--        mysql -u <user> -p baocao < database/schema.sql
--   3. Điền MYSQL_URL (hoặc MYSQL_HOST/USER/PASSWORD/DATABASE) vào .env.local.
--
-- File an toàn khi chạy lại nhiều lần (CREATE TABLE IF NOT EXISTS).
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cost_entries (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Mã shop trên Pancake POS (ví dụ 715144184). Mỗi shop có danh sách chi phí riêng.
  shop_id     BIGINT UNSIGNED NOT NULL,

  -- Khoản chi phí này tính cho ai:
  --   shop    : cả shop (báo cáo Philippines dùng loại này)
  --   channel : một kênh Zalo / Page (báo cáo quản trị Việt)
  --   staff   : một nhân sự (báo cáo hiệu suất)
  scope       ENUM('shop','channel','staff') NOT NULL DEFAULT 'shop',
  channel     ENUM('zalo','page') NULL,
  staff_name  VARCHAR(120) NULL COMMENT 'Đúng tên nhân sự như hiển thị trong Pancake POS',

  -- Loại chi phí (khớp các cột của báo cáo)
  cost_type   ENUM(
                'salary_sale_cskh',   -- Lương CSKH-Sale
                'salary_other',       -- Lương bộ phận khác
                'bonus',              -- Thưởng nhân sự (báo cáo tính chung vào lương)
                'fixed_cost',         -- Định phí (chi phí cố định: thuê mặt bằng, phần mềm, ...)
                'other_cost',         -- Chi phí khác
                'ads_cost',           -- Chi phí marketing (ads)
                'return_provision'    -- Dự phòng hoàn
              ) NOT NULL,
  label       VARCHAR(160) NOT NULL DEFAULT '' COMMENT 'Tên khoản, ví dụ: Thuê mặt bằng',

  amount      DECIMAL(18,2) NOT NULL COMMENT 'Số tiền theo tiền tệ của shop (VND hoặc PHP)',

  -- Cách tính số tiền:
  --   daily   : amount là số tiền MỖI NGÀY trong khoảng hiệu lực
  --   monthly : amount là số tiền MỖI THÁNG, chia đều theo số ngày của tháng (ngày cuối tháng nhận phần dư
  --             để cả tháng cộng lại đúng bằng amount)
  --   once    : amount tính một lần vào đúng ngày valid_from
  period      ENUM('daily','monthly','once') NOT NULL DEFAULT 'monthly',

  -- Số công chuẩn của tháng (chỉ cho khoản hằng tháng của nhân sự). Có giá trị = lương/thưởng tháng chia cho số công:
  -- mỗi ngày nhân sự có đơn hoặc doanh thu trong POS tính amount / work_days, ngày nghỉ không tính.
  -- NULL = chia đều theo số ngày của tháng như trên.
  work_days   TINYINT UNSIGNED NULL,

  valid_from  DATE NOT NULL,
  valid_to    DATE NULL COMMENT 'NULL = còn hiệu lực đến khi sửa/xóa',

  note        VARCHAR(255) NULL,
  created_by  VARCHAR(190) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_cost_entries_shop_dates (shop_id, valid_from, valid_to),

  CONSTRAINT chk_cost_entries_scope CHECK (
       (scope = 'shop'    AND channel IS NULL     AND staff_name IS NULL)
    OR (scope = 'channel' AND channel IS NOT NULL AND staff_name IS NULL)
    OR (scope = 'staff'   AND channel IS NULL     AND staff_name IS NOT NULL)
  ),
  CONSTRAINT chk_cost_entries_amount CHECK (amount >= 0),
  CONSTRAINT chk_cost_entries_dates  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT chk_cost_entries_once   CHECK (period <> 'once' OR (valid_to IS NOT NULL AND valid_to = valid_from)),
  CONSTRAINT chk_cost_entries_work_days CHECK (
    work_days IS NULL OR (work_days BETWEEN 1 AND 31 AND scope = 'staff' AND period = 'monthly')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đã có bảng cost_entries từ trước (tạo trước khi có cột work_days và loại 'bonus')? Chạy MỘT LẦN:
--   database/migrations/2026-11-staff-work-days.sql

-- -----------------------------------------------------------------------------
-- Ví dụ (bỏ comment để thử; thay shop_id bằng mã shop thật):
--
-- -- Định phí kênh Zalo: 8.000.000 ₫/tháng từ 01/11/2026, chia đều theo ngày
-- INSERT INTO cost_entries (shop_id, scope, channel, cost_type, label, amount, period, valid_from)
-- VALUES (715144184, 'channel', 'zalo', 'fixed_cost', 'Thuê mặt bằng', 8000000, 'monthly', '2026-11-01');
--
-- -- Lương một nhân sự: 500.000 ₫/ngày trong tháng 11/2026
-- INSERT INTO cost_entries (shop_id, scope, staff_name, cost_type, label, amount, period, valid_from, valid_to)
-- VALUES (715144184, 'staff', 'Leo Hùng', 'salary_sale_cskh', 'Lương ngày', 500000, 'daily', '2026-11-01', '2026-11-30');
--
-- -- Một khoản chi một lần (mua phần mềm) vào 05/11/2026
-- INSERT INTO cost_entries (shop_id, scope, cost_type, label, amount, period, valid_from, valid_to)
-- VALUES (715144184, 'shop', 'other_cost', 'Mua phần mềm', 1200000, 'once', '2026-11-05', '2026-11-05');
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Bảng chi phí kế toán theo ngày (xem database/migrations/2026-11-daily-costs.sql).
-- Mỗi dòng là một ô của danh sách kế toán: một ngày, một kênh (zalo/page; rỗng = cả shop), một khoản chi phí.
-- Ngày nào có số (>0) thì báo cáo dùng số kế toán thay cho số ước tính của đúng ngày và khoản đó.
-- =============================================================================
CREATE TABLE IF NOT EXISTS daily_costs (
  shop_id     BIGINT UNSIGNED NOT NULL COMMENT 'Mã shop trên Pancake POS',
  cost_date   DATE NOT NULL,
  channel     VARCHAR(8) NOT NULL DEFAULT '' COMMENT 'zalo | page (shop Việt Nam); rỗng = cả shop (shop Philippines)',
  line_key    VARCHAR(40) NOT NULL COMMENT 'return_provision, fixed_cost, other_cost, cogs, shipping_ped_ph, shipping_ph, tax_fee',
  amount      DECIMAL(18,2) NOT NULL COMMENT 'Số tiền theo tiền tệ của shop (VND hoặc PHP)',
  updated_by  VARCHAR(190) NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id, cost_date, channel, line_key),
  CONSTRAINT chk_daily_costs_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Tỷ giá tự đặt (ví dụ 1 PHP = ? VND), có lịch sử.
-- Mỗi dòng là một mức tỷ giá bắt đầu có hiệu lực từ effective_date. Báo cáo luôn dùng mức MỚI NHẤT đã có hiệu lực
-- (effective_date lớn nhất không vượt quá hôm nay); mức đặt cho ngày tương lai chưa được dùng cho đến ngày đó.
-- Mỗi cặp tiền + ngày chỉ có một dòng: nhập lại cùng ngày sẽ sửa dòng đó.
--
-- Nếu bạn đã chạy file này trước đây, chạy lại toàn bộ file là an toàn (chỉ tạo bảng còn thiếu).
-- =============================================================================
CREATE TABLE IF NOT EXISTS exchange_rates (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_currency  CHAR(3) NOT NULL DEFAULT 'PHP',
  to_currency    CHAR(3) NOT NULL DEFAULT 'VND',
  rate           DECIMAL(18,6) NOT NULL COMMENT '1 đơn vị from_currency = rate đơn vị to_currency',
  effective_date DATE NOT NULL COMMENT 'Có hiệu lực từ ngày này',
  note           VARCHAR(255) NULL,
  created_by     VARCHAR(190) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_exchange_rates_pair_date (from_currency, to_currency, effective_date),

  CONSTRAINT chk_exchange_rates_rate CHECK (rate > 0),
  CONSTRAINT chk_exchange_rates_pair CHECK (from_currency <> to_currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ví dụ (bỏ comment để thử):
-- INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, note)
-- VALUES ('PHP', 'VND', 450.5, '2026-11-01', 'Tỷ giá nội bộ tháng 11');

-- =============================================================================
-- Lịch sử báo cáo: mỗi lần lấy dữ liệu từ Pancake POS được lưu thành một bản chụp để xem lại sau
-- (không mất khi tải lại trang hoặc chuyển tab). Chạy lại file này là an toàn.
--
--   payload : toàn bộ kết quả lấy dữ liệu (dataset chuẩn hóa, các báo cáo, cảnh báo, kết quả đối soát) dạng JSON.
--             Bản chụp giữ nguyên số liệu, chi phí và tỷ giá tại thời điểm lấy, nên đổi chi phí/tỷ giá sau này
--             không làm thay đổi báo cáo đã lưu.
--   Các cột còn lại là bản tóm tắt để liệt kê nhanh mà không phải đọc payload.
--
-- Bản chụp cùng shop + cùng khoảng ngày + cùng người lấy, tạo trong vòng 15 phút, được thay thế bằng bản mới nhất
-- (tránh đầy lịch sử khi vừa sửa chi phí vừa lấy lại dữ liệu).
-- =============================================================================
CREATE TABLE IF NOT EXISTS report_snapshots (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id       BIGINT UNSIGNED NOT NULL,
  shop_name     VARCHAR(190) NOT NULL,
  currency      CHAR(3) NOT NULL COMMENT 'Tiền tệ của shop: VND hoặc PHP',
  range_from    DATE NOT NULL,
  range_to      DATE NOT NULL,
  day_count     SMALLINT UNSIGNED NOT NULL,
  order_count   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Đơn thực tế (chốt trừ hoàn) trong kỳ',
  revenue       DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Doanh thu thực tế (chốt trừ hoàn) trong kỳ',
  warning_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  has_alarm     TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = đối soát số liệu bị lệch',
  payload       JSON NOT NULL,
  created_by    VARCHAR(190) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_report_snapshots_shop_created (shop_id, created_at),
  KEY idx_report_snapshots_currency_created (currency, created_at),

  CONSTRAINT chk_report_snapshots_range CHECK (range_to >= range_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Nhãn tài khoản quảng cáo Meta (Ads MCP)
--   Cho biết mỗi tài khoản quảng cáo chạy cho shop nào, để báo cáo lấy đúng chi tiêu quảng cáo:
--     market = 'PH' : shop Philippines. Chi tiêu (VND) chia tỷ giá từng ngày ra peso, thành chi phí ads của báo cáo PH.
--     market = 'VN' : shop Việt Nam. Nếu có channel ('zalo' | 'page') chi tiêu vào chi phí ads của kênh đó trong báo cáo
--                     quản trị; channel rỗng = chưa phân kênh (chỉ dùng cho ROAS ở báo cáo Phân tích vận hành).
--   Một tài khoản có thể có cả nhãn VN và PH (mỗi nhãn một dòng), nhưng chi tiêu của nó sẽ được tính ở cả hai báo cáo.
-- =============================================================================
CREATE TABLE IF NOT EXISTS ads_account_labels (
  account_id VARCHAR(64) NOT NULL COMMENT 'Mã tài khoản quảng cáo Meta, dạng act_123…',
  market     CHAR(2) NOT NULL COMMENT 'VN = shop Việt Nam, PH = shop Philippines',
  channel    VARCHAR(8) NOT NULL DEFAULT '' COMMENT 'zalo | page (chỉ với market VN); rỗng = chưa phân kênh',
  updated_by VARCHAR(190) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (account_id, market),

  CONSTRAINT chk_ads_account_labels_market CHECK (market IN ('VN', 'PH')),
  CONSTRAINT chk_ads_account_labels_channel CHECK (channel IN ('', 'zalo', 'page')),
  CONSTRAINT chk_ads_account_labels_channel_vn CHECK (channel = '' OR market = 'VN')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
