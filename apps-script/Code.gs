/**
 * Backend kalendarza „Sówki” – Google Apps Script podpięty do arkusza Google.
 *
 * Instrukcja wdrożenia: README.md w repozytorium.
 * UWAGA: prawdziwe hasła wpisz tylko w kopii tego pliku w edytorze Apps Script –
 * nigdy nie commituj ich do publicznego repozytorium.
 */

const USER_PASSWORD = 'WPISZ_HASLO_RODZICOW';
const ADMIN_PASSWORD = 'WPISZ_HASLO_ADMINA';

const MIN_DATE = '2026-09-01';
const MAX_DATE = '2026-11-30';
const MAX_NAME_LENGTH = 60;
const SHEET_NAME = 'Wpisy';
const HEADERS = ['ID', 'Imię dziecka', 'Daty', 'Utworzono', 'Zmieniono'];
const FINAL_DATE_KEY = 'finalDate';

// ---------- Punkty wejścia ----------

function doGet() {
  return json_({ ok: true, message: 'API kalendarza działa. Otwórz stronę kalendarza, aby głosować.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Nieprawidłowe żądanie.' });
  }

  const role = roleFor_(body.password);
  if (!role) {
    Utilities.sleep(600); // spowalnia zgadywanie haseł
    return json_({ ok: false, code: 'AUTH', error: 'Nieprawidłowe hasło.' });
  }

  try {
    const handler = ACTIONS[body.action];
    if (!handler) throw fail_('Nieznana akcja.');
    handler(body, role);
    return json_(Object.assign({ ok: true, role: role }, snapshot_()));
  } catch (err) {
    if (err.userMessage) return json_({ ok: false, code: err.code, error: err.userMessage });
    console.error(err);
    return json_({ ok: false, error: 'Błąd serwera: ' + err.message });
  }
}

const ACTIONS = {
  login: function () {},
  list: function () {},

  save: function (body, role) {
    const child = cleanName_(body.child);
    const dates = cleanDates_(body.dates);
    withLock_(function () {
      if (getFinalDate_() && role !== 'admin') throw fail_('Głosowanie jest już zamknięte.', 'CLOSED');
      const sheet = sheet_();
      const now = new Date();
      if (body.id) {
        const row = findRow_(sheet, String(body.id));
        if (!row) throw fail_('Ten wpis został w międzyczasie usunięty.', 'NOT_FOUND');
        sheet.getRange(row, 2, 1, 2).setValues([[asText_(child), asText_(dates.join(', '))]]);
        sheet.getRange(row, 5).setValue(now);
      } else {
        sheet.appendRow([Utilities.getUuid(), asText_(child), asText_(dates.join(', ')), now, now]);
      }
    });
  },

  remove: function (body, role) {
    if (role !== 'admin') throw fail_('Tylko administrator może usuwać wpisy.', 'FORBIDDEN');
    withLock_(function () {
      const sheet = sheet_();
      const row = findRow_(sheet, String(body.id || ''));
      if (row) sheet.deleteRow(row);
    });
  },

  setFinal: function (body, role) {
    if (role !== 'admin') throw fail_('Tylko administrator może zamknąć głosowanie.', 'FORBIDDEN');
    const props = PropertiesService.getScriptProperties();
    if (body.finalDate) {
      props.setProperty(FINAL_DATE_KEY, cleanDates_([body.finalDate])[0]);
    } else {
      props.deleteProperty(FINAL_DATE_KEY);
    }
  },
};

// ---------- Dane ----------

function snapshot_() {
  return { entries: readEntries_(), settings: { finalDate: getFinalDate_() } };
}

function readEntries_() {
  const sheet = sheet_();
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]),
      child: String(r[1]),
      dates: parseDates_(r[2]),
      createdAt: r[3] instanceof Date ? r[3].toISOString() : String(r[3] || ''),
      updatedAt: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ''),
    });
  }
  return out;
}

function getFinalDate_() {
  return PropertiesService.getScriptProperties().getProperty(FINAL_DATE_KEY) || null;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 90);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 420);
    sheet.setColumnWidths(4, 2, 150);
  }
  return sheet;
}

function findRow_(sheet, id) {
  if (!id) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return 0;
}

// ---------- Walidacja ----------

function cleanName_(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name) throw fail_('Wpisz imię dziecka.');
  if (name.length > MAX_NAME_LENGTH) throw fail_('Imię jest za długie (maks. ' + MAX_NAME_LENGTH + ' znaków).');
  return name;
}

function cleanDates_(value) {
  if (!Array.isArray(value) || !value.length) throw fail_('Zaznacz co najmniej jeden dzień.');
  const seen = {};
  const out = [];
  value.forEach(function (d) {
    d = String(d);
    if (!isValidDate_(d) || d < MIN_DATE || d > MAX_DATE) throw fail_('Nieprawidłowa data: ' + d);
    if (!seen[d]) { seen[d] = true; out.push(d); }
  });
  if (out.length > 120) throw fail_('Za dużo dat.');
  return out.sort();
}

function isValidDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function parseDates_(cell) {
  if (cell instanceof Date) {
    return [Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd')];
  }
  return String(cell || '').split(/[,;\s]+/).filter(isValidDate_).sort();
}

// ---------- Pomocnicze ----------

function roleFor_(password) {
  if (typeof password !== 'string' || !password) return null;
  if (password === ADMIN_PASSWORD) return 'admin';
  if (password === USER_PASSWORD) return 'user';
  return null;
}

// Apostrof na początku sprawia, że Arkusze traktują wartość jako tekst
// (bez zamiany na datę ani formułę).
function asText_(s) {
  return "'" + s;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw fail_('Serwer jest zajęty – spróbuj ponownie za chwilę.');
  try {
    fn();
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function fail_(message, code) {
  const err = new Error(message);
  err.userMessage = message;
  err.code = code;
  return err;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
