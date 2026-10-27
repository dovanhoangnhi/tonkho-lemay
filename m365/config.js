// Cấu hình bản Microsoft 365. Địa chỉ trang này (…/tonkho-lemay/m365/) phải có trong
// Microsoft Entra > app "Theo Dõi Tồn Kho Lê Mây" > Authentication > Single-page application.
window.LM_CONFIG = {
  base: '../',               // ảnh, sw.js nằm ở thư mục cha
  storagePrefix: 'm365_',    // tách dữ liệu lưu trên máy với bản tài khoản riêng
  clientId: '267c6b3f-cca2-4294-a7e6-4af216ffcb2a',
  tenantId: '36987871-9c3e-4fee-952c-503d196b2b16',
  // ['Files.Read']: chỉ chủ thư mục (nhi.dvh1) đọc được, không cần quản trị viên.
  // ['Files.Read.All']: mỗi người dùng email riêng, cần quản trị viên phê duyệt Files.Read.All trước.
  scopes: ['Files.Read'],
  folderPath: 'Công Việc Lê Mây/Tồn Kho Lê Mây/Dữ liệu tồn kho trên CRM',
  folderShareUrl: 'https://congtylemay-my.sharepoint.com/:f:/g/personal/nhi_dvh1_lemay_com_vn/IgCjZM-gnZpPRoqvTf3Lw3UBAQyTneRkgrCpNoOca0xWPK8?e=bReNn1',
  autoSyncMinutes: 1
};
