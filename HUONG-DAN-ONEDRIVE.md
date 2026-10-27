# Kết nối app với OneDrive

App đăng nhập bằng tài khoản Microsoft công ty, rồi tự lấy file CRM **sửa đổi gần nhất** trong thư mục **Dữ liệu tồn kho trên CRM**. App kiểm tra file mới khi mở, mỗi 10 phút khi đang mở, và khi bấm **Đồng bộ**. Không có mạng thì app dùng dữ liệu đã lưu lần trước.

Thông tin đăng ký app (đã điền trong `config.js`):

- App: **Theo Dõi Tồn Kho Lê Mây**
- Client ID: `267c6b3f-cca2-4294-a7e6-4af216ffcb2a`
- Tenant ID: `36987871-9c3e-4fee-952c-503d196b2b16`
- Redirect URI (loại **Single-page application**): `http://localhost:8765/app/`, cộng thêm địa chỉ web khi đưa app lên mạng

## Cho 3 người mỗi người dùng email công ty riêng

Hiện chỉ tài khoản **nhi.dvh1@lemay.com.vn** (chủ thư mục) đọc được. Để thêm người:

### 1. Quản trị viên Microsoft 365 phê duyệt quyền (1 lần, khoảng 1 phút)

Người có quyền **Global Administrator** hoặc **Cloud Application Administrator** làm:

1. Vào https://entra.microsoft.com, chọn **App registrations > All applications**, mở **Theo Dõi Tồn Kho Lê Mây**.
2. Vào **API permissions**. Nếu chưa có **Files.Read.All** thì bấm **Add a permission > Microsoft Graph > Delegated permissions**, tick **Files.Read.All**, bấm **Add permissions**.
3. Bấm **Grant admin consent for lemay.com.vn**, chọn **Yes**.
4. Kiểm tra dòng **Files.Read.All** hiện dấu tích xanh *Granted for lemay.com.vn*.

Muốn chỉ đúng 3 người được dùng app: vào **Enterprise applications**, mở app, chọn **Properties**, bật **Assignment required? = Yes**, rồi vào **Users and groups** thêm 3 người.

### 2. Chia sẻ thư mục cho 2 người còn lại

Trên OneDrive web, bấm chuột phải thư mục **Dữ liệu tồn kho trên CRM**, chọn **Chia sẻ**, nhập email 2 người, chọn quyền **Có thể xem**, bấm **Gửi**.

### 3. Báo Claude

Claude sẽ đổi `scopes` trong `config.js` sang `['Files.Read.All']` và cập nhật app trên web.
