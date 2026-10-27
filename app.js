'use strict';

/* ================= Cấu hình ================= */

// 5 nhãn trọng tâm, theo thứ tự hiển thị
const KEY_BRANDS = ['Hakubaku Mì baby', 'Manna', 'Kẹo Popin', 'Nepia', 'Chuchu baby'];
// Bản tài khoản riêng và bản Microsoft 365 (m365/) chung một trang web nên tách khóa lưu trên máy
const BASE = window.LM_CONFIG?.base || '';
const LS_PREFIX = window.LM_CONFIG?.storagePrefix || '';
const LS_DATA = LS_PREFIX + 'lm_data_v1';
const LS_SET = LS_PREFIX + 'lm_settings_v1';
const DEFAULT_SETTINGS = {
  threshold: 100,   // từ ngưỡng này trở lên ghi "Còn hàng"
  pct: 50,          // lô còn dưới % hạn dùng này thì đưa sang Hàng clear
  alwaysShow: [],   // mã luôn hiện cho khách dù lô dưới ngưỡng %
  hidden: [],       // mã ngưng bán, không hiện
  known: {},        // mã từng xuất hiện: { ma: { ten, brand, dvt } }
  sets: {},         // nhóm mã đã lưu: { tên nhóm: [ma] }
  selected: []
};
const DAY = 864e5;

/* ================= Trạng thái ================= */

let data = load(LS_DATA, null);   // { lots, fileName, updatedAt, uploadedAt }
let settings = Object.assign({}, DEFAULT_SETTINGS, load(LS_SET, {}));
const ui = { tab: 'stock', brand: 'key', q: '', clearBrand: 'all', clearQ: '', setQ: '', activeSet: '' };
let selected = new Set(settings.selected);

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Không lưu được dữ liệu trên máy này'); }
}
function saveSettings() { settings.selected = [...selected]; save(LS_SET, settings); }

/* ================= Tiện ích ================= */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFC').toLowerCase().trim();
const fold = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const fmtNum = n => Math.round(n).toLocaleString('vi-VN');
const pad = n => String(n).padStart(2, '0');
function fmtDate(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function fmtDateTime(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ================= Đọc file CRM ================= */

const COLS = {
  ma: ['mã hàng'], ten: ['tên hàng'], loai: ['loại hàng', 'nhãn hàng', 'nhóm hàng'], dvt: ['đơn vị'],
  lo: ['số lô'], hsd: ['hạn sử dụng', 'hsd'], ton: ['số lượng tồn', 'sl tồn'],
  dat: ['đã đặt'], value: ['giá trị tồn']
};
const REQUIRED = { ma: 'Mã hàng hóa', ten: 'Tên hàng hóa', loai: 'Loại hàng hóa', hsd: 'Hạn sử dụng', ton: 'Số lượng tồn' };

function excelDate(v) {
  if (v === '' || v == null) return null;
  if (v instanceof Date) return toISO(v);
  if (typeof v === 'number') {
    const u = new Date(Math.round((v - 25569) * DAY));
    return toISO(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return toISO(new Date(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toISO(new Date(+m[1], +m[2] - 1, +m[3]));
  return null;
}

// Thời hạn của lô lấy từ số lô: "260723-18" = 18 tháng, "250324+5Y" = 5 năm, "251003+18M" = 18 tháng.
// Lấy cụm cuối cùng vì có lô ghi thêm chú thích, VD "250121+2Y (đứt đai)"
function shelfMonths(lot) {
  const all = [...String(lot || '').matchAll(/[+-]\s*(\d{1,3})\s*([MmYy])?(?![\d\/])/g)];
  const m = all[all.length - 1];
  if (!m) return null;
  const n = +m[1];
  if (!n) return null;
  return /y/i.test(m[2] || '') ? n * 12 : n;
}

function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Giờ xuất file lấy từ tên file CRM, VD: CRM_Stockbatch_27.10.2026_11.01.06_810.xlsx
function timeFromName(name, fallback) {
  const m = name.match(/(\d{2})\.(\d{2})\.(\d{4})_(\d{2})\.(\d{2})\.(\d{2})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime() : fallback;
}

function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const hi = rows.slice(0, 15).findIndex(r => r.some(c => norm(c).includes('mã hàng')));
  if (hi < 0) throw new Error('Không tìm thấy dòng tiêu đề (cột "Mã hàng hóa") trong file.');
  const head = rows[hi].map(norm);
  const idx = {};
  for (const [k, keys] of Object.entries(COLS)) idx[k] = head.findIndex(h => keys.some(x => h.includes(x)));
  const missing = Object.keys(REQUIRED).filter(k => idx[k] < 0).map(k => REQUIRED[k]);
  if (missing.length) throw new Error('File thiếu cột: ' + missing.join(', '));

  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] : '');
  const lots = [];
  for (const r of rows.slice(hi + 1)) {
    const ma = String(get(r, 'ma')).trim();
    if (!ma) continue;
    const lo = String(get(r, 'lo')).trim();
    lots.push({
      ma,
      ten: String(get(r, 'ten')).trim(),
      loai: String(get(r, 'loai')).trim(),
      dvt: String(get(r, 'dvt')).trim(),
      lo,
      hsd: excelDate(get(r, 'hsd')),
      months: shelfMonths(lo),
      ton: num(get(r, 'ton')),
      dat: num(get(r, 'dat')),
      value: num(get(r, 'value'))
    });
  }
  if (!lots.length) throw new Error('File không có dòng dữ liệu nào.');
  return lots;
}

async function handleFile(file) {
  if (!file) return;
  try {
    const lots = parseWorkbook(await file.arrayBuffer());
    applyData(lots, file.name, timeFromName(file.name, file.lastModified || Date.now()));
  } catch (err) {
    console.error(err);
    alert('Không đọc được file CRM.\n\n' + err.message);
  }
}

function applyData(lots, fileName, updatedAt, meta = { source: 'upload' }) {
  data = { lots, fileName, updatedAt, uploadedAt: Date.now(), ...meta };
  for (const l of lots) settings.known[l.ma] = { ten: l.ten, brand: brandOf(l.loai), dvt: l.dvt };
  save(LS_DATA, data);
  saveSettings();
  const c = compute();
  toast(`Đã cập nhật ${lots.length} dòng, ${new Set(lots.map(l => l.ma)).size} mã. ${c.clearLots.length} lô dưới ${settings.pct}% hạn dùng chuyển sang Hàng clear.`, 5000);
  render();
}

/* ================= Đồng bộ dữ liệu chung ================= */

const sync = { state: 'off', error: '', lastCheck: 0, running: false };

async function syncRemote(manual = false) {
  if (!Nguon.account || sync.running) return;
  sync.running = true; sync.state = 'syncing'; sync.error = ''; renderHeader();
  try {
    const f = await Nguon.latestFile();
    const same = data?.source === 'web' && data.fileId === f.id && data.fileModified === f.lastModifiedDateTime;
    if (!same) {
      const lots = parseWorkbook(await Nguon.download(f));
      applyData(lots, f.name, timeFromName(f.name, Date.parse(f.lastModifiedDateTime)),
        { source: 'web', fileId: f.id, fileModified: f.lastModifiedDateTime });
    } else if (manual) {
      toast('Đang dùng dữ liệu mới nhất');
    }
    sync.state = 'ok';
  } catch (err) {
    console.error(err);
    sync.state = 'error';
    if (err.code === 'revoked') {
      Nguon.logout();
      sync.error = 'Tài khoản đã bị xóa hoặc đổi mật khẩu. Hãy đăng nhập lại.';
    } else {
      sync.error = Nguon.describeError?.(err) || (err.status === 404 ? 'Chưa có dữ liệu tồn kho trên web. Kiểm tra laptop đồng bộ đã bật chưa.'
        : !navigator.onLine || err instanceof TypeError ? 'Mất kết nối mạng, đang dùng dữ liệu đã lưu trên máy.'
        : 'Không lấy được dữ liệu (' + err.message + '). Đang dùng dữ liệu đã lưu.');
    }
  } finally {
    sync.running = false; sync.lastCheck = Date.now(); render();
  }
}

async function startRemote() {
  sync.state = 'need-login';
  try {
    if (await Nguon.init()) await syncRemote();
  } catch (err) {
    console.error(err);
    sync.state = 'error';
    sync.error = Nguon.describeError?.(err) || 'Không đăng nhập được: ' + (err.errorMessage || err.message);
  }
  render();
  setInterval(() => { if (document.visibilityState === 'visible') syncRemote(); }, Nguon.autoSyncMinutes * 60e3);
  // Mở lại app (từ nền) thì kiểm tra dữ liệu mới nếu đã quá 1 phút
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - sync.lastCheck > 60e3) syncRemote();
  });
}

function openLogin() {
  $('#loginError').textContent = '';
  $('#loginModal').hidden = false;
  setTimeout(() => $('#loginUser').focus(), 50);
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginForm button[type=submit]');
  btn.disabled = true; $('#loginError').textContent = '';
  try {
    await Nguon.login($('#loginUser').value, $('#loginPass').value);
    $('#loginPass').value = '';
    $('#loginModal').hidden = true;
    await syncRemote(true);
  } catch (err) {
    $('#loginError').textContent = err.code === 'badlogin' ? 'Sai tên đăng nhập hoặc mật khẩu.'
      : err.status === 404 ? 'Chưa có tài khoản nào được tạo trên laptop.'
      : 'Không đăng nhập được: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});

/* ================= Tính tồn ================= */

function brandOf(loai) {
  const s = norm(loai);
  if (s.includes('hakubaku') && /m[ỳì]/.test(s)) return 'Hakubaku Mì baby';
  if (s.includes('manna')) return 'Manna';
  if (s.includes('popin')) return 'Kẹo Popin';
  if (s.includes('nepia')) return 'Nepia';
  if (s.includes('chuchu')) return 'Chuchu baby';
  return String(loai || 'Khác').replace(/^(nhãn hàng|nhóm hàng)\s+/i, '').replace(/\(có hsd\)/i, '').replace(/\s+/g, ' ').trim() || 'Khác';
}
const isKey = b => KEY_BRANDS.includes(b);

function compute() {
  const t = today();
  const always = new Set(settings.alwaysShow);
  const prods = new Map();
  const clearLots = [];
  const blank = (ma, info) => ({ ma, ten: info.ten, brand: info.brand, dvt: info.dvt, qty: 0, hsd: null, clearLots: 0, clearQty: 0, inFile: false });

  for (const [ma, info] of Object.entries(settings.known)) prods.set(ma, blank(ma, info));
  for (const l of data?.lots || []) {
    const brand = brandOf(l.loai);
    let p = prods.get(l.ma);
    if (!p) { p = blank(l.ma, { ten: l.ten, brand, dvt: l.dvt }); prods.set(l.ma, p); }
    Object.assign(p, { ten: l.ten, brand, dvt: l.dvt, inFile: true });

    let ratio = null, expired = false;
    if (l.hsd) {
      const h = parseISO(l.hsd);
      expired = h <= t;
      if (expired) ratio = 0;
      else if (l.months) ratio = (h - t) / (l.months * 30.4375 * DAY);
    }
    // Hết hạn luôn là hàng clear; còn lại theo ngưỡng %, trừ mã được bật "Luôn hiện"
    const isClear = expired || (ratio !== null && ratio * 100 < settings.pct && !always.has(l.ma));
    if (isClear) {
      p.clearLots++; p.clearQty += l.ton;
      clearLots.push({ ...l, brand, ratio, expired });
    } else {
      p.qty += l.ton;
      if (l.hsd && (!p.hsd || l.hsd < p.hsd)) p.hsd = l.hsd;
    }
  }
  const brandRank = b => (isKey(b) ? KEY_BRANDS.indexOf(b) : 100);
  const products = [...prods.values()].sort((a, b) =>
    brandRank(a.brand) - brandRank(b.brand) || a.brand.localeCompare(b.brand, 'vi') || a.ma.localeCompare(b.ma));
  clearLots.sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0));
  return { products, clearLots };
}

function stockStatus(p) {
  if (p.qty <= 0) return { text: 'Hết hàng', kind: 'out' };
  if (p.qty >= settings.threshold) return { text: 'Còn hàng', kind: 'ok' };
  return { text: `${fmtNum(p.qty)} ${norm(p.dvt)}`.trim(), kind: 'low' };
}

function matchBrand(brand, filter) {
  if (filter === 'all') return true;
  if (filter === 'key') return isKey(brand);
  if (filter === 'other') return !isKey(brand);
  return brand === filter;
}
function matchQuery(p, q) {
  if (!q) return true;
  const hay = fold(p.ten + ' ' + p.ma + ' ' + p.brand);
  return fold(q).split(/\s+/).every(w => hay.includes(w));
}

/* ================= Giao diện ================= */

function render() {
  const c = compute();
  const hidden = new Set(settings.hidden);
  // bỏ mã đã chọn nhưng nay bị ẩn
  for (const ma of selected) if (hidden.has(ma)) selected.delete(ma);

  renderHeader();
  const stale = data && data.updatedAt < today().getTime();
  const banner = $('#banner');
  banner.classList.toggle('error', sync.state === 'error');
  if (sync.state === 'error') banner.textContent = sync.error;
  else if (stale) banner.textContent = data.source === 'web'
    ? `Dữ liệu mới nhất là của ngày ${fmtDate(toISO(new Date(data.updatedAt)))}. Kiểm tra file CRM hôm nay đã bỏ vào OneDrive${Nguon.redirectLogin ? '' : ' và laptop đồng bộ đang bật'}.`
    : `Dữ liệu đang là của ngày ${fmtDate(toISO(new Date(data.updatedAt)))}. Hãy tải file CRM mới nhất trước khi gửi khách.`;
  banner.hidden = !(sync.state === 'error' || stale);

  $('#clearCount').textContent = c.clearLots.length || '';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));

  const main = $('#main');
  // Dữ liệu chung chỉ hiện khi đã đăng nhập; file tự tải lên thì vẫn xem được
  const needLogin = !Nguon.account && data?.source !== 'upload';
  if ((!data || needLogin) && ui.tab !== 'settings') {
    main.innerHTML = `<div class="empty">
      <img src="${BASE}icons/logo-wide.png" alt="Lê Mây Co., Ltd">
      ${sync.state === 'syncing' ? '<h2>Đang lấy dữ liệu mới nhất...</h2>'
        : needLogin ? `<h2>Đăng nhập để xem tồn kho</h2>
          <p>Dùng tên đăng nhập và mật khẩu được cấp cho bạn.</p>
          <button class="btn btn-primary" data-action="login">Đăng nhập</button>
          <p class="hint">hoặc <label for="fileInput" style="color:var(--pink);cursor:pointer;text-decoration:underline">chọn file CRM thủ công</label></p>`
        : `<h2>Chưa có dữ liệu tồn kho</h2>
          <p>Bấm <b>Tải file CRM</b> và chọn file Excel xuất từ CRM<br>(thư mục "Dữ liệu tồn kho trên CRM").</p>
          <label for="fileInput" class="btn btn-primary">Chọn file CRM</label>`}
    </div>`;
    $('#actionbar').hidden = true;
    return;
  }
  if (ui.tab === 'stock') renderStock(main, c, hidden);
  else if (ui.tab === 'clear') renderClear(main, c);
  else renderSettings(main, c, hidden);
}

function renderHeader() {
  const visible = data && (Nguon.account || data.source === 'upload');
  const src = data?.source === 'web' ? Nguon.account?.username || 'Dữ liệu chung' : 'File tải lên';
  $('#dataInfo').textContent = sync.state === 'syncing' ? 'Đang kiểm tra dữ liệu mới...'
    : visible ? `${src} · dữ liệu CRM lúc ${fmtDateTime(data.updatedAt)}`
    : 'Chưa đăng nhập';
  $('#headerActions').innerHTML = !Nguon.account
    ? '<button class="btn btn-primary" data-action="login">Đăng nhập</button>'
    : `<button class="btn btn-primary" data-action="sync" ${sync.state === 'syncing' ? 'disabled' : ''}>
        <span class="${sync.state === 'syncing' ? 'spin' : ''}">⟳</span> Đồng bộ</button>`;
}

function brandChips(products, current, attr, withAll = false) {
  const others = [...new Set(products.filter(p => !isKey(p.brand)).map(p => p.brand))];
  const chips = [...(withAll ? [['all', 'Tất cả']] : []), ['key', 'Nhãn chính'], ...KEY_BRANDS.map(b => [b, b])];
  if (others.length) chips.push(['other', 'Nhãn khác']);
  return `<div class="chips">${chips.map(([v, label]) =>
    `<button class="chip ${current === v ? 'active' : ''}" data-${attr}="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}

function renderStock(main, c, hidden) {
  const visible = c.products.filter(p => !hidden.has(p.ma));
  // Có từ khóa thì tìm trên tất cả nhãn, để tra nhanh khi khách hỏi
  const list = visible.filter(p => (ui.q ? true : matchBrand(p.brand, ui.brand)) && matchQuery(p, ui.q));
  const setNames = Object.keys(settings.sets);

  let html = `
    <input class="search" type="search" placeholder="Tìm tên hoặc mã hàng..." value="${esc(ui.q)}" data-input="q">
    ${brandChips(visible, ui.brand, 'brand')}
    <div class="toolbar">
      <button class="btn btn-sm" data-action="select-all">Chọn tất cả (${list.length})</button>
      <button class="btn btn-sm" data-action="select-none">Bỏ chọn</button>
      <span class="spacer"></span>
      <select data-input="set" aria-label="Nhóm mã đã lưu">
        <option value="">Nhóm đã lưu...</option>
        ${setNames.map(n => `<option value="${esc(n)}" ${n === ui.activeSet ? 'selected' : ''}>${esc(n)} (${settings.sets[n].length})</option>`).join('')}
      </select>
      <button class="btn btn-sm" data-action="save-set">Lưu nhóm</button>
      ${ui.activeSet ? '<button class="btn btn-sm" data-action="delete-set">Xóa nhóm</button>' : ''}
    </div>`;

  if (!list.length) html += `<div class="empty">Không có sản phẩm phù hợp.</div>`;
  let lastBrand = null;
  html += '<div class="list">';
  for (const p of list) {
    if (p.brand !== lastBrand && (ui.brand === 'key' || ui.brand === 'other' || ui.q)) {
      html += `</div><div class="group-title">${esc(p.brand)}</div><div class="list">`;
    }
    lastBrand = p.brand;
    const st = stockStatus(p);
    const sel = selected.has(p.ma);
    const note = p.clearLots ? `<div class="item-note">${p.clearLots} lô dưới ${settings.pct}% hạn dùng (${fmtNum(p.clearQty)} ${esc(norm(p.dvt))}) đã chuyển sang Hàng clear</div>` : '';
    html += `<label class="item ${sel ? 'selected' : ''}">
      <input type="checkbox" data-select="${esc(p.ma)}" ${sel ? 'checked' : ''}>
      <div class="item-body">
        <div class="item-name">${esc(p.ten)}</div>
        <div class="item-meta">${esc(p.ma)} · HSD gần nhất: ${fmtDate(p.hsd)}${p.qty > 0 ? ` · Tồn: ${fmtNum(p.qty)} ${esc(norm(p.dvt))}` : ''}</div>
        ${note}
      </div>
      <span class="badge ${st.kind}">${esc(st.text)}</span>
    </label>`;
  }
  html += '</div>';
  main.innerHTML = html;
  updateActionbar();
}

function updateActionbar() {
  const bar = $('#actionbar');
  bar.hidden = ui.tab !== 'stock' || !data;
  $('#selInfo').textContent = `Đã chọn ${selected.size} mã`;
  bar.querySelector('button').disabled = selected.size === 0;
}

function renderClear(main, c) {
  const lots = c.clearLots.filter(l => matchBrand(l.brand, ui.clearBrand) && matchQuery(l, ui.clearQ));
  const totalQty = lots.reduce((s, l) => s + l.ton, 0);
  const totalVal = lots.reduce((s, l) => s + l.value, 0);
  let html = `
    <input class="search" type="search" placeholder="Tìm trong hàng clear..." value="${esc(ui.clearQ)}" data-input="clearQ">
    ${brandChips(c.clearLots, ui.clearBrand, 'clear-brand', true)}
    <div class="stats">
      <div class="stat"><b>${lots.length}</b><span>lô cần clear</span></div>
      <div class="stat"><b>${fmtNum(totalQty)}</b><span>tổng số lượng</span></div>
      <div class="stat"><b>${fmtNum(totalVal / 1e6)} tr</b><span>giá trị tồn (đ)</span></div>
    </div>
    <p class="hint">Lô còn dưới ${settings.pct}% hạn dùng hoặc đã hết hạn. Không hiện trên ảnh gửi khách. Sắp xếp theo hạn còn lại ít nhất.</p>
    <div class="list">`;
  if (!lots.length) html += `<div class="empty">Không có lô nào cần clear.</div>`;
  for (const l of lots) {
    const pct = l.expired ? 'Đã hết hạn' : `Còn ${Math.round(l.ratio * 100)}%`;
    const kind = l.expired || l.ratio < 0.2 ? 'out' : 'low';
    html += `<div class="item lot">
      <div class="item-body">
        <div class="item-name">${esc(l.ten)}</div>
        <div class="item-meta">${esc(l.ma)} · ${esc(l.brand)}</div>
        <div class="lot-grid">
          <span>Số lô: <b>${esc(l.lo || '—')}</b></span>
          <span>HSD: <b>${fmtDate(l.hsd)}</b></span>
          <span>Tồn: <b>${fmtNum(l.ton)} ${esc(norm(l.dvt))}</b></span>
          <span>Giá trị: <b>${fmtNum(l.value)} đ</b></span>
        </div>
      </div>
      <span class="badge ${kind}">${pct}</span>
    </div>`;
  }
  main.innerHTML = html + '</div>';
  updateActionbar();
}

function renderSettings(main, c, hidden) {
  const always = new Set(settings.alwaysShow);
  const list = c.products.filter(p => (ui.setQ ? true : isKey(p.brand)) && matchQuery(p, ui.setQ));
  let html = `
    <div class="panel">
      <h3>Quy tắc hiển thị</h3>
      <div class="row-set">
        <label class="field"><span>Từ bao nhiêu thì ghi "Còn hàng"</span>
          <input type="number" min="1" value="${settings.threshold}" data-setting="threshold"></label>
        <label class="field"><span>Lô dưới bao nhiêu % hạn dùng thì đưa sang Hàng clear</span>
          <input type="number" min="1" max="100" value="${settings.pct}" data-setting="pct"></label>
      </div>
    </div>
    <div class="panel">
      <h3>Từng mã hàng</h3>
      <input class="search" type="search" placeholder="Tìm mã khác ngoài 5 nhãn chính..." value="${esc(ui.setQ)}" data-input="setQ">
      <p class="hint"><b>Luôn hiện</b>: không áp quy tắc ${settings.pct}% cho mã này (lô hết hạn vẫn bị loại). <b>Ngưng bán</b>: ẩn mã khỏi danh sách và ảnh.</p>
      <div>`;
  for (const p of list) {
    html += `<div class="set-item">
      <div class="item-body"><div class="item-name">${esc(p.ten)}</div><div class="item-meta">${esc(p.ma)} · ${esc(p.brand)}${p.inFile ? '' : ' · không có trong file mới nhất'}</div></div>
      <label class="toggle"><input type="checkbox" data-always="${esc(p.ma)}" ${always.has(p.ma) ? 'checked' : ''}>Luôn hiện</label>
      <label class="toggle"><input type="checkbox" data-hide="${esc(p.ma)}" ${hidden.has(p.ma) ? 'checked' : ''}>Ngưng bán</label>
    </div>`;
  }
  html += `</div></div>
    <div class="panel">
      <h3>Nguồn dữ liệu</h3>
      <p class="hint">${Nguon.account
        ? `Đã đăng nhập <b>${esc(Nguon.account.username)}</b>. App tự kiểm tra dữ liệu mới khi mở và mỗi ${Nguon.autoSyncMinutes} phút.`
        : 'Chưa đăng nhập.'}</p>
      <p class="hint">${data && (Nguon.account || data.source === 'upload') ? `File đang dùng: <b>${esc(data.fileName)}</b> (${data.source === 'web' ? 'dữ liệu chung' : 'tải lên thủ công'}) · lấy về lúc ${fmtDateTime(data.uploadedAt)}` : 'Chưa có dữ liệu.'}</p>
      <div class="toolbar">
        ${Nguon.account ? '<button class="btn btn-sm" data-action="sync">Đồng bộ ngay</button><button class="btn btn-sm" data-action="logout">Đăng xuất</button>'
          : '<button class="btn btn-sm btn-primary" data-action="login">Đăng nhập</button>'}
        <label for="fileInput" class="btn btn-sm">Tải file thủ công</label>
      </div>
      <p class="hint">Cài đặt (Luôn hiện, Ngưng bán, nhóm đã lưu) lưu riêng trên từng điện thoại/máy tính.</p>
      <div class="toolbar"><button class="btn btn-sm" data-action="reset">Xóa toàn bộ dữ liệu trên máy này</button></div>
    </div>`;
  main.innerHTML = html;
  updateActionbar();
}

/* ================= Sự kiện ================= */

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-brand],[data-clear-brand],[data-action]');
  if (!t) return;
  if (t.dataset.tab) { ui.tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.brand) { ui.brand = t.dataset.brand; ui.q = ''; render(); return; }
  if (t.dataset.clearBrand) { ui.clearBrand = t.dataset.clearBrand; render(); return; }
  const a = t.dataset.action;
  if (a === 'select-all' || a === 'select-none') {
    document.querySelectorAll('[data-select]').forEach(cb => a === 'select-all' ? selected.add(cb.dataset.select) : selected.delete(cb.dataset.select));
    saveSettings(); render();
  } else if (a === 'save-set') {
    if (!selected.size) return toast('Hãy chọn mã trước khi lưu nhóm');
    const name = prompt('Đặt tên nhóm (VD: tên khách hoặc loại khách):', ui.activeSet || '');
    if (!name || !name.trim()) return;
    settings.sets[name.trim()] = [...selected];
    ui.activeSet = name.trim(); saveSettings(); render(); toast(`Đã lưu nhóm "${name.trim()}" (${selected.size} mã)`);
  } else if (a === 'delete-set') {
    if (!confirm(`Xóa nhóm "${ui.activeSet}"?`)) return;
    delete settings.sets[ui.activeSet]; ui.activeSet = ''; saveSettings(); render();
  } else if (a === 'login') {
    if (Nguon.redirectLogin) Nguon.login().catch(err => toast('Không mở được trang đăng nhập: ' + err.message));
    else openLogin();
  } else if (a === 'logout') {
    if (!confirm('Đăng xuất khỏi máy này? Dữ liệu tồn kho đã tải về cũng sẽ bị xóa khỏi máy.')) return;
    Nguon.logout();
    if (data?.source === 'web') { data = null; localStorage.removeItem(LS_DATA); }
    sync.state = 'need-login'; render();
  } else if (a === 'close-login') {
    $('#loginModal').hidden = true;
  } else if (a === 'sync') {
    syncRemote(true);
  } else if (a === 'make-image') {
    openImages();
  } else if (a === 'close-modal') {
    $('#modal').hidden = true;
  } else if (a === 'reset') {
    if (!confirm('Xóa dữ liệu tồn kho, nhóm đã lưu và cài đặt trên máy này?')) return;
    localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_SET); Nguon.logout();
    data = null; settings = Object.assign({}, DEFAULT_SETTINGS, { known: {}, sets: {} }); selected = new Set(); ui.tab = 'stock';
    render();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileInput') { handleFile(t.files[0]); t.value = ''; return; }
  if (t.dataset.select) {
    t.checked ? selected.add(t.dataset.select) : selected.delete(t.dataset.select);
    t.closest('.item').classList.toggle('selected', t.checked);
    saveSettings(); updateActionbar(); return;
  }
  if (t.dataset.input === 'set') {
    ui.activeSet = t.value;
    if (t.value) { selected = new Set(settings.sets[t.value]); saveSettings(); toast(`Đã chọn nhóm "${t.value}"`); }
    render(); return;
  }
  if (t.dataset.always || t.dataset.hide) {
    const key = t.dataset.always ? 'alwaysShow' : 'hidden';
    const ma = t.dataset.always || t.dataset.hide;
    const s = new Set(settings[key]); t.checked ? s.add(ma) : s.delete(ma);
    settings[key] = [...s]; saveSettings(); $('#clearCount').textContent = compute().clearLots.length || ''; return;
  }
  if (t.dataset.setting) {
    const v = parseInt(t.value, 10);
    if (v > 0) { settings[t.dataset.setting] = t.dataset.setting === 'pct' ? Math.min(v, 100) : v; saveSettings(); render(); }
  }
});

let inputTimer;
document.addEventListener('input', e => {
  const k = e.target.dataset.input;
  if (!k || k === 'set') return;
  ui[k] = e.target.value;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    const pos = e.target.selectionStart;
    render();
    const el = document.querySelector(`[data-input="${k}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } }
  }, 200);
});

// Kéo thả file trên laptop
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('#dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#dropzone').hidden = true;
  handleFile(e.dataTransfer.files[0]);
});

/* ================= Ảnh gửi khách ================= */

const IMG = {
  W: 1080, PAD: 40, MAXH: 1700, FONT: '"Segoe UI", Roboto, Arial, sans-serif',
  cols: [{ k: 'stt', w: 70, t: 'STT' }, { k: 'ten', w: 560, t: 'Tên sản phẩm' }, { k: 'hsd', w: 190, t: 'HSD' }, { k: 'ton', w: 180, t: 'Tồn kho' }],
  bandH: 54, colH: 46, lineH: 33, rowPad: 18, headFirst: 250, headNext: 120, foot: 70,
  pink: '#c2457f', pinkSoft: '#fbe9f1', text: '#2b2230', muted: '#7a6f7f', line: '#ecdfe6', zebra: '#fcf7f9',
  ok: '#1e8e4e', low: '#b26a00', out: '#c62828'
};
let imageUrls = [];
let imageTimer;

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function imageGroups() {
  const hidden = new Set(settings.hidden);
  const groups = [];
  for (const p of compute().products) {
    if (!selected.has(p.ma) || hidden.has(p.ma)) continue;
    let g = groups[groups.length - 1];
    if (!g || g.brand !== p.brand) { g = { brand: p.brand, rows: [] }; groups.push(g); }
    const st = stockStatus(p);
    g.rows.push({ ten: p.ten, hsd: p.qty > 0 ? fmtDate(p.hsd) : '—', ton: st.text, kind: st.kind });
  }
  return groups;
}

function layoutPages(groups) {
  const m = document.createElement('canvas').getContext('2d');
  m.font = `26px ${IMG.FONT}`;
  const nameW = IMG.cols[1].w - 28;
  const pages = [];
  let page = { items: [] }, y = IMG.headFirst;
  const limit = () => IMG.MAXH - IMG.foot;
  for (const g of groups) {
    let started = false;
    g.rows.forEach((r, i) => {
      const lines = wrapText(m, r.ten, nameW);
      const h = lines.length * IMG.lineH + IMG.rowPad;
      const need = (started ? 0 : IMG.bandH + IMG.colH) + h;
      if (y + need > limit() && page.items.length) {
        pages.push({ ...page, h: y + IMG.foot });
        page = { items: [] }; y = IMG.headNext; started = false;
      }
      if (!started) {
        page.items.push({ type: 'band', y, text: g.brand + (i > 0 ? ' (tiếp)' : '') }); y += IMG.bandH;
        page.items.push({ type: 'cols', y }); y += IMG.colH;
        started = true;
      }
      page.items.push({ type: 'row', y, h, no: i + 1, lines, r }); y += h;
    });
    y += 18;
  }
  pages.push({ ...page, h: y + IMG.foot });
  return pages;
}

async function drawPage(page, idx, total, opts) {
  const { W, PAD } = IMG;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Math.max(page.h, idx === 0 ? 420 : 300);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.textBaseline = 'middle';
  const right = W - PAD;

  // Đầu trang
  if (idx === 0) {
    const logo = await loadImage(window.LOGO_WIDE || BASE + 'icons/logo-wide.png');
    const lh = 190, lw = lh * logo.width / logo.height;
    ctx.drawImage(logo, PAD - 6, 26, lw, lh);
    ctx.textAlign = 'right';
    ctx.fillStyle = IMG.pink; ctx.font = `bold 48px ${IMG.FONT}`;
    ctx.fillText('BẢNG TỒN KHO', right, 72);
    ctx.fillStyle = IMG.muted; ctx.font = `26px ${IMG.FONT}`;
    ctx.fillText(`Cập nhật: ${opts.time}`, right, 122);
    if (opts.customer) {
      ctx.fillStyle = IMG.text; ctx.font = `bold 28px ${IMG.FONT}`;
      const kg = wrapText(ctx, 'Kính gửi: ' + opts.customer, W - PAD - lw - 60);
      kg.slice(0, 2).forEach((t, i) => ctx.fillText(t, right, 172 + i * 36));
    }
    ctx.fillStyle = IMG.pink; ctx.fillRect(PAD, 228, W - 2 * PAD, 3);
  } else {
    const lotus = await loadImage(window.LOGO_LOTUS || BASE + 'icons/lotus.png');
    ctx.drawImage(lotus, PAD, 22, 105, 70);
    ctx.textAlign = 'left'; ctx.fillStyle = IMG.pink; ctx.font = `bold 34px ${IMG.FONT}`;
    ctx.fillText('BẢNG TỒN KHO', PAD + 120, 46);
    ctx.fillStyle = IMG.muted; ctx.font = `22px ${IMG.FONT}`;
    ctx.fillText(`Cập nhật: ${opts.time}${opts.customer ? ' · ' + opts.customer : ''}`, PAD + 120, 82);
    ctx.textAlign = 'right'; ctx.fillText(`Trang ${idx + 1}/${total}`, right, 46);
    ctx.fillStyle = IMG.pink; ctx.fillRect(PAD, 104, W - 2 * PAD, 3);
  }

  // Bảng
  const xs = []; let x = PAD;
  for (const c of IMG.cols) { xs.push(x); x += c.w; }
  const tableW = x - PAD;
  let zebra = false;
  for (const it of page.items) {
    if (it.type === 'band') {
      ctx.fillStyle = IMG.pink; roundRect(ctx, PAD, it.y, tableW, IMG.bandH - 6, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = `bold 28px ${IMG.FONT}`;
      ctx.fillText(it.text.toUpperCase(), PAD + 18, it.y + (IMG.bandH - 6) / 2);
      zebra = false;
    } else if (it.type === 'cols') {
      ctx.fillStyle = IMG.pinkSoft; ctx.fillRect(PAD, it.y, tableW, IMG.colH);
      ctx.fillStyle = IMG.pink; ctx.font = `bold 23px ${IMG.FONT}`;
      IMG.cols.forEach((c, i) => {
        ctx.textAlign = c.k === 'ten' ? 'left' : 'center';
        ctx.fillText(c.t, c.k === 'ten' ? xs[i] + 14 : xs[i] + c.w / 2, it.y + IMG.colH / 2);
      });
    } else {
      if (zebra) { ctx.fillStyle = IMG.zebra; ctx.fillRect(PAD, it.y, tableW, it.h); }
      zebra = !zebra;
      ctx.strokeStyle = IMG.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD, it.y + it.h - .5); ctx.lineTo(PAD + tableW, it.y + it.h - .5); ctx.stroke();
      const mid = it.y + it.h / 2;
      ctx.fillStyle = IMG.muted; ctx.font = `24px ${IMG.FONT}`; ctx.textAlign = 'center';
      ctx.fillText(String(it.no), xs[0] + IMG.cols[0].w / 2, mid);
      ctx.fillStyle = IMG.text; ctx.font = `26px ${IMG.FONT}`; ctx.textAlign = 'left';
      const top = mid - (it.lines.length - 1) * IMG.lineH / 2;
      it.lines.forEach((t, i) => ctx.fillText(t, xs[1] + 14, top + i * IMG.lineH));
      ctx.textAlign = 'center'; ctx.font = `24px ${IMG.FONT}`; ctx.fillStyle = IMG.text;
      ctx.fillText(it.r.hsd, xs[2] + IMG.cols[2].w / 2, mid);
      ctx.font = `bold 25px ${IMG.FONT}`; ctx.fillStyle = IMG[it.r.kind];
      ctx.fillText(it.r.ton, xs[3] + IMG.cols[3].w / 2, mid);
    }
  }

  // Chân trang
  ctx.fillStyle = IMG.muted; ctx.font = `20px ${IMG.FONT}`; ctx.textAlign = 'center';
  ctx.fillText('LE MAY CO., LTD · Make your life blossom', W / 2, cv.height - 32);
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

async function buildImages() {
  const list = $('#imgList');
  const groups = imageGroups();
  if (!groups.length) { list.innerHTML = '<div class="empty">Chưa chọn mã nào.</div>'; return; }
  list.innerHTML = '<div class="empty">Đang tạo ảnh...</div>';
  const pages = layoutPages(groups);
  const opts = { time: fmtDateTime(data.updatedAt), customer: $('#customerName').value.trim() };
  const blobs = [];
  for (let i = 0; i < pages.length; i++) blobs.push(await drawPage(pages[i], i, pages.length, opts));

  imageUrls.forEach(u => URL.revokeObjectURL(u));
  imageUrls = blobs.map(b => URL.createObjectURL(b));
  const d = new Date(data.updatedAt);
  const base = `TonKho_LeMay_${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  const files = blobs.map((b, i) => new File([b], `${base}${pages.length > 1 ? '_' + (i + 1) : ''}.png`, { type: 'image/png' }));
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [files[0]] }));
  const canCopy = !!(window.ClipboardItem && navigator.clipboard?.write);

  list.innerHTML = imageUrls.map((u, i) => `
    <div class="img-card">
      <img src="${u}" alt="Bảng tồn kho trang ${i + 1}">
      <div class="img-actions">
        <small>${pages.length > 1 ? `Trang ${i + 1}/${pages.length}` : ''}</small>
        ${canCopy ? `<button class="btn btn-sm" data-img-copy="${i}">Sao chép</button>` : ''}
        ${canShare ? `<button class="btn btn-sm" data-img-share="${i}">Chia sẻ</button>` : ''}
        <a class="btn btn-sm btn-primary" href="${u}" download="${files[i].name}">Tải ảnh</a>
      </div>
    </div>`).join('') + (pages.length > 1 && canShare ? `<button class="btn btn-primary" data-img-share="all">Chia sẻ tất cả ${pages.length} ảnh</button>` : '');

  list.onclick = async e => {
    const b = e.target.closest('[data-img-copy],[data-img-share]');
    if (!b) return;
    try {
      if (b.dataset.imgCopy) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobs[+b.dataset.imgCopy] })]);
        toast('Đã sao chép ảnh - dán (Ctrl+V) vào Zalo');
      } else {
        const fs = b.dataset.imgShare === 'all' ? files : [files[+b.dataset.imgShare]];
        await navigator.share({ files: fs, title: 'Bảng tồn kho Lê Mây' });
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Không thực hiện được, hãy dùng nút Tải ảnh');
    }
  };
}

function openImages() {
  if (!selected.size) return toast('Hãy chọn ít nhất 1 mã');
  $('#modal').hidden = false;
  buildImages();
}
$('#customerName').addEventListener('input', () => { clearTimeout(imageTimer); imageTimer = setTimeout(buildImages, 500); });
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });

/* ================= Khởi động ================= */

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register(BASE + 'sw.js').catch(() => { });
}
render();
startRemote();
