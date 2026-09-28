(() => {
  'use strict';

  const CFG = window.KALENDARZ_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const END = CFG.END_DATE || '2026-11-30';
  const AUTH_KEY = 'sowki-auth';
  const LAST_CHILD_KEY = 'sowki-last-child';
  const STATS_PREVIEW = 10;

  const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

  const state = {
    password: null,
    role: null,
    entries: [],
    finalDate: null,
    selected: new Set(),
    editingId: null,
    tab: 'calendar',
    search: '',
    showAllStats: false,
    lastSync: 0,
  };

  // ---------- Narzędzia ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pad = (n) => String(n).padStart(2, '0');
  const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => toIso(new Date());
  const selectable = (iso) => iso >= today() && iso <= END;
  const isAdmin = () => state.role === 'admin';
  const isClosed = () => !!state.finalDate;
  const canEdit = () => !isClosed() || isAdmin();
  const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const nameKey = (s) => normName(s).toLocaleLowerCase('pl');
  const byName = (a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' });

  const fmt = (iso, opts) => new Intl.DateTimeFormat('pl-PL', opts).format(fromIso(iso));
  const fmtLong = (iso) => cap(fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }));
  const fmtFull = (iso) => cap(fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const fmtShort = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const d = n % 10, h = n % 100;
    return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
  }
  const nDays = (n) => `${n} ${plural(n, 'dzień', 'dni', 'dni')}`;
  const nVotes = (n) => `${n} ${plural(n, 'głos', 'głosy', 'głosów')}`;
  const nEntries = (n) => `${n} ${plural(n, 'wpis', 'wpisy', 'wpisów')}`;
  const nTerms = (n) => `${n} ${plural(n, 'termin', 'terminy', 'terminów')}`;

  function hue(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  const store = {
    get(key, session = false) {
      try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)); } catch { return null; }
    },
    set(key, val, session = false) {
      try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(val)); } catch { /* brak dostępu */ }
    },
    del(key) {
      try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* brak dostępu */ }
    },
  };

  // ---------- API ----------
  class ApiError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function api(action, data = {}) {
    const body = { action, password: state.password, ...data };
    if (DEMO) return demoApi(body);
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.', 'NET');
    }
    if (!res.ok) throw new ApiError(`Serwer zwrócił błąd (${res.status}). Spróbuj ponownie za chwilę.`, 'NET');
    let json;
    try { json = await res.json(); } catch { throw new ApiError('Nieprawidłowa odpowiedź serwera.', 'NET'); }
    if (!json.ok) throw new ApiError(json.error || 'Nieznany błąd.', json.code);
    return json;
  }

  // Tryb demo – ta sama logika co w Apps Script, dane w localStorage.
  const DEMO_KEY = 'sowki-demo-db';
  let demoDb = null;
  function demoSeed() {
    const t = fromIso(today());
    const d = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return toIso(x); };
    const mk = (child, offs) => ({ id: crypto.randomUUID(), child, dates: offs.map(d).filter((x) => x <= END).sort(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return {
      finalDate: null,
      entries: [
        mk('Ania', [2, 3, 9, 10, 16]),
        mk('Kuba', [3, 9, 10, 17]),
        mk('Zosia K.', [9, 10, 23]),
        mk('Staś', [3, 10, 16, 24]),
        mk('Lena', [10, 11, 17]),
      ],
    };
  }
  async function demoApi(body) {
    await new Promise((r) => setTimeout(r, 300));
    const role = body.password === 'admin' ? 'admin' : body.password === 'demo' ? 'user' : null;
    if (!role) throw new ApiError('Nieprawidłowe hasło.', 'AUTH');
    if (!demoDb) demoDb = store.get(DEMO_KEY) || demoSeed();
    const db = demoDb;
    const now = new Date().toISOString();
    switch (body.action) {
      case 'login':
      case 'list':
        break;
      case 'save': {
        if (db.finalDate && role !== 'admin') throw new ApiError('Głosowanie jest już zamknięte.', 'CLOSED');
        const child = normName(body.child);
        if (!child) throw new ApiError('Wpisz imię dziecka.');
        const dates = [...new Set(body.dates || [])].sort();
        if (!dates.length) throw new ApiError('Zaznacz co najmniej jeden dzień.');
        if (body.id) {
          const e = db.entries.find((x) => x.id === body.id);
          if (!e) throw new ApiError('Ten wpis został w międzyczasie usunięty.', 'NOT_FOUND');
          Object.assign(e, { child, dates, updatedAt: now });
        } else {
          db.entries.push({ id: crypto.randomUUID(), child, dates, createdAt: now, updatedAt: now });
        }
        break;
      }
      case 'remove':
        if (role !== 'admin') throw new ApiError('Tylko administrator może usuwać wpisy.', 'FORBIDDEN');
        db.entries = db.entries.filter((x) => x.id !== body.id);
        break;
      case 'setFinal':
        if (role !== 'admin') throw new ApiError('Tylko administrator może zamknąć głosowanie.', 'FORBIDDEN');
        db.finalDate = body.finalDate || null;
        break;
      default:
        throw new ApiError('Nieznana akcja.');
    }
    store.set(DEMO_KEY, db);
    return JSON.parse(JSON.stringify({ ok: true, role, entries: db.entries, settings: { finalDate: db.finalDate } }));
  }

  function applyData(res) {
    state.entries = Array.isArray(res.entries) ? res.entries : [];
    state.finalDate = res.settings?.finalDate || null;
    if (res.role) state.role = res.role;
    state.lastSync = Date.now();
    if (state.editingId && !state.entries.some((e) => e.id === state.editingId)) {
      state.editingId = null;
      state.selected.clear();
      toast('Edytowany wpis został w międzyczasie usunięty.', true);
    }
    if (!canEdit() && !state.editingId) state.selected.clear();
    render();
  }

  function handleError(err) {
    if (err.code === 'AUTH') {
      logout();
      toast('Sesja wygasła lub hasło się zmieniło – zaloguj się ponownie.', true);
      return;
    }
    toast(err.message || 'Coś poszło nie tak.', true);
    if (err.code === 'CLOSED' || err.code === 'NOT_FOUND') refresh(true);
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('is-error', isError);
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), isError ? 5000 : 3200);
  }

  function setBusy(btn, busy) {
    btn.disabled = busy;
    btn.classList.toggle('is-busy', busy);
  }

  // ---------- Dane pochodne ----------
  function tally() {
    const map = new Map();
    for (const e of state.entries) {
      for (const d of e.dates) {
        if (!map.has(d)) map.set(d, []);
        map.get(d).push(e.child);
      }
    }
    return map;
  }

  function monthsInRange() {
    const start = fromIso(today() < END ? today() : END);
    const end = fromIso(END);
    const out = [];
    for (let y = start.getFullYear(), m = start.getMonth(); y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth());) {
      out.push({ y, m });
      if (++m > 11) { m = 0; y++; }
    }
    return out;
  }

  const editingEntry = () => state.entries.find((e) => e.id === state.editingId) || null;

  // ---------- Renderowanie ----------
  function render() {
    $('#adminBadge').hidden = !isAdmin();
    $('#adminLoginBtn').hidden = isAdmin();
    $('#entriesCount').textContent = state.entries.length;
    renderStatus();
    renderEditBanner();
    renderCalendar();
    renderStats();
    renderEntries();
    renderActionBar();
  }

  function renderStatus() {
    const el = $('#statusBanner');
    if (!isClosed()) { el.innerHTML = ''; return; }
    const votes = tally().get(state.finalDate)?.length || 0;
    el.innerHTML = `
      <div class="banner banner-final">
        <div class="banner-ico"><svg><use href="#i-star"/></svg></div>
        <div class="banner-body">
          <small>Termin spotkania wybrany</small>
          <strong>${esc(fmtFull(state.finalDate))}</strong>
          <p>Głosowanie jest zamknięte · ten termin pasuje ${votes} z ${state.entries.length} rodzin.</p>
        </div>
        ${isAdmin() ? '<button class="btn btn-ghost btn-sm" type="button" data-reopen>Otwórz głosowanie ponownie</button>' : ''}
      </div>`;
  }

  function renderEditBanner() {
    const el = $('#editBanner');
    const e = editingEntry();
    $('#steps').hidden = !!e || !canEdit();
    if (!e) {
      el.innerHTML = !canEdit()
        ? `<div class="banner banner-edit"><svg class="ico"><use href="#i-lock"/></svg><div class="banner-body"><p>Głosowanie jest zamknięte – kalendarz pokazuje już tylko wyniki.</p></div></div>`
        : '';
      return;
    }
    el.innerHTML = `
      <div class="banner banner-edit">
        <svg class="ico"><use href="#i-edit"/></svg>
        <div class="banner-body">
          <p>Edytujesz wpis <strong style="display:inline;font-size:inherit">${esc(e.child)}</strong>. Zaznacz lub odznacz dni, a potem kliknij „Zapisz zmiany”.</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-cancel-edit>Anuluj edycję</button>
      </div>`;
  }

  function renderCalendar() {
    const votes = tally();
    const max = Math.max(1, ...[...votes.values()].map((a) => a.length));
    const locked = !canEdit();
    const t = today();
    let html = '';
    for (const { y, m } of monthsInRange()) {
      const first = new Date(y, m, 1);
      const count = new Date(y, m + 1, 0).getDate();
      const offset = (first.getDay() + 6) % 7;
      html += `<section class="month" aria-label="${MONTHS[m]} ${y}"><h3>${MONTHS[m]} ${y}</h3>`;
      html += `<div class="weekdays" aria-hidden="true">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div><div class="grid">`;
      // W bieżącym miesiącu pomijamy tygodnie, które w całości już minęły.
      let startDay = 1;
      if (t.startsWith(`${y}-${pad(m + 1)}-`)) {
        const td = Number(t.slice(8));
        startDay = Math.max(1, td - (offset + td - 1) % 7);
        const prefix = `${y}-${pad(m + 1)}-`;
        const hiddenUsed = [...state.selected].some((d) => d.startsWith(prefix) && Number(d.slice(8)) < startDay);
        if (hiddenUsed) startDay = 1;
      }
      html += '<span></span>'.repeat(startDay === 1 ? offset : 0);
      for (let d = startDay; d <= count; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
        const n = votes.get(iso)?.length || 0;
        const sel = state.selected.has(iso);
        const wd = (offset + d - 1) % 7;
        const isFinal = iso === state.finalDate;
        if (!selectable(iso) && !sel && !isFinal && !n) {
          html += `<span class="day is-out" aria-hidden="true"><span class="num">${d}</span></span>`;
          continue;
        }
        const cls = ['day',
          sel && 'is-selected',
          wd >= 5 && 'is-weekend',
          iso === t && 'is-today',
          isFinal && 'is-final',
          n && 'has-votes',
          (locked || (!selectable(iso) && !sel)) && 'is-locked',
        ].filter(Boolean).join(' ');
        const label = `${fmtLong(iso)}${n ? `, ${nVotes(n)}` : ', brak głosów'}${isFinal ? ', wybrany termin' : ''}`;
        html += `<button type="button" class="${cls}" data-date="${iso}" aria-pressed="${sel}" aria-label="${esc(label)}" style="--heat-l:${(n / max).toFixed(3)}">`
          + (isFinal ? '<svg class="star" aria-hidden="true"><use href="#i-star"/></svg>' : '')
          + `<span class="num">${d}</span>${n ? `<span class="votes" aria-hidden="true">${n}</span>` : ''}</button>`;
      }
      html += '</div></section>';
    }
    $('#months').innerHTML = html;
  }

  function renderStats() {
    const total = state.entries.length;
    const rows = [...tally()].map(([date, names]) => ({ date, names: names.slice().sort(byName), n: names.length }))
      .sort((a, b) => b.n - a.n || a.date.localeCompare(b.date));
    const t = today();
    const best = rows.find((r) => r.date >= t) || rows[0];
    const topN = best ? best.n : 0;

    $('#summary').innerHTML = `
      <div class="stat-card"><small>Wpisy rodzin</small><strong>${total}</strong></div>
      <div class="stat-card"><small>Dni z głosami</small><strong>${rows.length}</strong></div>
      ${best ? `<div class="stat-card is-best"><small>${isClosed() ? 'Wybrany termin' : 'Na razie najlepszy termin'}</small>
        <strong>${esc(fmtLong(isClosed() ? state.finalDate : best.date))}</strong>
        <span>${isClosed() ? `pasuje ${tally().get(state.finalDate)?.length || 0} z ${total} rodzin` : `pasuje ${best.n} z ${total} rodzin`}</span></div>` : ''}`;

    $('#statsSub').textContent = total
      ? `Posortowane od najpopularniejszych. Pasek pokazuje, jakiej części rodzin pasuje dany dzień.${isAdmin() && !isClosed() ? ' Jako admin możesz wybrać termin i zamknąć głosowanie.' : ''}`
      : '';

    if (!rows.length) {
      $('#statsList').innerHTML = `<li class="empty"><svg aria-hidden="true"><use href="#i-owl"/></svg><strong>Jeszcze nikt nie zagłosował</strong>Bądź pierwszy – zaznacz pasujące dni w kalendarzu.<br><button class="btn btn-primary" type="button" data-goto="calendar">Zaznacz daty</button></li>`;
      $('#statsMore').innerHTML = '';
      return;
    }

    const shown = state.showAllStats ? rows : rows.slice(0, STATS_PREVIEW);
    $('#statsList').innerHTML = shown.map((r, i) => {
      const isFinal = r.date === state.finalDate;
      const isTop = !isClosed() && r.n === topN && r.date >= t;
      const past = r.date < t;
      return `
        <li class="stat-row${isTop ? ' is-top' : ''}${isFinal ? ' is-final' : ''}">
          <div class="stat-top">
            <div class="stat-date"><span class="rank">${i + 1}.</span>${esc(fmtLong(r.date))}
              ${isFinal ? '<span class="tag tag-final">Wybrany termin</span>' : ''}
              ${isTop ? '<span class="tag">Najwięcej głosów</span>' : ''}
              ${past ? '<span class="tag tag-past">Minął</span>' : ''}
            </div>
            <div class="stat-count"><strong>${r.n}</strong> / ${total}</div>
          </div>
          <div class="bar" role="img" aria-label="${r.n} z ${total} rodzin"><span style="width:${(r.n / Math.max(total, 1) * 100).toFixed(1)}%"></span></div>
          <p class="stat-names">${r.names.map(esc).join(', ')}</p>
          ${isAdmin() && !isFinal && !past ? `<div class="stat-actions"><button class="btn btn-accent btn-sm" type="button" data-final="${r.date}"><svg class="ico"><use href="#i-star"/></svg>Wybierz ten termin</button></div>` : ''}
        </li>`;
    }).join('');

    $('#statsMore').innerHTML = rows.length > STATS_PREVIEW
      ? `<button class="btn btn-ghost" type="button" data-toggle-stats>${state.showAllStats ? 'Pokaż mniej' : `Pokaż wszystkie (${rows.length})`}</button>`
      : '';
  }

  function renderEntries() {
    const q = nameKey(state.search);
    const t = today();
    const list = state.entries.filter((e) => !q || nameKey(e.child).includes(q)).sort((a, b) => byName(a.child, b.child));
    if (!state.entries.length) {
      $('#entriesList').innerHTML = `<div class="empty" style="grid-column:1/-1"><svg aria-hidden="true"><use href="#i-owl"/></svg><strong>Brak wpisów</strong>Tu pojawią się wszystkie zapisane terminy.<br><button class="btn btn-primary" type="button" data-goto="calendar">Zaznacz daty</button></div>`;
      return;
    }
    if (!list.length) {
      $('#entriesList').innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Nic nie znaleziono</strong>Brak wpisu z imieniem „${esc(state.search)}”.</div>`;
      return;
    }
    $('#entriesList').innerHTML = list.map((e) => {
      const h = hue(nameKey(e.child));
      return `
        <article class="entry${e.id === state.editingId ? ' is-editing' : ''}">
          <div class="entry-head">
            <span class="avatar" style="--h:${h}" aria-hidden="true">${esc(e.child.charAt(0).toUpperCase())}</span>
            <div><h3>${esc(e.child)}</h3><small>${nTerms(e.dates.length)}</small></div>
          </div>
          <ul class="chips">${e.dates.map((d) => `<li class="chip${d === state.finalDate ? ' is-final' : d < t ? ' is-past' : ''}">${esc(fmtShort(d))}</li>`).join('')}</ul>
          ${canEdit() ? `<div class="entry-actions">
            ${isAdmin() ? `<button class="btn btn-danger-ghost btn-sm" type="button" data-delete="${esc(e.id)}"><svg class="ico"><use href="#i-trash"/></svg>Usuń</button>` : ''}
            <button class="btn btn-ghost btn-sm" type="button" data-edit="${esc(e.id)}"><svg class="ico"><use href="#i-edit"/></svg>Edytuj</button>
          </div>` : ''}
        </article>`;
    }).join('');
  }

  function renderActionBar() {
    const n = state.selected.size;
    const e = editingEntry();
    const show = state.tab === 'calendar' && canEdit() && (n > 0 || !!e);
    $('#actionBar').hidden = !show;
    if (!show) return;
    const sorted = [...state.selected].sort();
    const preview = sorted.slice(0, 4).map(fmtShort).join(' · ') + (sorted.length > 4 ? ' …' : '');
    $('#actionText').innerHTML = e
      ? `<strong>${esc(e.child)}</strong> · ${nDays(n)}<small>${esc(preview) || 'Nie zaznaczono żadnego dnia'}</small>`
      : `Zaznaczono <strong>${nDays(n)}</strong><small>${esc(preview)}</small>`;
    $('#actionSecondary').textContent = e ? 'Anuluj' : 'Wyczyść';
    $('#actionPrimary').innerHTML = e ? 'Zapisz zmiany' : 'Dalej <svg class="ico"><use href="#i-arrow"/></svg>';
    $('#actionPrimary').disabled = n === 0;
  }

  // ---------- Akcje ----------
  function setTab(tab) {
    state.tab = tab;
    for (const btn of document.querySelectorAll('.tab')) btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    for (const p of document.querySelectorAll('.tab-panel')) p.hidden = p.id !== `tab-${tab}`;
    renderActionBar();
    window.scrollTo({ top: 0 });
  }

  function toggleDay(btn) {
    const iso = btn.dataset.date;
    if (!canEdit()) { toast('Głosowanie jest zamknięte.'); return; }
    const sel = state.selected.has(iso);
    if (!sel && !selectable(iso)) { toast('Ten dzień już minął.'); return; }
    if (sel) state.selected.delete(iso); else state.selected.add(iso);
    btn.classList.toggle('is-selected', !sel);
    btn.setAttribute('aria-pressed', String(!sel));
    if (sel && !selectable(iso)) btn.classList.add('is-locked');
    renderActionBar();
  }

  function startEdit(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    state.editingId = id;
    state.selected = new Set(e.dates);
    render();
    setTab('calendar');
    toast(`Edytujesz wpis: ${e.child}`);
  }

  function cancelEdit() {
    state.editingId = null;
    state.selected.clear();
    render();
  }

  // Modal zapisu
  let pendingDup = null;
  function openSaveDialog() {
    if (!state.selected.size) { toast('Zaznacz co najmniej jeden dzień.'); return; }
    const e = editingEntry();
    const sorted = [...state.selected].sort();
    $('#saveTitle').textContent = e ? 'Zapisz zmiany we wpisie' : 'Zapisz wybrane terminy';
    $('#saveCountLabel').textContent = `Wybrane dni (${sorted.length})`;
    $('#saveChips').innerHTML = sorted.map((d) => `<li class="chip">${esc(fmtShort(d))}</li>`).join('');
    const input = $('#childName');
    input.value = e ? e.child : (store.get(LAST_CHILD_KEY) || '');
    input.classList.remove('is-invalid');
    $('#childError').textContent = '';
    hideDup();
    $('#saveSubmit').textContent = e ? 'Zapisz zmiany' : 'Zapisz';
    $('#saveDialog').showModal();
    input.focus();
    if (input.value) input.select();
  }

  function hideDup() {
    pendingDup = null;
    $('#dupNotice').hidden = true;
    $('#saveFoot').hidden = false;
  }

  async function submitSave({ mergeInto = null, forceNew = false } = {}) {
    const input = $('#childName');
    let child = normName(input.value);
    if (!child) {
      input.classList.add('is-invalid');
      $('#childError').textContent = 'Wpisz imię dziecka – bez tego nie da się zapisać terminów.';
      input.focus();
      return;
    }
    let id = state.editingId;
    let dates = [...state.selected].sort();

    if (!id && !mergeInto && !forceNew) {
      const dup = state.entries.find((x) => nameKey(x.child) === nameKey(child));
      if (dup) {
        pendingDup = dup;
        $('#dupText').innerHTML = `Istnieje już wpis <strong>${esc(dup.child)}</strong> (${nTerms(dup.dates.length)}). Jeśli to Twoje dziecko, dopisz nowe dni do tego wpisu. Jeśli to inne dziecko o tym samym imieniu, zapisz osobny wpis – najlepiej z pierwszą literą nazwiska.`;
        $('#dupNotice').hidden = false;
        $('#saveFoot').hidden = true;
        $('#dupMerge').focus();
        return;
      }
    }
    if (mergeInto) {
      id = mergeInto.id;
      child = mergeInto.child;
      dates = [...new Set([...mergeInto.dates, ...dates])].sort();
    }

    const btns = [$('#saveSubmit'), $('#dupMerge'), $('#dupNew')];
    const active = mergeInto ? $('#dupMerge') : forceNew ? $('#dupNew') : $('#saveSubmit');
    btns.forEach((b) => { b.disabled = true; });
    setBusy(active, true);
    try {
      const res = await api('save', { id, child, dates });
      store.set(LAST_CHILD_KEY, child);
      const wasEdit = !!state.editingId;
      state.editingId = null;
      state.selected.clear();
      $('#saveDialog').close();
      applyData(res);
      toast(wasEdit || mergeInto ? 'Zmiany zapisane. Dziękujemy!' : 'Zapisano! Dziękujemy za głos 🦉');
    } catch (err) {
      handleError(err);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      setBusy(active, false);
    }
  }

  function confirmDialog({ title, text, ok = 'OK', danger = false }) {
    const dlg = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    const okBtn = $('#confirmOk');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    });
  }

  async function removeEntry(id, btn) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    const ok = await confirmDialog({ title: 'Usunąć wpis?', text: `Wpis „${e.child}” (${nTerms(e.dates.length)}) zostanie trwale usunięty.`, ok: 'Usuń', danger: true });
    if (!ok) return;
    setBusy(btn, true);
    try {
      applyData(await api('remove', { id }));
      toast('Wpis usunięty.');
    } catch (err) {
      handleError(err);
      setBusy(btn, false);
    }
  }

  async function setFinal(date, btn) {
    const ok = date
      ? await confirmDialog({ title: 'Wybrać ten termin?', text: `${fmtFull(date)} zostanie ogłoszony jako termin spotkania. Głosowanie zostanie zamknięte – rodzice nie będą mogli już zmieniać wpisów (możesz je później otworzyć ponownie).`, ok: 'Wybierz i zamknij' })
      : await confirmDialog({ title: 'Otworzyć głosowanie?', text: 'Wybrany termin zostanie anulowany, a rodzice znów będą mogli zaznaczać i edytować daty.', ok: 'Otwórz' });
    if (!ok) return;
    setBusy(btn, true);
    try {
      applyData(await api('setFinal', { finalDate: date }));
      toast(date ? 'Termin ogłoszony, głosowanie zamknięte.' : 'Głosowanie jest znowu otwarte.');
    } catch (err) {
      handleError(err);
      setBusy(btn, false);
    }
  }

  let refreshing = false;
  async function refresh(silent = false) {
    if (refreshing || !state.password) return;
    refreshing = true;
    $('#refreshBtn').classList.add('is-spinning');
    try {
      applyData(await api('list'));
      if (!silent) toast('Dane odświeżone.');
    } catch (err) {
      if (!silent || err.code === 'AUTH') handleError(err);
    } finally {
      refreshing = false;
      $('#refreshBtn').classList.remove('is-spinning');
    }
  }

  // ---------- Logowanie ----------
  function persistAuth() {
    store.del(AUTH_KEY);
    store.set(AUTH_KEY, { password: state.password, role: state.role }, isAdmin());
  }

  function showScreen(which) {
    $('#boot').hidden = true;
    $('#loginScreen').hidden = which !== 'login';
    $('#app').hidden = which !== 'app';
    $('#demoBanner').hidden = !DEMO;
  }

  function logout() {
    store.del(AUTH_KEY);
    Object.assign(state, { password: null, role: null, entries: [], finalDate: null, editingId: null });
    state.selected.clear();
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    $('#loginPassword').value = '';
    $('#loginError').textContent = '';
    showScreen('login');
    $('#loginPassword').focus();
  }

  async function onLogin(ev) {
    ev.preventDefault();
    const input = $('#loginPassword');
    const pw = input.value.trim();
    if (!pw) { $('#loginError').textContent = 'Wpisz hasło.'; input.focus(); return; }
    const btn = $('#loginSubmit');
    setBusy(btn, true);
    $('#loginError').textContent = '';
    try {
      const res = await api('login', { password: pw });
      state.password = pw;
      state.role = res.role;
      persistAuth();
      showScreen('app');
      setTab('calendar');
      applyData(res);
      if (isAdmin()) toast('Zalogowano jako administrator.');
    } catch (err) {
      $('#loginError').textContent = err.code === 'AUTH' ? 'Nieprawidłowe hasło. Sprawdź wielkość liter i spróbuj ponownie.' : err.message;
      input.select();
    } finally {
      setBusy(btn, false);
    }
  }

  async function onAdminLogin(ev) {
    ev.preventDefault();
    const input = $('#adminPassword');
    const pw = input.value.trim();
    const err = $('#adminError');
    if (!pw) { err.textContent = 'Wpisz hasło administratora.'; input.focus(); return; }
    const btn = $('#adminSubmit');
    setBusy(btn, true);
    err.textContent = '';
    try {
      const res = await api('login', { password: pw });
      if (res.role !== 'admin') { err.textContent = 'To nie jest hasło administratora.'; input.select(); return; }
      state.password = pw;
      state.role = 'admin';
      persistAuth();
      $('#adminDialog').close();
      applyData(res);
      toast('Zalogowano jako administrator.');
    } catch (e) {
      err.textContent = e.code === 'AUTH' ? 'Nieprawidłowe hasło.' : e.message;
      input.select();
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------- Zdarzenia ----------
  function bind() {
    for (const el of document.querySelectorAll('[data-group]')) el.textContent = CFG.GROUP || el.textContent;
    for (const el of document.querySelectorAll('[data-title]')) el.textContent = CFG.TITLE || el.textContent;

    $('#loginForm').addEventListener('submit', onLogin);
    $('#adminForm').addEventListener('submit', onAdminLogin);
    $('#saveForm').addEventListener('submit', (ev) => { ev.preventDefault(); submitSave(); });
    $('#dupMerge').addEventListener('click', () => pendingDup && submitSave({ mergeInto: pendingDup }));
    $('#dupNew').addEventListener('click', () => submitSave({ forceNew: true }));
    $('#childName').addEventListener('input', () => {
      $('#childName').classList.remove('is-invalid');
      $('#childError').textContent = '';
      if (pendingDup) hideDup();
    });

    for (const btn of document.querySelectorAll('[data-pw-toggle]')) {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.pwToggle);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Ukryj hasło' : 'Pokaż hasło');
      });
    }

    for (const dlg of document.querySelectorAll('dialog')) {
      dlg.addEventListener('click', (ev) => {
        // Okno zapisu nie zamyka się po stuknięciu w tło, żeby nie zgubić wpisanego imienia.
        if (ev.target.closest('[data-close]') || (ev.target === dlg && dlg.id !== 'saveDialog')) dlg.close();
      });
    }

    for (const btn of document.querySelectorAll('.tab')) btn.addEventListener('click', () => setTab(btn.dataset.tab));
    $('.tabs').addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      const tabs = [...document.querySelectorAll('.tab')];
      const i = tabs.findIndex((t) => t.dataset.tab === state.tab);
      const next = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      setTab(next.dataset.tab);
      next.focus();
    });

    $('#months').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button.day');
      if (btn) toggleDay(btn);
    });

    $('#actionPrimary').addEventListener('click', openSaveDialog);
    $('#actionSecondary').addEventListener('click', () => {
      if (state.editingId) { cancelEdit(); return; }
      state.selected.clear();
      renderCalendar();
      renderActionBar();
    });

    $('#main').addEventListener('click', (ev) => {
      const t = ev.target.closest('button');
      if (!t) return;
      if (t.dataset.edit) startEdit(t.dataset.edit);
      else if (t.dataset.delete) removeEntry(t.dataset.delete, t);
      else if (t.dataset.final) setFinal(t.dataset.final, t);
      else if ('reopen' in t.dataset) setFinal(null, t);
      else if ('cancelEdit' in t.dataset) cancelEdit();
      else if ('toggleStats' in t.dataset) { state.showAllStats = !state.showAllStats; renderStats(); }
      else if (t.dataset.goto) setTab(t.dataset.goto);
    });

    $('#entriesSearch').addEventListener('input', (ev) => { state.search = ev.target.value; renderEntries(); });
    $('#refreshBtn').addEventListener('click', () => refresh(false));
    $('#logoutBtn').addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Wylogować?', text: 'Aby wrócić, trzeba będzie ponownie wpisać hasło.', ok: 'Wyloguj' })) logout();
    });
    $('#adminLoginBtn').addEventListener('click', () => {
      $('#adminPassword').value = '';
      $('#adminError').textContent = '';
      $('#adminDialog').showModal();
      $('#adminPassword').focus();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - state.lastSync > 30_000) refresh(true);
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh(true);
    }, 90_000);
  }

  async function boot() {
    bind();
    const saved = store.get(AUTH_KEY, true) || store.get(AUTH_KEY);
    if (!saved?.password) { showScreen('login'); $('#loginPassword').focus(); return; }
    state.password = saved.password;
    state.role = saved.role;
    try {
      const res = await api('list');
      showScreen('app');
      setTab('calendar');
      applyData(res);
    } catch (err) {
      if (err.code === 'AUTH') { logout(); return; }
      showScreen('app');
      render();
      toast(err.message, true);
    }
  }

  boot();
})();
