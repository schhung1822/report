This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Pancake POS (MCP)

Số liệu báo cáo được lấy tự động từ Pancake POS qua MCP (`https://mcp-pos.pancake.biz/mcp`).

1. Tạo API key tại Pancake POS (khuyến nghị key cấp **tài khoản**) và đặt `PANCAKE_POS_API_KEY` trong `.env.local` (xem `.env.example`).
2. Mở trang Báo cáo ngày / Hiệu suất / Quản trị tài chính / Tổng hợp, chọn shop + **từ ngày – đến ngày** (1 đến 93 ngày; có nút Hôm qua / 7 ngày qua / Tháng này / Tháng trước) rồi bấm **Lấy dữ liệu từ Pancake POS**.
   - Mọi báo cáo đọc từ một bộ dữ liệu chuẩn hoá `PosDataset` (`lib/pancake/dataset.ts`): theo ngày, theo nhân sự, theo ngày × nguồn × sản phẩm, mỗi dòng có 4 góc nhìn *tạo / chốt / hoàn / ròng*. Nút **Tải JSON chuẩn hoá** xuất đúng bộ dữ liệu đó.
   - Mỗi lần lấy đều tự đối soát (tổng ngày = tổng API = tổng nhân sự = tổng nguồn × sản phẩm); lệch thì có cảnh báo ⚠ kèm số chênh.
   - Shop **VND** → Báo cáo ngày, Hiệu suất, Quản trị TC Việt (kênh Zalo/Page). Shop **PHP** → Quản trị TC Philippines.
   - Kênh Zalo/Page được suy ra từ tên nguồn đơn (mặc định chứa “zalo” là Zalo, còn lại là Page; đổi bằng `PANCAKE_ZALO_SOURCE_PATTERN`).
3. Khoản không có trong POS (lương, định phí, ads, dự phòng hoàn, tỷ giá) nhập bằng **file chi phí**: bấm “File mẫu” trên thẻ đồng bộ. Dòng có cột *Nhân sự* → báo cáo hiệu suất; có cột *Kênh* → báo cáo Việt; để trống cả hai → cả shop (Philippines). Bỏ trống *Ngày* = áp dụng mọi ngày.
4. Định nghĩa các chỉ số (dự tính, thực tế, giá vốn, phí ship…) nằm ở đầu `lib/pancake/mappers.ts`. Pancake gom “ngày” theo UTC+7 cho mọi shop.
5. **Chi phí cố định lưu trong MySQL**: chạy `database/schema.sql`, điền `MYSQL_URL` (hoặc `MYSQL_HOST/USER/PASSWORD/DATABASE`) vào `.env.local`, rồi nhập tại trang **Chi phí cố định**. Mỗi khoản có loại, phạm vi (cả shop / kênh / nhân sự), chu kỳ (hằng ngày / hằng tháng chia đều theo ngày / một lần) và thời gian hiệu lực. Khi đồng bộ, hệ thống tự phân bổ theo từng ngày trong khoảng đã chọn và cộng vào báo cáo; nếu MySQL đã cấu hình nhưng không đọc được thì đồng bộ báo lỗi chứ không cho ra báo cáo thiếu chi phí. Sau khi đồng bộ từ POS, thẻ đồng bộ hiện **bảng chi phí theo nhân sự** (lương cứng, thưởng và định phí mỗi tháng của từng người, chọn ngày áp dụng; đổi lương thì các kỳ trước giữ mức cũ). **Lương và thưởng tính theo công**: nhập thêm *số công chuẩn* của tháng, chi phí mỗi ngày = (lương + thưởng) ÷ số công chuẩn và chỉ tính cho những ngày nhân sự có đơn hoặc doanh thu trong POS (ngày nghỉ bỏ qua), nên báo cáo 1 ngày lấy 1 ngày công, 2 ngày lấy 2 ngày công. Thưởng được tính chung vào dòng lương của các báo cáo. Tính năng này cần cột `work_days` và loại `bonus` trong bảng `cost_entries`: database đã tạo từ trước phải chạy **một lần** `database/migrations/2026-11-staff-work-days.sql` (cài mới chỉ cần `schema.sql`). Chưa chạy thì báo cáo vẫn lấy chi phí như cũ, chỉ việc lưu lương theo công báo lỗi. File chi phí vẫn dùng được (cộng dồn với MySQL, đừng nhập trùng). Server MySQL dùng chứng chỉ tự ký: đặt `MYSQL_SSL_CA` (khuyến nghị) hoặc `MYSQL_SSL=no-verify`.
6. **Tỷ giá tự đặt** (PHP → VND) nhập tại trang **Tỷ giá**, lưu trong MySQL (bảng `exchange_rates`, chạy lại `database/schema.sql` để tạo). Mỗi mức có ngày hiệu lực và được giữ trong lịch sử; báo cáo Philippines quy đổi **mọi ngày** bằng mức mới nhất đã có hiệu lực (mức đặt cho ngày tương lai chỉ dùng từ ngày đó). Tỷ giá ghi riêng cho một ngày trong file chi phí vẫn được ưu tiên cho ngày đó.
7. **Lịch sử báo cáo**: mỗi lần lấy dữ liệu từ Pancake được tự lưu vào MySQL (bảng `report_snapshots`, chạy lại `database/schema.sql` để tạo) kèm toàn bộ số liệu, cảnh báo và kết quả đối soát. Mở lại trang hoặc chuyển tab sẽ tự hiện báo cáo đã lưu mới nhất; nút **Lịch sử báo cáo** trong thẻ cấu hình để mở lại bản cũ, chọn nhiều bản và xóa. Bản cùng shop + cùng khoảng ngày + cùng người lấy trong vòng 15 phút sẽ thay thế nhau. Báo cáo nạp từ file Excel/CSV chưa được lưu.
8. **Tất cả shop** (trang Báo cáo tổng hợp): chọn “Tất cả shop” để lấy mọi shop VND/PHP một lần (tối đa 3 shop cùng lúc); mỗi shop được lưu thành một báo cáo trong lịch sử. Shop Việt điền các tab Việt, shop Philippines điền tab Philippines. Nếu có nhiều shop cùng tiền tệ, dòng chọn shop phía trên các tab cho phép đổi shop đang hiển thị. File chi phí (nếu nạp) được áp cho mọi shop.
9. **Phân tích AI** mặc định dùng GPT-5.2. Khi GPT lỗi tạm thời (quá tải, hết thời gian chờ) hệ thống tự chuyển sang Claude Opus 4.7 và ghi rõ trên kết quả; chọn Claude thủ công thì không có dự phòng.
10. **Biểu đồ**: các mẫu trong thư mục `chart/` (cash flow, expenses, income overview, portfolio allocation, revenue by product line) được Việt hoá và gắn vào các báo cáo qua `components/charts/`. Các module nền mà mẫu cần (`components/ui/chart-*.tsx`, `hooks/use-chart-*.ts`, `lib/chart-*.ts`, bảng màu và kiểu chữ trong `app/globals.css`) được viết lại theo cách mẫu gọi chúng, nên nếu bạn có bản gốc của bộ thiết kế thì thay vào được. Xuất ảnh/PDF luôn đưa biểu đồ về trạng thái hoàn chỉnh trước khi chụp.
11. **Phân tích vận hành** (menu Kinh doanh): tỷ lệ hoàn, tỷ lệ chốt đơn, biên lợi nhuận, giá trị đơn, ROAS, COD còn phải thu, cơ cấu sản phẩm/nhân sự, phễu chốt đơn theo nhân sự và theo thứ trong tuần; công thức ghi ở đầu `lib/pancake/kpi.ts`. Chỉ số không tính được (mẫu số bằng 0) hiện “—”.
12. Dùng cùng MCP trong Claude Code: `.mcp.json` đã khai báo server `pancake-pos`, chỉ cần đặt biến môi trường `PANCAKE_POS_API_KEY` trong shell.
13. **Quảng cáo Meta (Ads MCP)**: đặt `ADS_MCP_URL` trong `.env.local` (địa chỉ MCP đã gồm token — coi như mật khẩu, không đưa vào mã nguồn hay chat công khai). Trang **Quảng cáo Meta** (menu Kinh doanh) lấy chi tiêu, hiển thị, click, CTR/CPC/CPM, đơn mua, giá trị chuyển đổi, ROAS, tin nhắn theo tài khoản, theo ngày và theo chiến dịch; chỉ đọc, không sửa được gì trên Meta. Mỗi báo cáo chỉ gồm một loại tiền tệ (ưu tiên VND), tài khoản khác tiền tệ bị bỏ và có ghi chú.
14. **Gắn nhãn tài khoản quảng cáo**: nút “Gắn nhãn shop Việt / Phil” trên trang Quảng cáo Meta. Nhãn lưu trong MySQL (bảng `ads_account_labels`, chạy lại `database/schema.sql`). Khi lấy dữ liệu Pancake, báo cáo của mỗi shop tự lấy chi tiêu từ các tài khoản gắn nhãn cho shop đó (tắt được bằng ô “Chi phí quảng cáo từ Meta” ở mục Chi phí & tuỳ chọn): **shop Phil** — chi tiêu (₫) chia cho tỷ giá từng ngày ra peso, thành chi phí ads của báo cáo; **shop Việt** — tài khoản có chọn kênh Zalo/Page vào chi phí ads của kênh đó trong báo cáo quản trị, tài khoản chưa chọn kênh chỉ dùng để tính ROAS ở báo cáo Phân tích vận hành. Ngày/kênh đã nhập ads tay thì giữ số nhập tay, không cộng thêm. Meta lỗi thì báo cáo vẫn được tạo, kèm cảnh báo ⚠.
15. **Chi phí vào báo cáo**: báo cáo Philippines cộng mọi chi phí (cả shop, theo kênh, theo nhân sự) vì chỉ có một bộ phận. Báo cáo quản trị Việt lấy chi phí theo kênh như trước, và chia chi phí cả shop + chi phí theo nhân sự cho Zalo/Page theo tỷ trọng doanh thu từng ngày (không có doanh thu thì chia đều). Báo cáo Hiệu suất vẫn tính lương theo từng nhân sự.
16. **Chi phí lương, kế toán theo ngày và ads** (trang **Chi phí cố định**, 4 tab, khoảng ngày chọn ở thanh bên). **Lương nhân sự**: bấm **Quét nhân viên** để đọc danh sách nhân viên của POS (shop Việt và shop Phil) cùng đơn/doanh thu từng người trong khoảng ngày; nhập lương cứng, thưởng, định phí mỗi tháng và số công chuẩn, lương chỉ tính những ngày nhân viên có đơn (mặc định chỉ hiện người có đơn, tích ô để hiện cả người chưa có đơn). **Chi phí ads không nhập**: lấy tự động từ Ads Meta của các tài khoản đã gắn nhãn shop. **Bảng kế toán theo ngày**: kế toán tổng hợp các khoản còn lại theo từng ngày, tải **file mẫu** (hoặc **Xuất số đã lưu** để sửa tiếp), điền, **Nhập file đã điền** → xem trước (số ngày, tổng từng cột, bao nhiêu ô mới / ghi đè) → **Lưu vào MySQL**. Shop Việt: mỗi ngày 2 dòng Zalo/Page với giá vốn dự tính hoàn, chi phí cố định, chi phí khác. Shop Phil (peso): mỗi ngày 1 dòng với giá vốn hàng bán, dự phòng rủi ro hàng tồn, dịch vụ mua ngoài, giao hàng (PED→Phi và bên Phi), chi phí khác, thuế/phí/lệ phí. Cột lương và ADS trong danh sách của kế toán (và dòng “Tổng”) được bỏ qua kèm ghi chú. Ô để trống giữ nguyên số đã lưu, ô điền 0 lưu là 0; nhập lại cùng ngày ghi đè chứ không cộng dồn. **Quy tắc áp dụng**: ngày nào bảng kế toán có số > 0 cho một khoản (định phí, chi phí khác, dự phòng hoàn) thì báo cáo quản trị Việt / Phil dùng số kế toán thay cho số ước tính của đúng ngày và khoản đó (ví dụ định phí nhập hằng tháng). Shop Phil: giá vốn và phí giao hàng của kế toán thay cho số POS (POS Phil không có giá vốn); thuế/phí/lệ phí được trừ riêng sau chi phí bán hàng, thành một dòng riêng trong bảng bóc tách. Báo cáo cảnh báo những ngày trong kỳ chưa có số kế toán. Bảng kế toán cần bảng `daily_costs`: database đã tạo từ trước chạy **một lần** `database/migrations/2026-11-daily-costs.sql` (cài mới chỉ cần `schema.sql`); chưa chạy thì báo cáo vẫn chạy như cũ, tab lương nhân sự không cần bảng này.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
