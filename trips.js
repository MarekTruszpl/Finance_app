// trips.js — правила и расчёты для поездок. Чистые функции: без экрана и без базы.
// Поездка:  { id, name, date_from, date_to, currency, rate }
//   currency и rate — основная валюта поездки и её курс по умолчанию (сколько злотых за 1 единицу).
// Расход:   { id, trip_id, date, category_id, amount, currency, rate, amount_base, comment }
//   amount — как заплачено, в своей валюте; amount_base — в злотых по курсу этого расхода.
import { BASE_CURRENCY, CURRENCIES } from './defaults.js';
import { parseNumber, isRealDate, convertToBase, getLastRate, today } from './logic.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

export const MAX_TRIP_NAME = 60;
export const MAX_COMMENT = 200;

// Курс введён верно, если число больше 0. Для базовой валюты курс всегда 1.
function readRate(currency, rawRate, errors) {
  if (currency === BASE_CURRENCY) return 1;
  const rate = parseNumber(rawRate);
  if (Number.isNaN(rate)) errors.rate = 'Введите курс числом';
  else if (rate <= 0) errors.rate = 'Курс должен быть больше 0';
  return rate;
}

// ---------- Проверка ввода ----------

// input — { id?, name, date_from, date_to, currency, rate } из формы
export function validateTrip(input) {
  const errors = {};

  const name = String(input.name ?? '').trim();
  if (name === '') errors.name = 'Введите название';
  else if (name.length > MAX_TRIP_NAME) errors.name = `Название не длиннее ${MAX_TRIP_NAME} символов`;

  if (!input.date_from) errors.date_from = 'Укажите дату начала';
  else if (!isRealDate(input.date_from)) errors.date_from = 'Неверная дата';

  if (!input.date_to) errors.date_to = 'Укажите дату окончания';
  else if (!isRealDate(input.date_to)) errors.date_to = 'Неверная дата';
  else if (!errors.date_from && input.date_to < input.date_from) errors.date_to = 'Окончание раньше начала';

  const currency = input.currency ?? BASE_CURRENCY;
  if (!CURRENCIES.some((c) => c.code === currency)) errors.currency = 'Выберите валюту';
  const rate = errors.currency ? 1 : readRate(currency, input.rate, errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const trip = { name, date_from: input.date_from, date_to: input.date_to, currency, rate: round6(rate) };
  if (input.id !== undefined) trip.id = input.id; // режим изменения
  return { ok: true, errors: {}, trip };
}

// input — { id?, date, amount, currency, rate, comment } из формы; category — выбранная категория; trip — поездка
export function validateTripExpense(input, category, trip) {
  const errors = {};

  if (!trip) errors.trip = 'Не выбрана поездка';
  if (!category) errors.category = 'Выберите категорию';

  if (!input.date) errors.date = 'Укажите дату';
  else if (!isRealDate(input.date)) errors.date = 'Неверная дата';
  else if (input.date > today()) errors.date = 'Дата не может быть в будущем';

  const amount = parseNumber(input.amount);
  if (Number.isNaN(amount)) errors.amount = 'Введите сумму числом';
  else if (amount <= 0) errors.amount = 'Сумма должна быть больше 0';

  const currency = input.currency ?? BASE_CURRENCY;
  if (!CURRENCIES.some((c) => c.code === currency)) errors.currency = 'Выберите валюту';
  const rate = errors.currency ? 1 : readRate(currency, input.rate, errors);

  const comment = String(input.comment ?? '').trim();
  if (comment.length > MAX_COMMENT) errors.comment = `Комментарий не длиннее ${MAX_COMMENT} символов`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const expense = {
    trip_id: trip.id,
    date: input.date,
    category_id: category.id,
    amount: round2(amount),
    currency,
    rate: round6(rate),
    amount_base: convertToBase(amount, rate),
    comment,
  };
  if (input.id !== undefined) expense.id = input.id;
  return { ok: true, errors: {}, expense };
}

// ---------- Курс по умолчанию для формы расхода ----------

// Откуда взять курс, когда выбрана валюта:
//   злотые -> 1; основная валюта поездки -> курс поездки; иначе последний курс этой валюты в любых поездках.
// Возвращает { rate, source: 'base' | 'trip' | 'last', date? } или null, если курса ещё не было.
export function defaultRateFor(currency, trip, tripExpenses) {
  if (currency === BASE_CURRENCY) return { rate: 1, source: 'base' };
  if (trip && trip.currency === currency && trip.rate > 0) return { rate: trip.rate, source: 'trip' };
  const last = getLastRate(currency, tripExpenses);
  return last ? { rate: last.rate, source: 'last', date: last.date } : null;
}

// Дата в форме нового расхода: сегодня, если поездка идёт; после поездки — последний её день
// (чеки обычно разбирают потом); до поездки (предоплата) — сегодня.
export function defaultExpenseDate(trip, todayIso = today()) {
  if (todayIso > trip.date_to) return trip.date_to;
  return todayIso;
}

// ---------- Итоги ----------

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

// Сколько дней в поездке, оба конца включительно
export const tripDays = (trip) => dayNumber(trip.date_to) - dayNumber(trip.date_from) + 1;

// Итоги одной поездки. expenses — расходы только этой поездки; categories — категории раздела поездок.
// Возвращает { total, count, days, perDay, byCategory: [{ categoryId, name, total, share }] } (категории от большей суммы к меньшей).
export function summarizeTrip(trip, expenses, categories) {
  const total = round2(expenses.reduce((sum, e) => sum + e.amount_base, 0));
  const sums = new Map();
  for (const e of expenses) sums.set(e.category_id, (sums.get(e.category_id) ?? 0) + e.amount_base);

  const byCategory = [...sums.entries()]
    .map(([categoryId, sum]) => ({
      categoryId,
      name: categories.find((c) => c.id === categoryId)?.name ?? 'Без категории',
      total: round2(sum),
      share: total > 0 ? sum / total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const days = tripDays(trip);
  return { total, count: expenses.length, days, perDay: days > 0 ? round2(total / days) : 0, byCategory };
}

// Список для экрана «Поездки»: новые (по дате начала) сверху, у каждой сумма в злотых и число расходов
export function buildTripList(trips, tripExpenses) {
  return [...trips]
    .sort((a, b) => b.date_from.localeCompare(a.date_from) || b.id - a.id)
    .map((trip) => {
      const own = tripExpenses.filter((e) => e.trip_id === trip.id);
      return { trip, total: round2(own.reduce((sum, e) => sum + e.amount_base, 0)), count: own.length };
    });
}

// Расходы поездки: новые сверху
export function sortExpenses(expenses) {
  return [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

// ---------- Показ дат ----------

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// '2026-10-12','2026-10-18' -> '12–18 окт 2026'; '2026-10-28','2026-11-03' -> '28 окт – 3 ноя 2026';
// через границу года -> '28 дек 2026 – 3 янв 2027'; один день -> '12 окт 2026'
export function formatTripDates(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  if (from === to) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 !== y2) return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
}

// Предпросмотр под полем суммы: «= 194,40 zł». Возвращает число или null, если сумма или курс ещё не введены.
export function previewBase(rawAmount, rawRate, currency) {
  const amount = parseNumber(rawAmount);
  const rate = currency === BASE_CURRENCY ? 1 : parseNumber(rawRate);
  if (Number.isNaN(amount) || Number.isNaN(rate) || amount <= 0 || rate <= 0) return null;
  return convertToBase(amount, rate);
}
