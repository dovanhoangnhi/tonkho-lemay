// Cấu hình kết nối OneDrive. Điền sau khi đăng ký app trên Microsoft Entra (xem HUONG-DAN-ONEDRIVE.md).
// Để trống clientId thì app chạy chế độ tải file thủ công.
window.LM_CONFIG = {
  clientId: '267c6b3f-cca2-4294-a7e6-4af216ffcb2a',        // Application (client) ID
  tenantId: '36987871-9c3e-4fee-952c-503d196b2b16',        // Directory (tenant) ID
  // Link chia sẻ thư mục "Dữ liệu tồn kho trên CRM" (OneDrive > Chia sẻ > Sao chép liên kết).
  // Có link này thì mọi nhân viên được chia sẻ thư mục đều đọc được.
  folderShareUrl: 'https://congtylemay-my.sharepoint.com/:f:/g/personal/nhi_dvh1_lemay_com_vn/IgCjZM-gnZpPRoqvTf3Lw3UBAQyTneRkgrCpNoOca0xWPK8?e=bReNn1',
  // Dùng khi chưa có link chia sẻ: đường dẫn thư mục tính từ gốc OneDrive của người đăng nhập.
  folderPath: 'Công Việc Lê Mây/Tồn Kho Lê Mây/Dữ liệu tồn kho trên CRM',
  // ['Files.Read']: chỉ chủ thư mục (nhi.dvh1) đọc được, không cần quản trị viên.
  // ['Files.Read.All']: mỗi người dùng email riêng, cần quản trị viên bấm "Grant admin consent" trước.
  scopes: ['Files.Read.All'],
  autoSyncMinutes: 10  // khi app đang mở, cứ bao nhiêu phút kiểm tra file mới một lần
};
