(() => {
  'use strict';

  // ================= 設定 =================
  const STORE_KEY = 'ledger.v1';
  const THEME_KEY = 'ledger.theme';

  // 分類顏色以固定順序指定（--c1 ~ --c8），顏色跟著分類，不隨排名改變
  const CATEGORIES = {
    expense: [
      { id: 'food', name: '餐飲', emoji: '🍱', color: 'var(--c1)' },
      { id: 'transport', name: '交通', emoji: '🚇', color: 'var(--c2)' },
      { id: 'shopping', name: '購物', emoji: '🛍️', color: 'var(--c3)' },
      { id: 'home', name: '居家', emoji: '🏠', color: 'var(--c4)' },
      { id: 'fun', name: '娛樂', emoji: '🎮', color: 'var(--c5)' },
      { id: 'health', name: '醫療', emoji: '💊', color: 'var(--c6)' },
      { id: 'edu', name: '學習', emoji: '📚', color: 'var(--c7)' },
      { id: 'other', name: '其他', emoji: '📦', color: 'var(--c8)' },
    ],
    income: [
      { id: 'salary', name: '薪資', emoji: '💼', color: 'var(--c1)' },
      { id: 'bonus', name: '獎金', emoji: '🎁', color: 'var(--c2)' },
      { id: 'invest', name: '投資', emoji: '📈', color: 'var(--c3)' },
      { id: 'side', name: '兼職', emoji: '💡', color: 'var(--c4)' },
      { id: 'other', name: '其他', emoji: '💰', color: 'var(--c5)' },
    ],
  };
  const TYPE_NAME = { expense: '支出', income: '收入' };
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  const catOf = (type, id) =>
    CATEGORIES[type].find(c => c.id === id) || CATEGORIES[type][CATEGORIES[type].length - 1];

  // ================= 工具 =================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
  const money = n => (n < 0 ? '-$' : '$') + nf.format(Math.abs(Math.round(n * 100) / 100));
  const compact = n => {
    const a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '億';
    if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '萬';
    return nf.format(Math.round(n));
  };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('--')) node.style.setProperty(k, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    return node;
  }

  function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function safeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }

  // ================= 資料 =================
  // db：使用者自己的帳本（存在瀏覽器，有雲端時同步到個人私有空間）
  // demo：示範資料，只存在記憶體，從不寫入儲存
  let db = load();
  let demo = null;
  const view = () => demo || db;
  const pageLoadedAt = Date.now();

  function load() {
    try {
      const raw = JSON.parse(safeGet(STORE_KEY));
      if (raw && Array.isArray(raw.txs)) {
        return { txs: raw.txs.filter(validTx), budget: raw.budget ?? null, started: !!raw.started || raw.txs.length > 0 };
      }
    } catch { /* 忽略壞資料 */ }
    return { txs: [], budget: null, started: false };
  }
  function saveLocal() {
    safeSet(STORE_KEY, JSON.stringify(db));
  }
  // 存檔：months 是有變動的月份（'2026-10'），settings 表示預算等設定有變
  function save({ months = [], settings = false, all = false } = {}) {
    saveLocal();
    cloud.push(all ? null : months, settings || all);
    sqlite.push(all ? null : months, settings || all);
  }
  const monthKey = date => date.slice(0, 7);
  function validTx(t) {
    return t && (t.type === 'expense' || t.type === 'income') &&
      typeof t.amount === 'number' && isFinite(t.amount) && t.amount > 0 &&
      typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
  }
  const cleanTx = t => ({
    id: String(t.id), type: t.type, amount: t.amount, date: t.date,
    category: String(t.category || 'other'), note: String(t.note || '').slice(0, 60), createdAt: t.createdAt || 0,
  });

  // ================= 雲端同步（claude.ai 個人私有空間） =================
  // 每個月一份文件 data/users/<id>/m2026-10，另有一份 settings。
  // 在一般瀏覽器開啟時沒有 window.claude，就只用 localStorage。
  const cloud = {
    col: null,
    synced: false,
    queue: Promise.resolve(),

    async init() {
      if (!window.claude?.use) return;
      try {
        const [cdb, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (!cdb || !user) return;
        const id = await user.id();
        if (!id) return;
        this.col = cdb.collection('data/users/' + id);
        this.col.onSnapshot(snap => this.apply(snap), () => setSync('off'));
        setSync('syncing');
      } catch { this.col = null; }
    },

    apply(snap) {
      // 第一份「伺服器確認過」的快照之前，不拿快取覆蓋本機資料
      if (!this.synced && snap.metadata.fromCache) return;
      const remoteTxs = [];
      let settings = null;
      for (const d of snap.docs) {
        const body = d.data() || {};
        if (d.id === 'settings') settings = body;
        else if (d.id.startsWith('m') && Array.isArray(body.txs)) remoteTxs.push(...body.txs.filter(validTx));
      }
      if (!this.synced) {
        this.synced = true;
        if (snap.empty) {
          // 雲端還是空的：把這台裝置上的帳本上傳
          if (db.txs.length || db.started || db.budget) this.push(null, true);
          setSync('on');
          return;
        }
        // 雲端已有資料：以雲端為準，但保留這次開啟後、同步完成前新增的紀錄
        const ids = new Set(remoteTxs.map(t => t.id));
        const fresh = db.txs.filter(t => !ids.has(t.id) && t.createdAt >= pageLoadedAt);
        remoteTxs.push(...fresh);
        if (fresh.length) setTimeout(() => this.push([...new Set(fresh.map(t => monthKey(t.date)))], false));
      }
      db = {
        txs: remoteTxs,
        budget: settings ? (settings.budget > 0 ? settings.budget : null) : db.budget,
        started: (settings && !!settings.started) || remoteTxs.length > 0 || db.started,
      };
      saveLocal();
      if (demo?.auto && db.started) demo = null;
      setSync('on');
      render();
    },

    // months === null 代表全部月份（含刪除雲端多出來的月份）
    push(months, settings) {
      if (!this.col || !this.synced) return;
      const col = this.col;
      const snapshot = db.txs.map(cleanTx);
      const byMonth = new Map();
      for (const t of snapshot) {
        const k = monthKey(t.date);
        if (!byMonth.has(k)) byMonth.set(k, []);
        byMonth.get(k).push(t);
      }
      const jobs = [];
      if (months === null) {
        jobs.push(async () => {
          const existing = await col.get();
          for (const d of existing.docs) {
            if (d.id.startsWith('m') && !byMonth.has(d.id.slice(1))) await col.doc(d.id).delete();
          }
          for (const [k, txs] of byMonth) await col.doc('m' + k).set({ txs });
        });
      } else {
        for (const k of new Set(months)) {
          const txs = byMonth.get(k);
          jobs.push(() => (txs ? col.doc('m' + k).set({ txs }) : col.doc('m' + k).delete()));
        }
      }
      if (settings) {
        const body = { budget: db.budget || 0, started: !!db.started };
        jobs.push(() => col.doc('settings').set(body));
      }
      // 一次只寫一份文件，依序執行
      for (const job of jobs) {
        this.queue = this.queue.then(() => withRetry(job)).catch(e => {
          setSync('error');
          toast(e?.code === 'quota_exceeded' ? '⚠️ 雲端空間已滿，紀錄只存在這台裝置' : '⚠️ 雲端同步失敗，紀錄已先存在這台裝置');
        });
      }
    },
  };
  // ================= 本機 SQLite（透過 server.py） =================
  // 用 python3 server.py 開啟時，資料存在 SQLite 檔；localStorage 只當快取。
  const sqlite = {
    on: false,
    queue: Promise.resolve(),

    async init() {
      if (window.claude || !/^https?:$/.test(location.protocol)) return;
      let state;
      try {
        const res = await fetch('api/state', { cache: 'no-store' });
        if (!res.ok || !(res.headers.get('Content-Type') || '').includes('application/json')) return;
        state = await res.json();
      } catch { return; }
      this.on = true;
      $('#backupDbBtn').hidden = false;
      const serverTxs = (state.txs || []).filter(validTx);
      if (!serverTxs.length && !state.started && (db.txs.length || db.budget)) {
        // 資料庫還是空的：把這個瀏覽器裡原本的紀錄搬進 SQLite
        this.push(null, true);
        if (db.txs.length) toast(`已把 ${db.txs.length} 筆紀錄搬到本機 SQLite`);
      } else {
        db = { txs: serverTxs, budget: state.budget > 0 ? state.budget : null, started: !!state.started || serverTxs.length > 0 };
        saveLocal();
        if (demo?.auto && db.started) demo = null;
        render();
      }
      setSync('sqlite');
    },

    push(months, settings) {
      if (!this.on) return;
      const snapshot = db.txs.map(cleanTx);
      const put = (url, body) => async () => {
        const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      };
      const jobs = [];
      if (months === null) {
        jobs.push(put('api/state', { txs: snapshot, budget: db.budget || 0, started: !!db.started }));
      } else {
        for (const k of new Set(months)) jobs.push(put('api/months/' + k, { txs: snapshot.filter(t => monthKey(t.date) === k) }));
        if (settings) jobs.push(put('api/settings', { budget: db.budget || 0, started: !!db.started }));
      }
      for (const job of jobs) {
        this.queue = this.queue.then(job).then(() => setSync('sqlite')).catch(() => {
          setSync('sqliteError');
          toast('⚠️ 無法寫入 SQLite，請確認 server.py 還在執行');
        });
      }
    },
  };

  async function withRetry(job) {
    try { return await job(); } catch (e) {
      if (e?.code !== 'unavailable') throw e;
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      return job();
    }
  }
  function setSync(state) {
    const b = $('#syncBadge');
    if (!b) return;
    const map = {
      syncing: ['⏳', '正在同步…'],
      on: ['☁️', '已同步到你的 Claude 帳號，只有你看得到'],
      error: ['⚠️', '同步失敗，紀錄暫存在這台裝置'],
      off: ['📴', '雲端同步已中斷，紀錄暫存在這台裝置'],
      sqlite: ['🗄️', '已存到本機 SQLite 資料庫'],
      sqliteError: ['⚠️', '無法寫入 SQLite，紀錄暫存在瀏覽器'],
    };
    const [icon, label] = map[state];
    b.hidden = false;
    b.textContent = icon;
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  const txsIn = (from, to) => view().txs.filter(t => t.date >= from && t.date <= to);
  const sum = (list, type) => list.reduce((s, t) => (t.type === type ? s + t.amount : s), 0);

  // ================= 狀態 =================
  const today = new Date();
  const ui = {
    route: 'ledger',
    month: new Date(today.getFullYear(), today.getMonth(), 1),
    formType: 'expense',
    formCat: 'food',
    editingId: null,
    search: '',
    scope: 'month',
    atype: 'expense',
  };

  // ================= 主題 =================
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(safeGet(THEME_KEY));
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    safeSet(THEME_KEY, next);
  });

  // ================= 路由 =================
  function route() {
    ui.route = location.hash.replace(/^#\/?/, '') === 'analysis' ? 'analysis' : 'ledger';
    showRoute();
  }
  function showRoute() {
    $$('.tab').forEach(a => {
      const on = a.dataset.route === ui.route;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on);
    });
    $('#view-ledger').hidden = ui.route !== 'ledger';
    $('#view-analysis').hidden = ui.route !== 'analysis';
    render();
  }
  window.addEventListener('hashchange', route);
  // 內嵌頁面不一定能改網址，所以點分頁時直接切換
  $$('.tab').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    ui.route = a.dataset.route;
    try { history.replaceState(null, '', '#' + ui.route); } catch { /* 忽略 */ }
    showRoute();
    window.scrollTo(0, 0);
  }));

  // ================= 月份切換 =================
  function shiftMonth(delta) {
    const step = ui.route === 'analysis' && ui.scope === 'year' ? 12 : 1;
    ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + delta * step, 1);
    render();
  }
  $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('#nextMonth').addEventListener('click', () => shiftMonth(1));
  $('#monthLabel').addEventListener('click', () => {
    ui.month = new Date(today.getFullYear(), today.getMonth(), 1);
    render();
  });

  function renderMonthLabel() {
    const y = ui.month.getFullYear(), m = ui.month.getMonth() + 1;
    $('#monthLabel').textContent =
      ui.route === 'analysis' && ui.scope === 'year' ? `${y} 年` : `${y} 年 ${m} 月`;
  }

  // ================= 記帳表單 =================
  const form = $('#entryForm');
  const amountInput = $('#amount');
  const dateInput = $('#date');
  const noteInput = $('#note');

  function defaultDate() {
    // 瀏覽本月時預設今天，瀏覽其他月份時預設該月 1 號
    return ym(ui.month) === ym(today) ? ymd(today) : ymd(ui.month);
  }

  function setFormType(type) {
    ui.formType = type;
    if (!CATEGORIES[type].some(c => c.id === ui.formCat)) ui.formCat = CATEGORIES[type][0].id;
    $$('.seg-btn[data-type]').forEach(b => {
      const on = b.dataset.type === type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    renderCatPicker();
  }

  function renderCatPicker() {
    const box = $('#catPicker');
    box.replaceChildren(...CATEGORIES[ui.formType].map(c =>
      el('button', {
        type: 'button', role: 'radio',
        class: 'cat' + (c.id === ui.formCat ? ' active' : ''),
        'aria-checked': c.id === ui.formCat,
        '--cat': c.color,
        onclick: () => { ui.formCat = c.id; renderCatPicker(); },
      }, el('span', { class: 'emoji', text: c.emoji }), el('span', { text: c.name }))
    ));
  }

  $$('.seg-btn[data-type]').forEach(b => b.addEventListener('click', () => setFormType(b.dataset.type)));

  function resetForm() {
    ui.editingId = null;
    amountInput.value = '';
    noteInput.value = '';
    dateInput.value = defaultDate();
    $('#submitBtn').textContent = '新增一筆';
    $('#cancelEdit').hidden = true;
  }

  function startEdit(tx) {
    ui.editingId = tx.id;
    ui.formCat = tx.category;
    setFormType(tx.type);
    amountInput.value = tx.amount;
    dateInput.value = tx.date;
    noteInput.value = tx.note || '';
    $('#submitBtn').textContent = '儲存修改';
    $('#cancelEdit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    amountInput.focus({ preventScroll: true });
  }
  $('#cancelEdit').addEventListener('click', resetForm);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!(amount > 0)) { toast('請輸入大於 0 的金額'); amountInput.focus(); return; }
    if (!dateInput.value) { toast('請選擇日期'); return; }
    const data = {
      type: ui.formType,
      amount: Math.round(amount * 100) / 100,
      category: ui.formCat,
      date: dateInput.value,
      note: noteInput.value.trim(),
    };
    const months = [monthKey(data.date)];
    let settings = false;
    if (demo) {
      // 記下第一筆真的帳：離開示範模式
      demo = null;
      ui.editingId = null;
    }
    if (!db.started) { db.started = true; settings = true; }
    if (ui.editingId) {
      const i = db.txs.findIndex(t => t.id === ui.editingId);
      if (i >= 0) {
        months.push(monthKey(db.txs[i].date));
        db.txs[i] = { ...db.txs[i], ...data };
      }
      toast('✅ 已更新');
    } else {
      db.txs.push({ id: uid(), createdAt: Date.now(), ...data });
      toast(`✅ 已記下 ${catOf(data.type, data.category).name} ${money(data.amount)}`);
    }
    save({ months, settings });
    // 記到別的月份時，跳到那個月份讓使用者看到
    const d = parseYmd(data.date);
    ui.month = new Date(d.getFullYear(), d.getMonth(), 1);
    const keepDate = data.date;
    resetForm();
    dateInput.value = keepDate;
    render();
    amountInput.focus();
  });

  // ================= 記帳頁渲染 =================
  function monthRange(d) {
    const y = d.getFullYear(), m = d.getMonth();
    return [ymd(new Date(y, m, 1)), ymd(new Date(y, m, daysInMonth(y, m)))];
  }

  function renderLedger() {
    const [from, to] = monthRange(ui.month);
    const list = txsIn(from, to);
    const inc = sum(list, 'income'), exp = sum(list, 'expense');
    $('#sumIncome').textContent = money(inc);
    $('#sumExpense').textContent = money(exp);
    $('#sumBalance').textContent = money(inc - exp);

    // 預算
    const box = $('#budgetBox');
    const budget = view().budget;
    if (budget > 0) {
      box.hidden = false;
      const ratio = exp / budget;
      const fill = $('#budgetFill');
      fill.style.width = Math.min(100, ratio * 100) + '%';
      fill.classList.toggle('warn', ratio >= 0.8 && ratio < 1);
      fill.classList.toggle('over', ratio >= 1);
      const left = budget - exp;
      $('#budgetText').textContent = left >= 0
        ? `${money(exp)} / ${money(budget)}・剩 ${money(left)}`
        : `${money(exp)} / ${money(budget)}・超支 ${money(-left)}`;
    } else box.hidden = true;

    if (!ui.editingId && !amountInput.value) dateInput.value = defaultDate();

    // 明細
    const q = ui.search.trim().toLowerCase();
    const filtered = list.filter(t => {
      if (!q) return true;
      const c = catOf(t.type, t.category);
      return (t.note || '').toLowerCase().includes(q) || c.name.includes(q) || TYPE_NAME[t.type].includes(q);
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

    const wrap = $('#txList');
    if (!filtered.length) {
      wrap.replaceChildren(el('div', { class: 'empty' },
        el('span', { class: 'big', text: q ? '🔍' : '📝' }),
        q ? '找不到符合的紀錄' : '這個月還沒有紀錄，記下第一筆吧！',
        !q && !db.txs.length
          ? el('div', {}, el('button', { class: 'btn ghost', type: 'button', text: '看看示範資料', onclick: () => showDemo(false) }))
          : null,
      ));
      return;
    }

    const groups = new Map();
    for (const t of filtered) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    const frag = document.createDocumentFragment();
    for (const [date, items] of groups) {
      const d = parseYmd(date);
      const dExp = sum(items, 'expense'), dInc = sum(items, 'income');
      const label = `${d.getMonth() + 1} 月 ${d.getDate()} 日 週${WEEKDAYS[d.getDay()]}` + (date === ymd(today) ? '・今天' : '');
      const parts = [];
      if (dInc) parts.push(`收 ${money(dInc)}`);
      if (dExp) parts.push(`支 ${money(dExp)}`);
      frag.append(el('div', { class: 'day-group' },
        el('div', { class: 'day-head' }, el('span', { text: label }), el('span', { text: parts.join('　') })),
        el('div', { class: 'day-items' }, items.map(txRow)),
      ));
    }
    wrap.replaceChildren(frag);
  }

  function txRow(t) {
    const c = catOf(t.type, t.category);
    return el('div', { class: 'tx', '--cat': c.color },
      el('div', { class: 'tx-icon', text: c.emoji, 'aria-hidden': 'true' }),
      el('div', { class: 'tx-main' },
        el('div', { class: 'tx-cat', text: c.name }),
        t.note ? el('div', { class: 'tx-note', text: t.note }) : null,
      ),
      el('div', { class: 'tx-amt ' + t.type, text: (t.type === 'income' ? '+' : '-') + money(t.amount) }),
      demo ? null : el('div', { class: 'tx-ops' },
        el('button', { type: 'button', title: '編輯', 'aria-label': '編輯', text: '✎', onclick: () => startEdit(t) }),
        el('button', { type: 'button', class: 'del', title: '刪除', 'aria-label': '刪除', text: '✕', onclick: () => removeTx(t) }),
      ),
    );
  }

  function removeTx(t) {
    const idx = db.txs.findIndex(x => x.id === t.id);
    if (idx < 0) return;
    db.txs.splice(idx, 1);
    if (ui.editingId === t.id) resetForm();
    const months = [monthKey(t.date)];
    save({ months });
    render();
    toast('已刪除一筆', '復原', () => { db.txs.push(t); save({ months }); render(); });
  }

  $('#search').addEventListener('input', e => { ui.search = e.target.value; renderLedger(); });

  // ================= 分析頁 =================
  $$('.seg-btn[data-scope]').forEach(b => b.addEventListener('click', () => { ui.scope = b.dataset.scope; render(); }));
  $$('.seg-btn[data-atype]').forEach(b => b.addEventListener('click', () => { ui.atype = b.dataset.atype; render(); }));

  function periodOf(scope, anchor, offset = 0) {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    if (scope === 'year') {
      const yy = y + offset;
      return { from: `${yy}-01-01`, to: `${yy}-12-31`, start: new Date(yy, 0, 1), end: new Date(yy, 11, 31) };
    }
    const s = new Date(y, m + offset, 1);
    const e = new Date(s.getFullYear(), s.getMonth(), daysInMonth(s.getFullYear(), s.getMonth()));
    return { from: ymd(s), to: ymd(e), start: s, end: e };
  }
  // 計算日均時，只算到今天（未來的日子不算）
  function elapsedDays(p) {
    const end = p.end < today ? p.end : today;
    if (end < p.start) return 0;
    return Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - p.start) / 864e5) + 1;
  }

  function renderAnalysis() {
    $$('.seg-btn[data-scope]').forEach(b => { const on = b.dataset.scope === ui.scope; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    $$('.seg-btn[data-atype]').forEach(b => { const on = b.dataset.atype === ui.atype; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });

    const type = ui.atype, tname = TYPE_NAME[type];
    const p = periodOf(ui.scope, ui.month);
    const prev = periodOf(ui.scope, ui.month, -1);
    const list = txsIn(p.from, p.to);
    const days = elapsedDays(p);
    // 進行中的期間（本月/今年）只跟上一期的「同期」比較，才不會低估
    const ongoing = p.from <= ymd(today) && p.to >= ymd(today);
    let prevTo = prev.to;
    if (ongoing) {
      const lastPrev = ui.scope === 'year'
        ? new Date(prev.start.getFullYear(), today.getMonth(), today.getDate())
        : new Date(prev.start.getFullYear(), prev.start.getMonth(), Math.min(today.getDate(), prev.end.getDate()));
      prevTo = ymd(lastPrev > prev.end ? prev.end : lastPrev);
    }
    const prevList = txsIn(prev.from, prevTo);
    const unit = (ui.scope === 'year' ? '去年' : '上月') + (ongoing ? '同期' : '');

    // ---- KPI ----
    const total = sum(list, type), prevTotal = sum(prevList, type);
    const inc = sum(list, 'income'), exp = sum(list, 'expense');
    const prevBal = sum(prevList, 'income') - sum(prevList, 'expense');
    const count = list.filter(t => t.type === type).length;

    const kpis = [
      { label: `總${tname}`, value: money(total), delta: deltaText(total, prevTotal, unit, type === 'expense') },
      { label: '結餘', value: money(inc - exp), delta: prevList.length ? balanceText(inc - exp, prevBal, unit) : { text: `${unit}無資料` } },
      { label: `日均${tname}`, value: money(days ? Math.round(total / days) : 0), delta: { text: days ? `以 ${days} 天計` : '尚未開始' } },
      { label: '儲蓄率', value: inc ? pct(inc - exp, inc) + '%' : '—', delta: { text: `${tname} ${count} 筆` } },
    ];
    $('#kpis').replaceChildren(...kpis.map(k => el('div', { class: 'kpi' },
      el('div', { class: 'kpi-label', text: k.label }),
      el('div', { class: 'kpi-value', text: k.value, title: k.value }),
      el('div', { class: 'kpi-delta ' + (k.delta.cls || ''), text: k.delta.text }),
    )));

    // ---- 分類 ----
    $('#catTitle').textContent = `${tname}分類`;
    renderCategories(list, prevList, type, total);

    // ---- 趨勢 ----
    const trendCard = $('#trendChart').closest('.card');
    if (ui.scope === 'month') {
      trendCard.hidden = false;
      const y = p.start.getFullYear(), m = p.start.getMonth();
      const n = daysInMonth(y, m);
      const vals = Array(n).fill(0);
      for (const t of list) if (t.type === type) vals[parseYmd(t.date).getDate() - 1] += t.amount;
      const avg = days ? total / days : 0;
      $('#trendTitle').textContent = `每日${tname}`;
      $('#trendSub').textContent = avg ? `虛線為日均 ${money(Math.round(avg))}` : '';
      barChart($('#trendChart'), {
        labels: vals.map((_, i) => String(i + 1)),
        series: [{ name: tname, color: type === 'expense' ? 'var(--expense)' : 'var(--income)', values: vals }],
        avg,
        labelEvery: n > 20 ? 5 : 1,
        firstLabel: true,
        title: i => `${m + 1} 月 ${i + 1} 日（週${WEEKDAYS[new Date(y, m, i + 1).getDay()]}）`,
        height: 200,
      });
    } else {
      trendCard.hidden = true;
    }

    // ---- 近 N 個月收支 ----
    const monthsCard = $('#monthsChart').closest('.card');
    const N = ui.scope === 'year' ? 12 : 6;
    const startM = ui.scope === 'year'
      ? new Date(ui.month.getFullYear(), 0, 1)
      : new Date(ui.month.getFullYear(), ui.month.getMonth() - 5, 1);
    const mLabels = [], mInc = [], mExp = [], mTitles = [];
    for (let i = 0; i < N; i++) {
      const d = new Date(startM.getFullYear(), startM.getMonth() + i, 1);
      const [f, t] = monthRange(d);
      const l = txsIn(f, t);
      mLabels.push(`${d.getMonth() + 1}月`);
      mTitles.push(`${d.getFullYear()} 年 ${d.getMonth() + 1} 月`);
      mInc.push(sum(l, 'income'));
      mExp.push(sum(l, 'expense'));
    }
    $('h3', monthsCard).textContent = ui.scope === 'year' ? `${ui.month.getFullYear()} 年每月收支` : '近 6 個月收支';
    barChart($('#monthsChart'), {
      labels: mLabels,
      series: [
        { name: '收入', color: 'var(--income)', values: mInc },
        { name: '支出', color: 'var(--expense)', values: mExp },
      ],
      title: i => mTitles[i],
      footer: i => `結餘 ${money(mInc[i] - mExp[i])}`,
      height: 220,
    });

    // ---- 星期分布 ----
    const wSum = Array(7).fill(0), wCnt = Array(7).fill(0);
    for (let i = 0; i < days; i++) {
      wCnt[new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() + i).getDay()]++;
    }
    for (const t of list) if (t.type === type) wSum[parseYmd(t.date).getDay()] += t.amount;
    const order = [1, 2, 3, 4, 5, 6, 0]; // 週一開始
    barChart($('#weekChart'), {
      labels: order.map(d => WEEKDAYS[d]),
      series: [{ name: `平均${tname}`, color: 'var(--c7)', values: order.map(d => (wCnt[d] ? wSum[d] / wCnt[d] : 0)) }],
      title: i => `週${WEEKDAYS[order[i]]}`,
      footer: i => `共 ${wCnt[order[i]]} 天，合計 ${money(wSum[order[i]])}`,
      height: 180,
    });

    // ---- 單筆最高 ----
    $('#topTitle').textContent = `單筆最高${tname}`;
    const top = list.filter(t => t.type === type).sort((a, b) => b.amount - a.amount).slice(0, 5);
    const topEl = $('#topList');
    if (!top.length) topEl.replaceChildren(el('div', { class: 'no-data', text: '沒有資料' }));
    else topEl.replaceChildren(...top.map(t => {
      const c = catOf(t.type, t.category);
      const d = parseYmd(t.date);
      return el('li', {},
        el('div', { class: 't-main' },
          el('div', { class: 't-title', text: `${c.emoji} ${t.note || c.name}` }),
          el('div', { class: 't-sub', text: `${d.getMonth() + 1}/${d.getDate()}・${c.name}` }),
        ),
        el('div', { class: 't-amt', text: money(t.amount) }),
      );
    }));
  }

  function deltaText(cur, prev, unit, higherIsBad) {
    if (!prev) return { text: cur ? `${unit}無資料` : '—' };
    const d = cur - prev;
    if (Math.abs(d) < 0.005) return { text: `與${unit}持平` };
    const p = Math.abs(pct(d, prev));
    const up = d > 0;
    return {
      text: `${up ? '▲' : '▼'} ${p}% vs ${unit}`,
      cls: (up === higherIsBad) ? 'bad' : 'good',
    };
  }
  function balanceText(cur, prev, unit) {
    const d = cur - prev;
    if (Math.abs(d) < 0.005) return { text: `與${unit}持平` };
    return { text: `${d > 0 ? '▲' : '▼'} ${money(Math.abs(d))} vs ${unit}`, cls: d > 0 ? 'good' : 'bad' };
  }

  function renderCategories(list, prevList, type, total) {
    const box = $('#catChart');
    const by = new Map(), cnt = new Map(), prevBy = new Map();
    for (const t of list) if (t.type === type) {
      by.set(t.category, (by.get(t.category) || 0) + t.amount);
      cnt.set(t.category, (cnt.get(t.category) || 0) + 1);
    }
    for (const t of prevList) if (t.type === type) prevBy.set(t.category, (prevBy.get(t.category) || 0) + t.amount);

    $('#catSub').textContent = total ? `共 ${money(total)}` : '';
    if (!total) { box.replaceChildren(el('div', { class: 'no-data', text: '這段期間沒有資料' })); return; }

    const rows = CATEGORIES[type]
      .filter(c => by.get(c.id))
      .map(c => ({ c, v: by.get(c.id), n: cnt.get(c.id), prev: prevBy.get(c.id) || 0 }))
      .sort((a, b) => b.v - a.v);
    const max = rows[0].v;

    const stack = el('div', { class: 'stack', role: 'img', 'aria-label': '分類比例' });
    const rank = el('ol', { class: 'rank' });
    const hot = id => {
      stack.classList.toggle('hovering', !!id);
      $$('span', stack).forEach(s => s.classList.toggle('hot', s.dataset.id === id));
    };
    for (const r of rows) {
      const share = pct(r.v, total);
      const seg = el('span', { 'data-id': r.c.id, style: { flex: `${r.v} 0 0`, background: r.c.color } });
      seg.addEventListener('pointerenter', e => { hot(r.c.id); showTip(e.clientX, seg.getBoundingClientRect().top, r.c.name, [[r.c.color, money(r.v), `${share}%`]]); });
      seg.addEventListener('pointermove', e => moveTip(e.clientX, seg.getBoundingClientRect().top));
      seg.addEventListener('pointerleave', () => { hot(null); hideTip(); });
      stack.append(seg);

      let change = '';
      if (r.prev) {
        const d = pct(r.v - r.prev, r.prev);
        change = d === 0 ? '' : `${d > 0 ? '▲' : '▼'}${Math.abs(d)}%`;
      }
      const li = el('li', { '--cat': r.c.color },
        el('div', { class: 'r-icon', text: r.c.emoji, 'aria-hidden': 'true' }),
        el('div', { class: 'r-name' }, r.c.name, el('small', { text: `${r.n} 筆${change ? '・' + change : ''}` })),
        el('div', { class: 'r-val' }, money(r.v), el('small', { text: `${share}%` })),
        el('div', { class: 'r-track' }, el('div', { class: 'r-fill', style: { width: (r.v / max) * 100 + '%' } })),
      );
      li.addEventListener('pointerenter', () => hot(r.c.id));
      li.addEventListener('pointerleave', () => hot(null));
      rank.append(li);
    }
    box.replaceChildren(stack, rank);
  }

  // ================= 長條圖（SVG） =================
  function barChart(container, opt) {
    const W = Math.max(280, container.clientWidth || 600);
    const H = opt.height || 200;
    const m = { t: 10, r: 6, b: 24, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = opt.labels.length, k = opt.series.length;
    const maxV = Math.max(0, ...opt.series.flatMap(s => s.values), opt.avg || 0);
    const { ticks, top } = niceTicks(maxV);
    const yv = v => m.t + ih - (top ? (v / top) * ih : 0);

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.series.map(s => s.name).join('、') + '長條圖' });

    // 格線與 Y 軸刻度
    for (const t of ticks) {
      const y = yv(t);
      if (t > 0) root.append(svg('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y, y2: y }));
      const tx = svg('text', { class: 'grid-text', x: m.l - 8, y: y + 4, 'text-anchor': 'end' });
      tx.textContent = compact(t);
      root.append(tx);
    }

    const band = iw / n;
    const gap = 2;
    const groupW = Math.min(band * (k > 1 ? 0.72 : 0.7), k > 1 ? 44 : 28);
    const barW = Math.max(2, (groupW - gap * (k - 1)) / k);
    const bars = [];

    for (let i = 0; i < n; i++) {
      const gx = m.l + band * i + (band - groupW) / 2;
      const group = [];
      opt.series.forEach((s, j) => {
        const v = s.values[i];
        const x = gx + j * (barW + gap);
        if (v > 0) {
          const y = yv(v);
          const h = Math.max(1.5, m.t + ih - y);
          const p = svg('path', { class: 'bar', d: roundedTop(x, m.t + ih - h, barW, h, Math.min(4, barW / 2)), fill: s.color });
          root.append(p);
          group.push(p);
        }
      });
      bars.push(group);

      // X 軸標籤
      if (i % (opt.labelEvery || 1) === 0 || (opt.firstLabel && i === 0) || i === n - 1 && opt.labelEvery > 1 && (n - 1) % opt.labelEvery > 2) {
        const lt = svg('text', { class: 'grid-text', x: m.l + band * i + band / 2, y: H - 6, 'text-anchor': 'middle' });
        // 空間不足時去掉「月」等後綴，避免標籤擠在一起
        lt.textContent = band < 34 ? opt.labels[i].replace(/\D+$/, '') : opt.labels[i];
        root.append(lt);
      }
    }

    // 基線
    root.append(svg('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }));

    // 平均線
    if (opt.avg > 0) {
      const y = yv(opt.avg);
      root.append(svg('line', { class: 'avg-line', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    }

    // 互動熱區（整個欄位，比長條大）
    for (let i = 0; i < n; i++) {
      const hit = svg('rect', { class: 'bar-hit', x: m.l + band * i, y: m.t, width: band, height: ih, tabindex: 0 });
      const rows = opt.series.map(s => [s.color, money(s.values[i]), s.name]);
      const title = opt.title ? opt.title(i) : opt.labels[i];
      const footer = opt.footer ? opt.footer(i) : null;
      const enter = (x, y) => {
        container.classList.add('hovering');
        bars.forEach((g, gi) => g.forEach(b => b.classList.toggle('hot', gi === i)));
        showTip(x, y, title, rows, footer);
      };
      const tipY = () => {
        const r = hit.getBoundingClientRect();
        const maxVal = Math.max(...opt.series.map(s => s.values[i]));
        return r.top + (r.height * (yv(maxVal) - m.t)) / ih;
      };
      hit.addEventListener('pointerenter', e => enter(e.clientX, tipY()));
      hit.addEventListener('pointermove', e => moveTip(e.clientX, tipY()));
      hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); enter(r.left + r.width / 2, tipY()); });
      const leave = () => { container.classList.remove('hovering'); hideTip(); };
      hit.addEventListener('pointerleave', leave);
      hit.addEventListener('blur', leave);
      root.append(hit);
    }

    container.replaceChildren(root);
  }

  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function niceTicks(max) {
    if (max <= 0) return { ticks: [0], top: 0 };
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    return { ticks, top };
  }

  // ================= 提示框 =================
  const tip = $('#tooltip');
  function showTip(x, y, title, rows, footer) {
    tip.replaceChildren(
      el('div', { class: 'tt-title', text: title }),
      ...rows.map(([color, val, name]) => el('div', { class: 'tt-row' },
        el('i', { style: { background: color } }), el('b', { text: val }), el('span', { text: name }))),
      footer ? el('div', { class: 'tt-title', style: { marginTop: '4px', marginBottom: 0 }, text: footer }) : null,
    );
    tip.hidden = false;
    moveTip(x, y);
  }
  function moveTip(x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const cx = Math.min(window.innerWidth - w / 2 - 8, Math.max(w / 2 + 8, x));
    const cy = Math.max(h + 20, y);
    tip.style.left = cx + 'px';
    tip.style.top = cy + 'px';
  }
  function hideTip() { tip.hidden = true; }
  window.addEventListener('scroll', hideTip, { passive: true });

  // ================= 提示訊息 =================
  let toastTimer;
  function toast(msg, actionText, action) {
    const t = $('#toast');
    t.replaceChildren(msg);
    if (actionText) {
      t.append(el('button', {
        type: 'button', text: actionText,
        style: { marginLeft: '12px', border: 0, background: 'none', color: 'inherit', fontWeight: 700, textDecoration: 'underline', padding: 0 },
        onclick: () => { t.hidden = true; action(); },
      }));
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, actionText ? 5000 : 2200);
  }

  // ================= 選單 =================
  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { menu.hidden = true; hideTip(); } });

  menu.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.action;
    if (!a) return;
    menu.hidden = true;
    ({
      'budget': setBudget,
      'export-csv': exportCsv,
      'export-json': exportJson,
      'import-json': () => $('#importFile').click(),
      'backup-db': () => { location.href = 'api/backup'; },
      'demo': () => (demo ? hideDemo() : showDemo(false)),
      'clear': clearAll,
    })[a]?.();
  });

  // ================= 對話框（取代 prompt / confirm） =================
  function ask({ title, message, input, okText = '確定', danger = false }) {
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      let field = null;
      if (input) {
        field = el('input', {
          id: 'dialogInput', class: 'dialog-input', type: input.type || 'text',
          inputmode: input.inputmode, placeholder: input.placeholder || '', 'aria-label': title,
        });
        field.value = input.value ?? '';
      }
      const close = val => { overlay.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); resolve(val); };
      const ok = () => close(field ? field.value : true);
      const onKey = e => { if (e.key === 'Escape') close(null); };
      const overlay = el('div', { class: 'dialog-overlay', onclick: e => { if (e.target === overlay) close(null); } },
        el('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onsubmit: e => { e.preventDefault(); ok(); } },
          el('h3', { text: title }),
          message ? el('p', { text: message }) : null,
          field,
          el('div', { class: 'dialog-actions' },
            el('button', { type: 'button', class: 'btn ghost', text: '取消', onclick: () => close(null) }),
            el('button', { type: 'submit', class: 'btn ' + (danger ? 'danger' : 'primary'), text: okText }),
          ),
        ),
      );
      document.addEventListener('keydown', onKey);
      document.body.append(overlay);
      (field || $('.dialog-actions .btn:last-child', overlay)).focus();
    });
  }

  async function setBudget() {
    const v = await ask({
      title: '每月支出預算',
      message: '留空或填 0 代表不設定預算。',
      input: { type: 'number', inputmode: 'decimal', value: db.budget || '', placeholder: '例如 30000' },
      okText: '儲存',
    });
    if (v === null) return;
    const n = parseFloat(v);
    db.budget = n > 0 ? Math.round(n * 100) / 100 : null;
    save({ settings: true });
    render();
    toast(db.budget ? `已設定每月預算 ${money(db.budget)}` : '已取消預算');
  }

  async function download(name, content, mime) {
    // 在 claude.ai 裡要透過 downloads 能力存檔；一般瀏覽器用下載連結
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) {
      try {
        await dl.save({ filename: name, data: content });
        toast('✅ 已匯出');
      } catch (e) {
        if (e?.code !== 'declined') toast('⚠️ 無法匯出檔案，請稍後再試');
      }
      return;
    }
    const a = el('a', { href: URL.createObjectURL(new Blob([content], { type: mime })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function exportCsv() {
    if (!db.txs.length) { toast('目前沒有可以匯出的紀錄'); return; }
    const esc = s => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [['日期', '類型', '分類', '金額', '備註'].join(',')];
    [...db.txs].sort((a, b) => a.date.localeCompare(b.date)).forEach(t =>
      lines.push([t.date, TYPE_NAME[t.type], catOf(t.type, t.category).name, t.amount, esc(t.note || '')].join(',')));
    download(`記帳_${ymd(today)}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }
  function exportJson() {
    if (!db.txs.length) { toast('目前沒有可以備份的紀錄'); return; }
    download(`記帳備份_${ymd(today)}.json`, JSON.stringify({ txs: db.txs.map(cleanTx), budget: db.budget }, null, 2), 'application/json');
  }
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let data, txs;
    try {
      data = JSON.parse(await f.text());
      txs = (Array.isArray(data) ? data : data.txs || []).filter(validTx)
        .map(t => cleanTx({ ...t, id: t.id || uid(), category: catOf(t.type, t.category).id, createdAt: t.createdAt || Date.now() }));
      if (!txs.length) throw new Error('empty');
    } catch {
      toast('⚠️ 這個檔案不是小記帳的備份檔');
      return;
    }
    const ok = await ask({
      title: '從備份還原',
      message: `備份裡有 ${txs.length} 筆紀錄，會取代目前的 ${db.txs.length} 筆紀錄。`,
      okText: '還原',
      danger: db.txs.length > 0,
    });
    if (!ok) return;
    demo = null;
    db = { txs, budget: data.budget > 0 ? data.budget : db.budget, started: true };
    save({ all: true });
    render();
    toast(`✅ 已還原 ${txs.length} 筆紀錄`);
  });

  async function clearAll() {
    if (!db.txs.length) { toast('目前沒有資料'); return; }
    const ok = await ask({
      title: '清除全部資料',
      message: `會刪除全部 ${db.txs.length} 筆紀錄，而且無法復原。建議先用「備份 JSON」存一份。`,
      okText: '全部刪除',
      danger: true,
    });
    if (!ok) return;
    db = { txs: [], budget: db.budget, started: true };
    save({ all: true });
    resetForm();
    render();
    toast('已清除全部資料');
  }

  // ================= 示範資料（只在記憶體裡，不會存檔） =================
  function showDemo(auto) {
    demo = { txs: buildDemo(), budget: 30000, auto };
    ui.month = new Date(today.getFullYear(), today.getMonth(), 1);
    resetForm();
    render();
  }
  function hideDemo() {
    const wasAuto = demo?.auto;
    demo = null;
    if (wasAuto && !db.started) { db.started = true; save({ settings: true }); }
    render();
  }
  $('#demoExit').addEventListener('click', hideDemo);

  function buildDemo() {
    let seed = 42;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const notes = {
      food: ['早餐蛋餅', '午餐便當', '晚餐拉麵', '手搖飲', '咖啡', '超商', '火鍋聚餐', '早午餐'],
      shopping: ['衣服', '日用品', '網購', '鞋子', '3C 配件'],
      fun: ['電影', 'Netflix', '唱歌', '遊戲點數', '展覽'],
      health: ['診所', '藥局', '健身房'],
      edu: ['線上課程', '書籍', '講座'],
      other: ['紅包', '捐款', '雜支'],
    };
    const out = [];
    let n = 0;
    const add = (d, type, category, amount, note) =>
      out.push({ id: 'demo' + n++, createdAt: d.getTime() + n, type, category, amount: Math.round(amount), date: ymd(d), note });

    for (let back = 5; back >= 0; back--) {
      const ms = new Date(today.getFullYear(), today.getMonth() - back, 1);
      const y = ms.getFullYear(), mo = ms.getMonth();
      const last = back === 0 ? today.getDate() : daysInMonth(y, mo);
      add(new Date(y, mo, Math.min(5, last)), 'income', 'salary', 52000, '月薪');
      add(new Date(y, mo, Math.min(1, last)), 'expense', 'home', 15000, '房租');
      if (last >= 15) add(new Date(y, mo, 15), 'expense', 'home', 900 + rnd() * 900, '水電費');
      if (rnd() < 0.5) add(new Date(y, mo, Math.ceil(rnd() * last)), 'income', 'side', 3000 + rnd() * 6000, '接案');
      if (rnd() < 0.35) add(new Date(y, mo, Math.ceil(rnd() * last)), 'income', 'invest', 800 + rnd() * 4000, '股利');
      if (mo === 0 || mo === 6) add(new Date(y, mo, Math.min(20, last)), 'income', 'bonus', 20000 + rnd() * 30000, '獎金');
      for (let d = 1; d <= last; d++) {
        const day = new Date(y, mo, d);
        const weekend = day.getDay() === 0 || day.getDay() === 6;
        add(day, 'expense', 'food', 60 + rnd() * 80, pick(['早餐蛋餅', '咖啡', '早午餐']));
        add(day, 'expense', 'food', 100 + rnd() * (weekend ? 500 : 150), pick(notes.food));
        if (!weekend) add(day, 'expense', 'transport', 30 + rnd() * 40, pick(['捷運', '公車']));
        if (rnd() < 0.18) add(day, 'expense', 'shopping', 200 + rnd() * 2000, pick(notes.shopping));
        if (rnd() < (weekend ? 0.45 : 0.1)) add(day, 'expense', 'fun', 150 + rnd() * 900, pick(notes.fun));
        if (rnd() < 0.05) add(day, 'expense', 'health', 150 + rnd() * 600, pick(notes.health));
        if (rnd() < 0.04) add(day, 'expense', 'edu', 300 + rnd() * 1500, pick(notes.edu));
        if (rnd() < 0.04) add(day, 'expense', 'transport', 200 + rnd() * 1300, pick(['Uber', '加油', '高鐵']));
        if (rnd() < 0.03) add(day, 'expense', 'other', 100 + rnd() * 800, pick(notes.other));
      }
    }
    return out;
  }

  // ================= 渲染入口 =================
  function render() {
    renderMonthLabel();
    $('#demoBanner').hidden = !demo;
    const demoBtn = $('[data-action="demo"]');
    if (demoBtn) demoBtn.textContent = demo ? '隱藏示範資料' : '查看示範資料';
    if (ui.route === 'ledger') renderLedger();
    else renderAnalysis();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (ui.route === 'analysis') renderAnalysis(); }, 150);
  });

  setFormType('expense');
  resetForm();
  // 第一次使用時先顯示示範資料，讓畫面不是空的
  if (!db.started && !db.txs.length) demo = { txs: buildDemo(), budget: 30000, auto: true };
  route();
  cloud.init();
  sqlite.init();
})();
