// logic.js — правила и подсчёты. Здесь НЕТ работы с экраном и базой:
// только функции "данные на входе -> результат на выходе".
// Поэтому их легко проверять тестами (см. tests.js).

import { BASE_CURRENCY, CURRENCIES, SECTIONS, SCHEMA_VERSION } from './defaults.js';

// ---------- Вспомогательные ----------

// Сегодняшняя дата ГГГГ-ММ-ДД по местному времени (не по UTC).
export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Превращает ввод в число. Понимает запятую ("45,5"), как на телефонах.
// Всё некорректное (пусто, буквы, минус) даёт NaN.
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const s = value.replace(/\s/g, '').replace(',', '.'); // пробелы-разряды (в т.ч. неразрывные) убираем
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

// Проверяет, что строка — реальная дата (отсекает 2026-02-30).
export function isRealDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Через сколько дней курс считаем возможно устаревшим (для предупреждения в форме)
export const STALE_RATE_DAYS = 30;

// Сумма в базовой валюте. rate = сколько базовой валюты за 1 единицу валюты траты.
export const convertToBase = (amount, rate) => round2(amount * rate);

// Сколько дней прошло с даты ГГГГ-ММ-ДД (now можно подставить в тестах)
export function daysSince(isoDate, now = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((todayStart - then) / 86400000);
}

// ---------- Валидация ----------

// input         — то, что ввёл пользователь (поля могут быть строками)
// category      — выбранная категория ({ id, kind: 'fuel' | 'regular', ... })
// sectionRecords — уже сохранённые записи этого раздела (для проверки пробега)
//
// Возвращает:
//   { ok: false, errors: { поле: 'текст ошибки' } }
//   { ok: true,  errors: {}, record: <чистая запись, готовая к сохранению> }
export function validateRecord(input, category, sectionRecords = []) {
  const errors = {};

  if (!category) errors.category = 'Выберите категорию';

  // Дата
  if (!input.date) errors.date = 'Укажите дату';
  else if (!isRealDate(input.date)) errors.date = 'Неверная дата';
  else if (input.date > today()) errors.date = 'Дата не может быть в будущем';

  // Пробег
  const mileage = parseNumber(input.mileage);
  if (Number.isNaN(mileage)) {
    errors.mileage = 'Введите пробег числом';
  } else if (!Number.isInteger(mileage)) {
    errors.mileage = 'Пробег — целое число';
  } else if (!errors.date) {
    // Сравниваем с соседними записями по дате (саму редактируемую запись пропускаем).
    const others = sectionRecords.filter((r) => r.id !== input.id);
    const before = others.filter((r) => r.date <= input.date).map((r) => r.mileage);
    const after = others.filter((r) => r.date > input.date).map((r) => r.mileage);
    const maxBefore = before.reduce((a, b) => Math.max(a, b), -Infinity);
    const minAfter = after.reduce((a, b) => Math.min(a, b), Infinity);

    if (mileage < maxBefore) {
      errors.mileage = `Пробег не может быть меньше ${maxBefore} км (запись на эту дату или раньше)`;
    } else if (mileage > minAfter) {
      errors.mileage = `Пробег не может быть больше ${minAfter} км (есть более поздняя запись)`;
    }
  }

  // Сумма
  const amount = parseNumber(input.amount);
  if (Number.isNaN(amount)) errors.amount = 'Введите сумму числом';
  else if (amount <= 0) errors.amount = 'Сумма должна быть больше 0';

  // Валюта и курс. Для базовой валюты курс всегда 1, для остальных его вводит пользователь.
  const currency = input.currency ?? BASE_CURRENCY;
  let rate = 1;
  if (currency !== BASE_CURRENCY) {
    rate = parseNumber(input.rate);
    if (Number.isNaN(rate)) errors.rate = 'Введите курс числом';
    else if (rate <= 0) errors.rate = 'Курс должен быть больше 0';
  }

  // Литры — только для топлива
  const isFuel = category?.kind === 'fuel';
  let liters = null;
  if (isFuel) {
    liters = parseNumber(input.liters);
    if (Number.isNaN(liters)) errors.liters = 'Введите литры числом';
    else if (liters <= 0) errors.liters = 'Литры должны быть больше 0';
  }

  // Комментарий — только для остальных категорий
  const comment = isFuel ? '' : String(input.comment ?? '').trim();
  if (comment.length > 200) errors.comment = 'Комментарий не длиннее 200 символов';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const record = {
    section: input.section,
    date: input.date,
    category_id: category.id,
    mileage,
    amount: round2(amount),                    // сумма как заплачено, в своей валюте
    currency,
    rate: round6(rate),                        // сколько базовой валюты за 1 единицу этой
    amount_base: convertToBase(amount, rate),  // сумма в базовой валюте по этому курсу
    liters: isFuel ? round2(liters) : null,
    comment,
  };
  if (input.id !== undefined) record.id = input.id; // режим редактирования
  return { ok: true, errors: {}, record };
}

// ---------- Пробег ----------

// Общий пробег = максимум минус минимум по всем записям раздела.
// Первая запись — точка отсчёта, поэтому с одной записью пробег 0.
export function getTotalMileage(records) {
  if (records.length < 2) return 0;
  const values = records.map((r) => r.mileage);
  return values.reduce((a, b) => Math.max(a, b)) - values.reduce((a, b) => Math.min(a, b));
}

// Последний (максимальный) пробег — пригодится для подсказки в форме.
// Если записей нет, вернёт null.
export function getLastMileage(records) {
  if (records.length === 0) return null;
  return records.reduce((max, r) => Math.max(max, r.mileage), 0);
}

// Для категории "Топливо": пробег прошлой заправки и сколько км проехали с неё.
// input   — { date, mileage } из формы (mileage может быть пустым)
// Возвращает { previous, delta } или null (не топливо / заправок ещё не было).
// delta = null, пока пробег не введён или введён некорректно.
export function getFuelMileageInfo(input, category, records) {
  if (category?.kind !== 'fuel') return null;

  const previous = records
    .filter((r) => r.id !== input.id && r.category_id === category.id && (!input.date || r.date <= input.date))
    .reduce((max, r) => Math.max(max, r.mileage), -Infinity);
  if (previous === -Infinity) return null;

  const mileage = parseNumber(input.mileage);
  return { previous, delta: Number.isNaN(mileage) ? null : mileage - previous };
}

// ---------- Курсы ----------

// Последний курс валюты: берём запись с самой поздней датой (при равенстве — более новую).
// Ищем по всем разделам. Возвращает { rate, date } или null, если курса ещё не было.
export function getLastRate(currency, records) {
  const found = records.filter((r) => r.currency === currency && r.rate > 0);
  if (found.length === 0) return null;
  const last = found.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.id > a.id) ? b : a));
  return { rate: last.rate, date: last.date };
}

// ---------- Категории ----------

// Категории для выбора в форме: скрытые (archived) не показываем,
// кроме той, что нужна при редактировании старой записи (keepId).
export function getVisibleCategories(categories, keepId = null) {
  return categories.filter((c) => !c.archived || c.id === keepId);
}

// input      — { id?, section, name, kind } из формы настроек
// categories — все категории раздела (для проверки на повтор названия)
// hasRecords — есть ли записи у редактируемой категории
// Возвращает { ok, errors } или { ok: true, category }.
export function validateCategory(input, categories, hasRecords = false) {
  const errors = {};
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const existing = categories.find((c) => c.id === input.id);

  if (!name) {
    errors.name = 'Введите название';
  } else if (name.length > 40) {
    errors.name = 'Не длиннее 40 символов';
  } else if (categories.some((c) => c.id !== input.id && c.section === input.section
      && c.name.toLowerCase() === name.toLowerCase())) {
    errors.name = 'Такая категория уже есть';
  }

  if (!['fuel', 'regular'].includes(input.kind)) {
    errors.kind = 'Выберите тип';
  } else if (existing && hasRecords && existing.kind !== input.kind) {
    // Иначе старые записи (с литрами или с комментарием) перестанут подходить категории
    errors.kind = 'Тип нельзя изменить: у категории уже есть записи';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const category = {
    section: input.section,
    name,
    kind: input.kind,
    archived: existing?.archived ?? false,
  };
  if (input.id !== undefined) category.id = input.id;
  return { ok: true, errors: {}, category };
}

// ---------- Форматирование ввода ----------

// Делит целую часть на разряды при вводе: "1234567,5" -> "1 234 567,5" (пробел неразрывный).
// Лишние символы убирает. decimals — сколько знаков после запятой разрешено (0 — только целые).
export function formatNumberInput(raw, { decimals = 0 } = {}) {
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (decimals === 0) s = s.replace(/[.,]/g, '');
  s = s.replace(/\./g, ',');

  const commaIndex = s.indexOf(',');
  let intPart = commaIndex === -1 ? s : s.slice(0, commaIndex);
  const frac = commaIndex === -1 ? null : s.slice(commaIndex + 1).replace(/,/g, '').slice(0, decimals);

  intPart = intPart.replace(/^0+(?=\d)/, ''); // "007" -> "7"
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return frac === null ? grouped : `${grouped || '0'},${frac}`;
}

// Последний пробег отдельно по группам: { fuel: true } — только записи по топливу,
// { fuel: false } — все остальные категории. Если записей в группе нет, вернёт null.
export function getLastMileageForGroup(records, categories, { fuel }) {
  const kindById = Object.fromEntries(categories.map((c) => [c.id, c.kind]));
  const inGroup = records.filter((r) => (kindById[r.category_id] === 'fuel') === fuel);
  return getLastMileage(inGroup);
}

// ---------- Резервная копия (JSON) ----------

export function buildBackup(categories, records, now = new Date()) {
  return {
    app: 'finance-app',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    categories,
    records,
  };
}

// Проверяет прочитанный из файла JSON до того, как он тронет данные приложения.
// options.requiredSection — раздел, категории которого обязательно должны быть в копии.
// Возвращает { ok, errors: [текст], summary: { records, categories } }.
export function validateBackup(data, { requiredSection = null } = {}) {
  if (!data || typeof data !== 'object' || data.app !== 'finance-app') {
    return { ok: false, errors: ['Это не файл резервной копии этого приложения'] };
  }
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    return { ok: false, errors: ['В файле не указана версия формата'] };
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`Копия создана в более новой версии приложения (формат ${data.schemaVersion}). Обновите приложение.`] };
  }
  // Когда формат изменится (schemaVersion < SCHEMA_VERSION), здесь будет преобразование старой копии.
  if (!Array.isArray(data.categories) || !Array.isArray(data.records)) {
    return { ok: false, errors: ['В файле нет списков категорий и записей'] };
  }

  const errors = [];
  const problems = [];

  const categoryIds = new Set();
  data.categories.forEach((c, i) => {
    const ok = Boolean(c)
      && Number.isInteger(c.id) && !categoryIds.has(c.id)
      && typeof c.section === 'string' && c.section !== ''
      && typeof c.name === 'string' && c.name.trim() !== ''
      && ['fuel', 'regular'].includes(c.kind);
    if (ok) categoryIds.add(c.id);
    else problems.push(`категория №${i + 1}`);
  });

  const recordIds = new Set();
  data.records.forEach((r, i) => {
    const ok = Boolean(r)
      && Number.isInteger(r.id) && !recordIds.has(r.id)
      && typeof r.section === 'string' && r.section !== ''
      && typeof r.date === 'string' && isRealDate(r.date)
      && categoryIds.has(r.category_id)
      && Number.isFinite(r.mileage) && r.mileage >= 0
      && Number.isFinite(r.amount) && r.amount > 0;
    if (ok) recordIds.add(r.id);
    else problems.push(`запись №${i + 1}`);
  });

  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join(', ');
    const rest = problems.length > 5 ? ` и ещё ${problems.length - 5}` : '';
    errors.push(`Некорректные данные: ${shown}${rest}`);
  }
  if (data.categories.length === 0) {
    errors.push('В копии нет категорий');
  } else if (requiredSection && !data.categories.some((c) => c && c.section === requiredSection)) {
    errors.push(`В копии нет категорий раздела «${SECTIONS[requiredSection]?.name ?? requiredSection}»`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: { records: data.records.length, categories: data.categories.length },
  };
}

// ---------- Выгрузка в CSV (для Google Таблиц и Excel) ----------
// Разделитель ";" и запятая в дробных числах: так файл открывается без правок
// в таблицах с польскими и русскими настройками.

// Ячейка CSV. Для текста дополнительно обезвреживаем формулы: значение, начинающееся
// с = + - @, таблица иначе выполнила бы как формулу.
function csvCell(value, isText = false) {
  let s = String(value ?? '');
  if (isText && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvNumber = (n) => (n == null ? '' : String(n).replace('.', ','));

export function buildCsv(records, categories) {
  const nameById = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const baseSymbol = CURRENCIES.find((c) => c.code === BASE_CURRENCY)?.symbol ?? BASE_CURRENCY;
  const header = ['Раздел', 'Дата', 'Категория', 'Пробег', 'Сумма', 'Валюта', 'Курс', `Сумма в ${baseSymbol}`, 'Литры', 'Комментарий'];

  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const rows = sorted.map((r) => [
    csvCell(SECTIONS[r.section]?.name ?? r.section, true),
    r.date, // ГГГГ-ММ-ДД: таблицы понимают этот формат при любых региональных настройках
    csvCell(nameById[r.category_id] ?? 'Без категории', true),
    csvNumber(r.mileage),
    csvNumber(r.amount),
    csvCell(r.currency ?? BASE_CURRENCY, true),
    csvNumber(r.rate ?? 1),
    csvNumber(r.amount_base ?? r.amount),
    csvNumber(r.liters),
    csvCell(r.comment, true),
  ].join(';'));

  return [header.map((h) => csvCell(h)).join(';'), ...rows].join('\r\n') + '\r\n';
}

// ---------- Напоминание о резервной копии ----------

export const REMIND_AFTER_CHANGES = 10; // напомнить после стольких изменений
export const REMIND_AFTER_DAYS = 14;    // или если копии больше стольких дней и были изменения

// Дата ГГГГ-ММ-ДД (по местному времени) из метки времени вида 2026-10-31T10:00:00.000Z
export function localDateOf(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Нужно ли напомнить про копию. Возвращает null или { reason, changes?, days? },
// где reason: 'never' (копий не было) | 'changes' (много изменений) | 'days' (давно не делали).
export function getBackupReminder({ recordCount, changes, lastBackupIso, now = new Date() }) {
  if (recordCount === 0) return null; // защищать пока нечего
  if (!lastBackupIso) return { reason: 'never' };
  if (changes >= REMIND_AFTER_CHANGES) return { reason: 'changes', changes };
  const days = daysSince(localDateOf(lastBackupIso), now);
  if (changes > 0 && days >= REMIND_AFTER_DAYS) return { reason: 'days', days, changes };
  return null;
}
