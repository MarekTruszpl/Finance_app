// stats.js — подсчёты для вкладки "Статистика".
// Только данные на входе и результат на выходе: без экрана и без базы, поэтому всё проверяется тестами.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const parse = (isoDate) => isoDate.split('-').map(Number); // '2026-10-15' -> [2026, 10, 15]
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const round2 = (n) => Math.round(n * 100) / 100;
const amountOf = (r) => r.amount_base ?? r.amount; // сумма в базовой валюте (zł)

// ---------- Мелкие помощники ----------

// На сколько процентов cur отличается от prev. Если раньше было 0, процент не имеет смысла: null.
export function percentChange(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// Красивые деления оси: для максимума 870 даст { max: 1000, step: 250 }
export function niceScale(maxValue, tickCount = 4) {
  if (!(maxValue > 0)) return { max: tickCount, step: 1 };
  const rough = maxValue / tickCount;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const frac = rough / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  const step = nice * pow;
  return { max: step * Math.ceil(maxValue / step - 1e-9), step };
}

// Текст периода: "1–15 октября 2026"
function rangeText(from, to) {
  const [y1, m1, d1] = parse(from);
  const [y2, m2, d2] = parse(to);
  if (y1 === y2 && m1 === m2) {
    return d1 === d2 ? `${d1} ${MONTHS_GEN[m1 - 1]} ${y1}` : `${d1}–${d2} ${MONTHS_GEN[m1 - 1]} ${y1}`;
  }
  if (y1 === y2) return `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS_GEN[m1 - 1]} ${y1} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
}

// ---------- Периоды ----------

// kind: 'month' | 'year' | 'lastYear' | 'all'; todayIso — сегодняшняя дата ГГГГ-ММ-ДД.
// Для 'month' и 'year' сравнение берётся за ТОТ ЖЕ отрезок прошлого периода:
// если сегодня 15-е, то с 1 по 15 число прошлого месяца.
// Для 'month' можно указать month ('2026-09') — тогда берётся этот месяц целиком,
// а сравнение идёт с предыдущим месяцем целиком. Будущие месяцы заменяются текущим.
export function getPeriod(kind, todayIso, { firstDate = todayIso, month = null } = {}) {
  const [y, m, d] = parse(todayIso);

  if (kind === 'month') {
    let [sy, sm] = /^\d{4}-\d{2}$/.test(month ?? '') ? parse(`${month}-01`) : [y, m];
    if (sy * 12 + sm > y * 12 + m) [sy, sm] = [y, m]; // будущий месяц -> текущий
    const isCurrent = sy === y && sm === m;
    const py = sm === 1 ? sy - 1 : sy;
    const pm = sm === 1 ? 12 : sm - 1;
    // Текущий месяц сравниваем с тем же отрезком прошлого (31 марта -> 28 февраля),
    // прошедший месяц — с предыдущим целиком
    const prevTo = isCurrent ? Math.min(d, daysInMonth(py, pm)) : daysInMonth(py, pm);
    return {
      kind, grouping: 'day',
      from: iso(sy, sm, 1),
      to: isCurrent ? todayIso : iso(sy, sm, daysInMonth(sy, sm)),
      title: `${MONTHS[sm - 1]} ${sy}`,
      compare: { from: iso(py, pm, 1), to: iso(py, pm, prevTo), title: `${MONTHS[pm - 1]} ${py}` },
    };
  }
  if (kind === 'year') {
    const prevTo = Math.min(d, daysInMonth(y - 1, m)); // 29 февраля -> 28 февраля
    return {
      kind, grouping: 'month', from: iso(y, 1, 1), to: todayIso, title: `${y}`,
      compare: { from: iso(y - 1, 1, 1), to: iso(y - 1, m, prevTo), title: `${y - 1}` },
    };
  }
  if (kind === 'lastYear') {
    return { kind, grouping: 'month', from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), title: `${y - 1}`, compare: null };
  }
  // Всё время: по месяцам, а если данных больше двух лет — по годам
  const [fy, fm] = parse(firstDate);
  const months = (y - fy) * 12 + (m - fm) + 1;
  return { kind: 'all', grouping: months <= 24 ? 'month' : 'year', from: firstDate, to: todayIso, title: 'Всё время', compare: null };
}

// Разбивает период на месяцы или годы (для столбиков и списка)
export function groupRanges(grouping, from, to) {
  const [y1, m1] = parse(from);
  const [y2, m2] = parse(to);
  const out = [];

  if (grouping === 'year') {
    for (let y = y1; y <= y2; y++) {
      out.push({ key: `${y}`, label: `${y}`, title: `${y}`, from: y === y1 ? from : iso(y, 1, 1), to: y === y2 ? to : iso(y, 12, 31) });
    }
    return out;
  }

  const multiYear = y1 !== y2;
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    const start = iso(y, m, 1);
    const end = iso(y, m, daysInMonth(y, m));
    out.push({
      key: `${y}-${pad2(m)}`,
      label: multiYear ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : MONTHS_SHORT[m - 1],
      title: `${MONTHS[m - 1]} ${y}`,
      from: start < from ? from : start,
      to: end > to ? to : end,
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ---------- Показатели ----------

// Пробег за период = последний пробег в периоде минус последний пробег ДО начала периода.
// Если записей до периода нет, отсчёт идёт от первой записи внутри периода.
export function getMileageDriven(records, from, to) {
  let before = -Infinity;
  let inMin = Infinity;
  let inMax = -Infinity;
  for (const r of records) {
    if (r.date < from) before = Math.max(before, r.mileage);
    else if (r.date <= to) {
      inMin = Math.min(inMin, r.mileage);
      inMax = Math.max(inMax, r.mileage);
    }
  }
  if (inMax === -Infinity) return 0;
  const start = before === -Infinity ? inMin : before;
  return Math.max(0, inMax - start);
}

// Расходы и пробег за период: топливо, всё остальное, итого и стоимость 1000 км БЕЗ топлива
// (расходы на сервис и прочее ÷ пробег × 1000).
// kindById — { id категории: 'fuel' | 'regular' }
export function summarize(records, kindById, { from, to }) {
  let fuel = 0;
  let other = 0;
  let count = 0;
  for (const r of records) {
    if (r.date < from || r.date > to) continue;
    count++;
    if (kindById[r.category_id] === 'fuel') fuel += amountOf(r);
    else other += amountOf(r);
  }
  fuel = round2(fuel);
  other = round2(other);
  const total = round2(fuel + other);
  const mileage = getMileageDriven(records, from, to);
  return { fuel, other, total, mileage, costPer1000: mileage > 0 ? (other / mileage) * 1000 : null, count };
}

// Расходы нарастающим итогом по дням месяца: [день 1, день 1+2, ...] до lastDay включительно
export function cumulativeByDay(records, year, month, lastDay) {
  const prefix = `${year}-${pad2(month)}-`;
  const daily = new Array(lastDay).fill(0);
  for (const r of records) {
    if (!r.date.startsWith(prefix)) continue;
    const day = Number(r.date.slice(8, 10));
    if (day <= lastDay) daily[day - 1] += amountOf(r);
  }
  let sum = 0;
  return daily.map((v) => { sum = round2(sum + v); return sum; });
}

// Расходы по категориям за период, от большего к меньшему, с долей в процентах
export function byCategory(records, categories, { from, to }) {
  const info = new Map(categories.map((c) => [c.id, c]));
  const sums = new Map();
  for (const r of records) {
    if (r.date < from || r.date > to) continue;
    sums.set(r.category_id, (sums.get(r.category_id) ?? 0) + amountOf(r));
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([id, amount]) => ({
      id,
      name: info.get(id)?.name ?? 'Без категории',
      kind: info.get(id)?.kind ?? 'regular',
      amount: round2(amount),
      share: total > 0 ? (amount / total) * 100 : 0,
    }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

// ---------- Всё вместе: модель для экрана ----------

// kind       — выбранный период ('month' | 'year' | 'lastYear' | 'all')
// records    — записи раздела; categories — категории раздела; today — сегодня (ГГГГ-ММ-ДД)
export function buildStatsModel({ kind, records, categories, today, month = null }) {
  const kindById = Object.fromEntries(categories.map((c) => [c.id, c.kind]));
  const firstDate = records.reduce((min, r) => (r.date < min ? r.date : min), today);
  const period = getPeriod(kind, today, { firstDate, month });

  const current = summarize(records, kindById, period);
  const previous = period.compare ? summarize(records, kindById, period.compare) : null;

  let chart;
  let groups = [];
  if (period.grouping === 'day') {
    const [y, m] = parse(period.from);
    const d = parse(period.to)[2]; // сколько дней показываем: до сегодня или весь месяц
    const [py, pm] = parse(period.compare.from);
    chart = {
      type: 'cumulative',
      currentLabel: period.title,
      previousLabel: period.compare.title,
      current: cumulativeByDay(records, y, m, d),
      previous: cumulativeByDay(records, py, pm, daysInMonth(py, pm)),
    };
  } else {
    groups = groupRanges(period.grouping, period.from, period.to).map((g) => ({
      ...g,
      ...summarize(records, kindById, g),
    }));
    chart = {
      type: 'bars',
      labels: groups.map((g) => g.label),
      fuel: groups.map((g) => g.fuel),
      other: groups.map((g) => g.other),
      mileage: groups.map((g) => g.mileage),
    };
  }

  let text;
  if (kind === 'all' && records.length === 0) text = 'Данных пока нет';
  else if (kind === 'all') text = `Всё время: ${rangeText(period.from, period.to)}`;
  else text = rangeText(period.from, period.to);

  return {
    kind,
    grouping: period.grouping,
    title: period.title,
    rangeText: text,
    compareText: period.compare ? `Сравнение: ${rangeText(period.compare.from, period.compare.to)}` : null,
    compareTitle: period.compare ? period.compare.title : null,
    current,
    previous,
    chart,
    groups,
    categories: byCategory(records, categories, period),
    isEmpty: current.count === 0 && (!previous || previous.count === 0),
    // Стрелки выбора месяца (только для периода "месяц")
    monthNav: kind === 'month' ? monthNavigation(period.from.slice(0, 7), firstDate.slice(0, 7), today.slice(0, 7), period.title) : null,
  };
}

// Сдвиг месяца: shiftMonth('2026-01', -1) -> '2025-12'
export function shiftMonth(key, delta) {
  const [y, m] = parse(`${key}-01`);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

function monthNavigation(selected, firstMonth, currentMonth, title) {
  return {
    title,
    canPrev: selected > firstMonth, // раньше первой записи листать незачем
    canNext: selected < currentMonth,
    prevMonth: shiftMonth(selected, -1),
    nextMonth: shiftMonth(selected, 1),
  };
}

// ---------- Журнал по категориям (всё, кроме топлива) ----------

// Что можно выбрать в списке: "Все, кроме топлива" и каждая категория не по топливу.
// Скрытая категория показывается, только если у неё есть записи.
export function getHistoryOptions(categories, records) {
  const used = new Set(records.map((r) => r.category_id));
  const options = [{ value: 'all', label: 'Все, кроме топлива' }];
  for (const c of categories) {
    if (c.kind === 'fuel') continue;
    if (c.archived && !used.has(c.id)) continue;
    options.push({ value: String(c.id), label: c.archived ? `${c.name} (скрыта)` : c.name });
  }
  return options;
}

// selection — 'all' или id категории (строкой). Записи по топливу в журнал не попадают никогда.
// Порядок: от старой даты к новой.
export function buildHistory({ records, categories, selection }) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const isFuel = (r) => byId.get(r.category_id)?.kind === 'fuel';
  const all = selection == null || selection === 'all';
  const wanted = all
    ? (r) => !isFuel(r)
    : (r) => r.category_id === Number(selection) && !isFuel(r);

  const picked = records
    .filter(wanted)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  return {
    count: picked.length,
    total: round2(picked.reduce((sum, r) => sum + amountOf(r), 0)),
    showCategory: all, // в общем списке подписываем категорию у каждой записи
    items: picked.map((r) => ({
      id: r.id,
      date: r.date,
      mileage: r.mileage,
      amount: r.amount,
      currency: r.currency,
      comment: r.comment ?? '',
      categoryName: byId.get(r.category_id)?.name ?? 'Без категории',
      record: r,
    })),
  };
}
