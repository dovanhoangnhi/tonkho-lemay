'use strict';

// Đăng nhập bằng tài khoản riêng của app và giải mã dữ liệu tồn kho do laptop đẩy lên (data/).
// Cách mã hóa khớp với dong-bo-laptop/ton-kho-lib.ps1:
// - users.json: khóa chính 64 byte, bọc riêng cho từng tài khoản bằng khóa sinh từ mật khẩu (PBKDF2-SHA256)
// - ton-kho.json: file CRM mã hóa AES-256-CBC + HMAC-SHA256 bằng khóa chính
const Nguon = (() => {
  const cfg = window.LM_CONFIG || {};
  const LS_SESSION = 'lm_session_v1';
  const te = new TextEncoder();
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u8 => btoa(String.fromCharCode(...u8));
  let master = null;

  const api = {
    account: null,
    autoSyncMinutes: cfg.autoSyncMinutes || 10,
    init, login, logout, latestFile, download
  };

  const fail = (message, extra) => Object.assign(new Error(message), extra);

  async function fetchJson(name) {
    const r = await fetch(`${cfg.dataPath || 'data/'}${name}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw fail('HTTP ' + r.status, { status: r.status });
    return r.json();
  }

  async function sha256Hex(text) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)));
    return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function importPair(raw64) {
    return {
      enc: await crypto.subtle.importKey('raw', raw64.slice(0, 32), 'AES-CBC', false, ['decrypt']),
      mac: await crypto.subtle.importKey('raw', raw64.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    };
  }

  // Kiểm chữ ký trước rồi mới giải mã
  async function openBox(box, keys) {
    const iv = fromB64(box.iv), ct = fromB64(box.ct);
    const signed = new Uint8Array(iv.length + ct.length);
    signed.set(iv); signed.set(ct, iv.length);
    if (!await crypto.subtle.verify('HMAC', keys.mac, fromB64(box.mac), signed)) throw fail('Sai khóa', { code: 'badkey' });
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, keys.enc, ct));
  }

  async function unlockWith(id, kek) {
    const users = await fetchJson('users.json');
    const u = users.users?.[id];
    if (!u) throw fail('Không có tài khoản', { code: 'nouser' });
    master = await importPair(await openBox(u, await importPair(kek)));
  }

  async function init() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
      if (s?.id && s?.kek) api.account = { username: s.name, id: s.id, kek: fromB64(s.kek) };
    } catch { api.account = null; }
    return api.account;
  }

  async function login(name, password) {
    name = String(name || '').trim().toLowerCase();
    const users = await fetchJson('users.json');
    const id = await sha256Hex(name);
    const u = users.users?.[id];
    if (!u) throw fail('Sai tên đăng nhập hoặc mật khẩu', { code: 'badlogin' });
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
    const kek = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(u.salt), iterations: users.iter }, base, 512));
    try { master = await importPair(await openBox(u, await importPair(kek))); }
    catch { throw fail('Sai tên đăng nhập hoặc mật khẩu', { code: 'badlogin' }); }
    api.account = { username: name, id, kek };
    try { localStorage.setItem(LS_SESSION, JSON.stringify({ name, id, kek: toB64(kek) })); } catch { }
    return api.account;
  }

  function logout() {
    try { localStorage.removeItem(LS_SESSION); } catch { }
    api.account = null; master = null;
  }

  // Khóa trên máy không còn mở được (bị xóa tài khoản / đổi mật khẩu) thì báo đăng nhập lại
  async function relock() {
    try { await unlockWith(api.account.id, api.account.kek); }
    catch (e) { if (e.code === 'badkey' || e.code === 'nouser') throw fail('Tài khoản đã bị thu hồi', { code: 'revoked' }); throw e; }
  }

  async function latestFile() {
    if (!master) await relock();
    const meta = await fetchJson('ton-kho.json');
    return { id: meta.modified, name: meta.name, lastModifiedDateTime: meta.modified, box: meta };
  }

  async function download(f) {
    try { return (await openBox(f.box, master)).buffer; }
    catch (e) {
      if (e.code !== 'badkey') throw e;
      await relock(); // khóa chính đã đổi trên laptop
      return (await openBox(f.box, master)).buffer;
    }
  }

  return api;
})();
