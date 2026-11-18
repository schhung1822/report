# Triển khai lên VPS (Hostinger KVM, Ubuntu 22.04/24.04)

Gói Cloud/Web Apps của Hostinger không cho cài Chrome, nên API `/api/external/daily-reports` (dựng PDF bằng Chrome headless)
cần chạy trên VPS. Cả app chạy trên VPS, các hosting cũ có thể bỏ sau khi chuyển xong.
VPS nên có tối thiểu **2 GB RAM** (Next.js + Chrome); gói KVM 1 (4 GB) là đủ.

Mọi lệnh dưới đây chạy trong SSH của VPS, với quyền root (hoặc thêm `sudo`).

## 1. Cài phần mềm nền

```bash
apt update && apt upgrade -y
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx certbot python3-certbot-nginx git unzip fonts-liberation fonts-noto-core
npm install -g pm2

# Google Chrome (KHÔNG dùng "apt install chromium" trên Ubuntu: đó là bản snap, chạy headless không ổn định)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt install -y ./google-chrome-stable_current_amd64.deb
google-chrome --version        # phải in ra phiên bản
```

(VPS dùng Debian thì `apt install -y chromium` được, khi đó đặt `CHROME_PATH=/usr/bin/chromium`.)

## 2. Đưa mã nguồn lên

```bash
mkdir -p /var/www && cd /var/www
git clone <địa-chỉ-repo> baocao && cd baocao      # hoặc upload thư mục dự án (bỏ node_modules và .next) rồi giải nén
npm ci
```

Tạo file `/var/www/baocao/.env.local` với **đủ biến như file .env trên hosting cũ** (xem `.env.example`), thêm:

```
EXTERNAL_API_KEY=<chuỗi ngẫu nhiên ≥ 24 ký tự>
# CHROME_PATH=/usr/bin/google-chrome     (chỉ cần khi Chrome nằm chỗ khác)
```

Lưu ý khi chuyển server:
- **MySQL**: nếu database nằm ở Hostinger, vào mục *Remote MySQL* của hosting và cho phép **địa chỉ IP của VPS**, nếu không app sẽ báo không đọc được chi phí/tỷ giá.
- Giữ nguyên `AUTH_SECRET` cũ thì các phiên đăng nhập hiện có vẫn dùng được.

## 3. Build và chạy

```bash
cd /var/www/baocao
npm run build
PORT=3000 pm2 start npm --name baocao -- start
pm2 save
pm2 startup        # chạy đúng lệnh mà nó in ra để app tự bật lại khi VPS khởi động lại
```

Xem log: `pm2 logs baocao`. Cập nhật sau này: `git pull && npm ci && npm run build && pm2 restart baocao`.

## 4. Nginx + HTTPS

`/etc/nginx/sites-available/baocao`:

```nginx
server {
    listen 80;
    server_name report.activate.vn;

    # bắt buộc: nút "Gửi Lark" tải ảnh/PDF báo cáo (thường 1-5 MB, tối đa 30 MB) lên app.
    # Mặc định nginx chỉ nhận 1 MB nên báo cáo Hiệu suất / Việt / Phil bị chặn (lỗi 413).
    client_max_body_size 40m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # bắt buộc: app dựa vào đây để biết request là https (cookie đăng nhập)
        proxy_set_header X-Forwarded-Proto $scheme;
        # API tạo báo cáo chạy 30-90 giây; mặc định nginx chỉ chờ 60 giây
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/baocao /etc/nginx/sites-enabled/baocao
nginx -t && systemctl reload nginx
```

Trỏ DNS: đổi bản ghi **A** của `report.activate.vn` về IP của VPS (chờ DNS cập nhật), rồi:

```bash
certbot --nginx -d report.activate.vn
```

Nếu domain dùng Cloudflare: đặt proxy ở chế độ "DNS only" khi xin chứng chỉ, và nhớ Cloudflare ngắt request sau 100 giây,
nên với n8n hãy dùng `"async": true` (xem bên dưới).

## 5. Kiểm tra

```bash
# 1) code đã lên và key đúng: phải trả 400 "ngày trong tương lai"
curl -X POST https://report.activate.vn/api/external/daily-reports \
  -H "Authorization: Bearer <KEY>" -d '{"date":"2099-01-01"}'

# 2) Chrome chạy được: tạo thật báo cáo của một ngày và gửi vào nhóm Lark
curl -X POST https://report.activate.vn/api/external/daily-reports \
  -H "Authorization: Bearer <KEY>" -d '{"date":"2026-11-09"}'
```

Nếu bước 2 lỗi, xem `pm2 logs baocao` (tìm `[external/daily-reports]`), và kiểm tra `free -m` (cần ≥ 1 GB trống).

## 6. Cấu hình n8n

- URL: `https://report.activate.vn/api/external/daily-reports`, phương thức POST, header `Authorization: Bearer <KEY>`.
- Body JSON `{ "date": "…" }`. Muốn n8n khỏi chờ lâu, thêm `"async": true`: API trả 202 ngay và gửi Lark khi xong
  (kết quả từng báo cáo nằm trong `pm2 logs baocao`).
- Nếu để chạy đồng bộ, đặt timeout của node HTTP Request ≥ 300 giây.
