// importer.js — разбор CSV (например, выгрузки из Google Таблицы) и подготовка записей к импорту.
// Здесь нет работы с экраном и базой: на входе текст файла, на выходе список готовых записей и ошибок.
import { validateRecord, isRealDate } from './logic.js';

// Названия колонок, которые мы узнаём (без учёта регистра). Можно дополнять.
const HEADER_ALIASES = {
  date: ['data', 'date', 'дата'],
  amount: ['koszt', 'kwota', 'cena', 'cost', 'amount', 'сумма', 'стоимость'],
  mileage: ['przebieg', 'mileage', 'пробег'],
  comment: ['opis', 'komentarz', 'uwagi', 'comment', 'описание', 'комментарий'],
  category: ['kategoria', 'category', 'категория'],
};

const FIELD_LABELS = { date: 'Дата', mileage: 'Пробег', amount: 'Сумма', category: 'Категория', comment: 'Комментарий' };

// ---------- Разбор CSV ----------

// Превращает текст в таблицу (массив строк, каждая строка — массив ячеек).
// Понимает кавычки, "" внутри кавычек, переносы строк внутри ячеек и BOM в начале файла.
export function parseCsv(text, delimiter = ',') {
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- Числа и даты "как в таблице" ----------

// "200 zł" -> "200", "1 200,50 zł" -> "1200.50", "245 000" -> "245000", "245.000" -> "245000".
// Возвращает строку, которую дальше проверит validateRecord (пустую, если цифр нет).
export function normalizeNumberText(raw) {
  let s = String(raw ?? '').replace(/[\s\u00A0\u202F]/g, '').replace(/[^\d.,-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (!/\d/.test(s)) return '';

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Есть и запятая, и точка: десятичный разделитель — тот, что стоит правее
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const parts = s.split(sep);
    // "245.000" или "1,234,567" — это разряды; "200,50" или "0,500" — дробь
    const isThousands = parts.length > 2 || (parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0');
    s = isThousands ? parts.join('') : `${parts[0]}.${parts[1]}`;
  }
  if (s.startsWith('.')) s = `0${s}`;
  return (negative ? '-' : '') + s;
}

// "25.06.2025", "5.6.25", "25/06/2025", "2025-06-25" -> "2025-06-25"; не дата -> null
export function parseDateText(raw) {
  const s = String(raw ?? '').trim();
  let y;
  let m;
  let d;
  let match;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    [, y, m, d] = match;
  } else if ((match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/))) {
    [, d, m, y] = match;
    if (y.length === 2) y = `20${y}`;
  } else {
    return null;
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isRealDate(iso) ? iso : null;
}

// ---------- Поиск таблицы в файле ----------

const normalizeHeader = (cell) => String(cell ?? '').toLowerCase().replace(/[\s\u00A0]+/g, ' ').trim();
const normalizeText = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function mapHeader(row) {
  const columns = {};
  row.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(name) && columns[key] === undefined) columns[key] = index;
    }
  });
  return columns;
}

// Ищем строку заголовков (над ней могут быть любые строки, например итоговая сумма)
// и заодно сами определяем разделитель: запятая, точка с запятой или табуляция.
function findTable(text) {
  for (const delimiter of [',', ';', '\t']) {
    const rows = parseCsv(text, delimiter);
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
      const columns = mapHeader(rows[i]);
      if (columns.date !== undefined && columns.amount !== undefined && columns.mileage !== undefined) {
        return { rows, headerIndex: i, columns };
      }
    }
  }
  return null;
}

// Если у колонки с описаниями нет подписи (как в вашей таблице), берём ту из неопознанных колонок,
// в которой больше всего заполненных ячеек.
function pickCommentColumn(rows, headerIndex, columns) {
  if (columns.comment !== undefined) return columns.comment;
  const taken = new Set(Object.values(columns));
  const counts = new Map();
  for (let i = headerIndex + 1; i < rows.length; i++) {
    rows[i].forEach((cell, index) => {
      if (!taken.has(index) && String(cell).trim() !== '') counts.set(index, (counts.get(index) ?? 0) + 1);
    });
  }
  let best;
  let bestCount = 0;
  for (const [index, n] of counts) {
    if (n > bestCount) { best = index; bestCount = n; }
  }
  return best;
}

// ---------- Подготовка импорта ----------

const dupKey = (r) => `${r.date}|${r.mileage}|${r.amount}|${normalizeText(r.comment)}`;

// text               — содержимое CSV-файла
// section            — раздел, в который импортируем (например, 'car')
// categories         — все категории (для категории по умолчанию и сопоставления по названию)
// defaultCategoryId  — категория для строк, у которых своей категории нет
// existingRecords    — записи раздела, уже лежащие в приложении (для проверки пробега и дублей)
//
// Возвращает { ok: false, error } или
//   { ok: true, columns, total, ready: [записи без id], duplicates, skipped, errors: [строки текста] }
export function prepareImport(text, { section, categories, defaultCategoryId, existingRecords = [] }) {
  const table = findTable(text);
  if (!table) {
    return {
      ok: false,
      error: 'Не нашёл в файле строку заголовков. Нужны колонки «Data», «Koszt», «Przebieg» (или «Дата», «Сумма», «Пробег»).',
    };
  }
  const defaultCategory = categories.find((c) => c.id === defaultCategoryId);
  if (!defaultCategory) return { ok: false, error: 'Не выбрана категория для импорта.' };

  // Категория из файла подставляется, только если такая есть в приложении (и это не топливо: нет литров)
  const usable = categories.filter((c) => c.section === section && !c.archived && c.kind !== 'fuel');
  const byName = new Map(usable.map((c) => [normalizeText(c.name), c]));

  const { rows, headerIndex, columns } = table;
  const commentColumn = pickCommentColumn(rows, headerIndex, columns);
  const cell = (row, index) => (index === undefined ? '' : String(row[index] ?? '').trim());

  const problems = []; // { line, text }
  const candidates = [];
  let total = 0;
  let skipped = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const dateText = cell(row, columns.date);
    const mileageText = cell(row, columns.mileage);

    // Строки без даты и пробега (пустые, "Итого" и т.п.) — не записи
    if (dateText === '' && mileageText === '') {
      if (row.some((c) => String(c).trim() !== '')) skipped++;
      continue;
    }
    total++;

    const date = parseDateText(dateText);
    if (!date) {
      problems.push({ line, text: `Дата — не удалось распознать «${dateText}»` });
      continue;
    }
    candidates.push({
      line,
      date,
      category: byName.get(normalizeText(cell(row, columns.category))) ?? defaultCategory,
      mileage: normalizeNumberText(mileageText),
      amount: normalizeNumberText(cell(row, columns.amount)),
      comment: cell(row, commentColumn).slice(0, 200),
    });
  }

  // Проверяем по порядку дат: пробег каждой записи сверяется с уже принятыми
  candidates.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
  const accepted = existingRecords.map((r) => ({ ...r }));
  const seen = new Set(existingRecords.map(dupKey));
  const ready = [];
  let duplicates = 0;

  for (const c of candidates) {
    const result = validateRecord(
      { section, date: c.date, mileage: c.mileage, amount: c.amount, comment: c.comment },
      c.category,
      accepted,
    );
    if (!result.ok) {
      const text = Object.entries(result.errors).map(([f, m]) => `${FIELD_LABELS[f] ?? f} — ${m}`).join('; ');
      problems.push({ line: c.line, text });
      continue;
    }
    const key = dupKey(result.record);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    ready.push(result.record);
    accepted.push({ ...result.record, id: -ready.length }); // временный id, чтобы запись не отфильтровалась при проверке
  }

  problems.sort((a, b) => a.line - b.line);
  return {
    ok: true,
    columns: { ...columns, comment: commentColumn },
    total,
    ready,
    duplicates,
    skipped,
    errors: problems.map((p) => `Строка ${p.line}: ${p.text}`),
  };
}

// Буква колонки, как в таблице: 0 -> A, 27 -> AB
function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Текст для окна предпросмотра: какие колонки распознаны, что пропущено, какие ошибки
export function describeImport(result, maxErrors = 8) {
  const c = result.columns;
  const col = (index) => (index === undefined ? 'нет' : columnLetter(index));
  const lines = [`Распознано: дата — ${col(c.date)}, описание — ${col(c.comment)}, сумма — ${col(c.amount)}, пробег — ${col(c.mileage)}${c.category !== undefined ? `, категория — ${col(c.category)}` : ''}.`];
  if (result.skipped > 0) lines.push(`Пропущено строк без даты и пробега: ${result.skipped}.`);
  if (result.errors.length > 0) {
    lines.push('Строки с ошибками не будут импортированы:');
    lines.push(...result.errors.slice(0, maxErrors));
    if (result.errors.length > maxErrors) lines.push(`…и ещё ${result.errors.length - maxErrors}`);
  }
  return lines.join('\n');
}
