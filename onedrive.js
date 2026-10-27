'use strict';

// Đăng nhập Microsoft và lấy file CRM mới nhất trong thư mục OneDrive (qua Microsoft Graph)
const OneDrive = (() => {
  const cfg = window.LM_CONFIG || {};
  // Files.Read: chỉ đọc OneDrive của chính người đăng nhập, nhân viên tự đồng ý được, không cần quản trị viên.
  // Files.Read.All: đọc cả thư mục người khác chia sẻ, công ty yêu cầu quản trị viên phê duyệt.
  const SCOPES = cfg.scopes || ['Files.Read'];
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  let pca = null;

  const api = {
    account: null,
    enabled: () => !!(cfg.clientId && window.msal),
    init, login, logout, latestFile, download, shareId,
    autoSyncMinutes: cfg.autoSyncMinutes || 10
  };

  async function init() {
    if (!api.enabled()) return null;
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
    api.account = res?.account || pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
    if (api.account) pca.setActiveAccount(api.account);
    return api.account;
  }

  function login() { return pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); }
  function logout() { return pca.logoutRedirect({ account: api.account }); }

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
    if (!r.ok) {
      const err = new Error(`Graph ${r.status}`);
      err.status = r.status;
      throw err;
    }
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

  // File Excel/CSV được cập nhật gần nhất trong thư mục
  async function latestFile() {
    const files = (await folderChildren())
      .filter(f => f.file && /\.(xlsx|xls|csv)$/i.test(f.name) && !f.name.startsWith('~$'));
    files.sort((a, b) => Date.parse(b.lastModifiedDateTime) - Date.parse(a.lastModifiedDateTime));
    return files[0] || null;
  }

  async function download(f) {
    const item = await graph(`/drives/${f.parentReference.driveId}/items/${f.id}`);
    const r = await fetch(item['@microsoft.graph.downloadUrl']);
    if (!r.ok) throw new Error('Không tải được file: ' + r.status);
    return r.arrayBuffer();
  }

  return api;
})();
