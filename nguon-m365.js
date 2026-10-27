'use strict';

// Bản Microsoft 365 (trang m365/): đăng nhập email công ty, đọc thẳng file CRM mới nhất trên OneDrive qua Microsoft Graph.
// Cùng giao diện với nguon-du-lieu.js để app.js dùng chung.
const Nguon = (() => {
  const cfg = window.LM_CONFIG || {};
  // Files.Read: chỉ đọc OneDrive của chính người đăng nhập, nhân viên tự đồng ý được, không cần quản trị viên.
  // Files.Read.All: đọc cả thư mục người khác chia sẻ, công ty yêu cầu quản trị viên phê duyệt.
  const SCOPES = cfg.scopes || ['Files.Read'];
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  let pca = null;

  const api = {
    account: null,
    redirectLogin: true,   // bấm Đăng nhập là chuyển sang trang Microsoft, không dùng form của app
    autoSyncMinutes: cfg.autoSyncMinutes || 10,
    init, login, logout, latestFile, download, describeError
  };

  async function init() {
    pca = new msal.PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId || 'organizations'}`,
        redirectUri: location.origin + location.pathname.replace(/index\.html$/, '')
      },
      cache: { cacheLocation: 'localStorage' }
    });
    await pca.initialize();
    const res = await pca.handleRedirectPromise();
    const acc = res?.account || pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
    if (acc) pca.setActiveAccount(acc);
    api.account = acc;
    return acc;
  }

  function login() { return pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); }
  function logout() {
    const acc = api.account;
    api.account = null;
    if (pca && acc) pca.logoutRedirect({ account: acc });
  }

  async function token() {
    try {
      return (await pca.acquireTokenSilent({ scopes: SCOPES, account: api.account })).accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError) await pca.acquireTokenRedirect({ scopes: SCOPES, account: api.account });
      throw e;
    }
  }

  async function graph(path) {
    const r = await fetch(GRAPH + path, { headers: { Authorization: 'Bearer ' + await token() } });
    if (!r.ok) throw Object.assign(new Error(`Graph ${r.status}`), { status: r.status });
    return r.json();
  }

  // Mã hóa link chia sẻ theo chuẩn Graph: "u!" + base64url(link)
  function shareId(url) {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(url)));
    return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  }

  // Tìm thư mục trong OneDrive của người đăng nhập trước; không thấy thì thử qua link chia sẻ
  async function folderChildren() {
    const sel = '?$select=id,name,file,lastModifiedDateTime,size,parentReference&$top=999';
    try {
      const path = cfg.folderPath.split('/').map(encodeURIComponent).join('/');
      return (await graph(`/me/drive/root:/${path}:/children${sel}`)).value;
    } catch (err) {
      if (!cfg.folderShareUrl || err.status !== 404) throw err;
    }
    const folder = await graph(`/shares/${shareId(cfg.folderShareUrl)}/driveItem?$select=id,parentReference`);
    return (await graph(`/drives/${folder.parentReference.driveId}/items/${folder.id}/children${sel}`)).value;
  }

  // File Excel/CSV được sửa gần nhất trong thư mục
  async function latestFile() {
    const files = (await folderChildren())
      .filter(f => f.file && /\.(xlsx|xls|csv)$/i.test(f.name) && !f.name.startsWith('~$'));
    files.sort((a, b) => Date.parse(b.lastModifiedDateTime) - Date.parse(a.lastModifiedDateTime));
    if (!files[0]) throw Object.assign(new Error('Thư mục OneDrive chưa có file Excel nào.'), { friendly: true });
    return files[0];
  }

  async function download(f) {
    const item = await graph(`/drives/${f.parentReference.driveId}/items/${f.id}`);
    const r = await fetch(item['@microsoft.graph.downloadUrl']);
    if (!r.ok) throw new Error('Không tải được file: ' + r.status);
    return r.arrayBuffer();
  }

  function describeError(err) {
    if (err.friendly) return err.message;
    if (err.status === 404) return 'Không tìm thấy thư mục dữ liệu trên OneDrive.';
    if (err.status === 401 || err.status === 403) return 'Tài khoản này chưa có quyền đọc thư mục dữ liệu trên OneDrive (cần quản trị viên phê duyệt cho tài khoản khác chủ thư mục).';
    if (err.errorCode) return 'Lỗi đăng nhập Microsoft: ' + (err.errorMessage || err.errorCode).slice(0, 200);
    return null;
  }

  return api;
})();
