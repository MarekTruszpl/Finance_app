// trips-app.js — вкладка «Поездки»: связывает хранилище (storage), правила (trips) и экран (trips-view).
// app.js только запускает этот модуль, обновляет его после смены данных и берёт из него данные для резервной копии.
import { DEFAULT_TRAVEL_CATEGORIES, BASE_CURRENCY } from './defaults.js';
import {
  getTrips, getTripExpenses, saveTrip, deleteTrip, saveTripExpense, deleteTripExpense,
  getCategories, seedSectionCategoriesIfMissing, saveSnapshot,
} from './storage.js';
import { today, parseNumber, getVisibleCategories } from './logic.js';
import {
  validateTrip, validateTripExpense, defaultRateFor, defaultExpenseDate, summarizeTrip,
  buildTripList, sortExpenses, previewBase,
} from './trips.js';
import { moneyAuto, formatDate } from './format.js';
import { showToast, confirmAction } from './ui.js';
import * as view from './trips-view.js';

const SECTION = 'travel';
const DEFAULT_TRIP_CURRENCY = 'EUR'; // для первой поездки; дальше берётся валюта прошлой

let trips = [];
let tripExpenses = [];
let categories = [];       // категории поездок (все, включая скрытые)
let screen = 'list';       // какой из четырёх экранов показан
let currentTripId = null;  // открытая поездка
let editingTripId = null;  // id изменяемой поездки; null — новая
let editingExpenseId = null;
let hooks = { beforeChange: async () => {}, afterChange: () => {} };

const currentTrip = () => trips.find((t) => t.id === currentTripId) ?? null;
const ownExpenses = (tripId) => tripExpenses.filter((e) => e.trip_id === tripId);
const categoryName = (id) => categories.find((c) => c.id === id)?.name ?? 'Без категории';

// ---------- Данные для резервной копии и напоминаний ----------
export const getTripsData = () => ({ trips, tripExpenses });
export const getTripExpenseCount = () => tripExpenses.length;

// ---------- Показ ----------

function render() {
  const trip = currentTrip();
  if (!trip && screen !== 'list' && !(screen === 'tripForm' && editingTripId === null)) screen = 'list'; // поездку удалили (например, восстановили копию)
  view.renderTripList(buildTripList(trips, tripExpenses), { onOpen: openTrip });
  if (trip) {
    const own = ownExpenses(trip.id);
    view.renderTrip(
      { trip, summary: summarizeTrip(trip, own, categories), expenses: sortExpenses(own), categoryName },
      { onSelectExpense: openExpenseForEdit },
    );
  }
  view.showScreen(screen, { scrollTop: false });
}

function go(name) {
  screen = name;
  render();
  view.showScreen(name); // с прокруткой наверх
}

// Загрузить всё из базы и перерисовать. Вызывается при запуске и после замены данных (восстановление, импорт)
export async function refreshTrips() {
  await seedSectionCategoriesIfMissing(SECTION, DEFAULT_TRAVEL_CATEGORIES);
  [trips, tripExpenses, categories] = await Promise.all([getTrips(), getTripExpenses(), getCategories(SECTION)]);
  render();
}

async function reloadAndRender() {
  [trips, tripExpenses] = await Promise.all([getTrips(), getTripExpenses()]);
  render();
}

// ---------- Поездки ----------

function openTrip(id) {
  currentTripId = id;
  go('trip');
}

// Курс для формы поездки: последний известный курс валюты по расходам, иначе пусто
function suggestTripRate(currency) {
  const found = defaultRateFor(currency, null, tripExpenses);
  if (currency === BASE_CURRENCY) {
    view.setTripRateHint('');
    return null;
  }
  view.setTripRateHint(found ? `Последний курс: ${String(found.rate).replace('.', ',')} (${formatDate(found.date)})` : 'Введите курс самостоятельно');
  return found ? found.rate : null;
}

function newTrip() {
  editingTripId = null;
  const last = buildTripList(trips, tripExpenses)[0]?.trip;
  const currency = last?.currency ?? DEFAULT_TRIP_CURRENCY;
  view.fillTripForm({ name: '', date_from: today(), date_to: today(), currency, rate: '' }, { isEdit: false });
  const rate = suggestTripRate(currency);
  if (rate !== null) view.setTripRate(rate);
  go('tripForm');
}

function editTrip() {
  const trip = currentTrip();
  if (!trip) return;
  editingTripId = trip.id;
  view.fillTripForm(trip, { isEdit: true, expenseCount: ownExpenses(trip.id).length });
  view.setTripRateHint('');
  go('tripForm');
}

// Сменилась валюта: прежний курс относился к другой валюте, поэтому подставляем курс новой (или очищаем)
function handleTripCurrencyChange() {
  view.updateTripRateField();
  const currency = view.readTripForm().currency;
  const rate = suggestTripRate(currency);
  view.setTripRate(rate ?? '');
}

async function handleTripSubmit() {
  const form = view.readTripForm();
  const input = editingTripId !== null ? { ...form, id: editingTripId } : form;
  const result = validateTrip(input);
  if (!result.ok) {
    view.showTripErrors(result.errors);
    return;
  }
  view.showTripErrors({});
  try {
    await hooks.beforeChange();
    const id = await saveTrip(result.trip);
    hooks.afterChange();
    const isEdit = editingTripId !== null;
    currentTripId = id;
    editingTripId = null;
    await reloadAndRender();
    go('trip');
    showToast(isEdit ? 'Изменения сохранены' : 'Поездка создана');
  } catch (err) {
    console.error(err);
    showToast('Не удалось сохранить. Подробности в консоли.');
  }
}

function handleTripCancel() {
  const wasEdit = editingTripId !== null;
  editingTripId = null;
  go(wasEdit ? 'trip' : 'list');
}

async function handleTripDelete() {
  const trip = trips.find((t) => t.id === editingTripId);
  if (!trip) return;
  const n = ownExpenses(trip.id).length;
  const question = `Удалить поездку «${trip.name}»${n > 0 ? ` и все её расходы (${n})` : ''}? Это действие нельзя отменить.`;
  if (!confirmAction(question)) return;
  try {
    await saveSnapshot('Перед удалением поездки', 'safety'); // удаляется много данных сразу: страхуемся автокопией
    await deleteTrip(trip.id);
    hooks.afterChange();
    editingTripId = null;
    currentTripId = null;
    await reloadAndRender();
    go('list');
    showToast('Поездка удалена');
  } catch (err) {
    console.error(err);
    showToast('Не удалось удалить. Подробности в консоли.');
  }
}

// ---------- Расходы ----------

// Строка курса и предпросмотр «= 194,40 zł». forceDefault: подставить курс по умолчанию (сменилась валюта или открыт новый расход)
function refreshExpenseRate({ forceDefault = false } = {}) {
  const trip = currentTrip();
  const form = view.readExpenseForm();
  const foreign = form.currency !== BASE_CURRENCY;
  view.setExpenseRateVisible(foreign, form.currency);
  if (!foreign) {
    view.setExpensePreview('');
    view.setExpenseRateHint('');
    return;
  }
  const found = defaultRateFor(form.currency, trip, tripExpenses);
  if (forceDefault) view.setExpenseRate(found ? found.rate : null);

  const typed = parseNumber(forceDefault ? (found ? found.rate : '') : form.rate);
  if (!found) view.setExpenseRateHint('Введите курс самостоятельно');
  else if (typed === found.rate) {
    view.setExpenseRateHint(found.source === 'trip' ? 'Курс поездки' : `Последний курс: ${formatDate(found.date)}`);
  } else view.setExpenseRateHint(`Курс изменён вручную (в поездке ${String(found.rate).replace('.', ',')})`);

  const base = previewBase(form.amount, forceDefault ? (found ? String(found.rate) : '') : form.rate, form.currency);
  view.setExpensePreview(base === null ? '' : `= ${moneyAuto(base)}`);
}

function newExpense() {
  const trip = currentTrip();
  if (!trip) return;
  editingExpenseId = null;
  const visible = getVisibleCategories(categories);
  const lastUsed = sortExpenses(ownExpenses(trip.id))[0]?.category_id; // категория прошлого расхода: удобно вносить подряд
  view.fillExpenseCategories(visible, lastUsed);
  view.fillExpenseForm(
    { date: defaultExpenseDate(trip), categoryId: lastUsed ?? null, amount: '', currency: trip.currency, rate: '', comment: '' },
    { isEdit: false, tripName: trip.name },
  );
  refreshExpenseRate({ forceDefault: true });
  go('expenseForm');
  view.focusExpenseAmount();
}

function openExpenseForEdit(expense) {
  const trip = currentTrip();
  if (!trip) return;
  editingExpenseId = expense.id;
  view.fillExpenseCategories(getVisibleCategories(categories, expense.category_id), expense.category_id);
  view.fillExpenseForm(
    { date: expense.date, categoryId: expense.category_id, amount: expense.amount, currency: expense.currency, rate: expense.rate, comment: expense.comment },
    { isEdit: true, tripName: trip.name },
  );
  refreshExpenseRate(); // курс остаётся тем, что записан в расходе
  go('expenseForm');
}

async function handleExpenseSubmit() {
  const trip = currentTrip();
  const form = view.readExpenseForm();
  const category = categories.find((c) => c.id === form.categoryId);
  const input = editingExpenseId !== null ? { ...form, id: editingExpenseId } : form;
  const result = validateTripExpense(input, category, trip);
  if (!result.ok) {
    view.showExpenseErrors(result.errors);
    return;
  }
  view.showExpenseErrors({});
  try {
    await hooks.beforeChange();
    await saveTripExpense(result.expense);
    hooks.afterChange();
    const isEdit = editingExpenseId !== null;
    editingExpenseId = null;
    await reloadAndRender();
    go('trip');
    showToast(isEdit ? 'Изменения сохранены' : 'Расход добавлен');
  } catch (err) {
    console.error(err);
    showToast('Не удалось сохранить. Подробности в консоли.');
  }
}

function handleExpenseCancel() {
  editingExpenseId = null;
  go('trip');
}

async function handleExpenseDelete() {
  const expense = tripExpenses.find((e) => e.id === editingExpenseId);
  if (!expense) return;
  if (!confirmAction(`Удалить расход ${moneyAuto(expense.amount, expense.currency)} от ${formatDate(expense.date)}? Это действие нельзя отменить.`)) return;
  try {
    await hooks.beforeChange();
    await deleteTripExpense(expense.id);
    hooks.afterChange();
    editingExpenseId = null;
    await reloadAndRender();
    go('trip');
    showToast('Расход удалён');
  } catch (err) {
    console.error(err);
    showToast('Не удалось удалить. Подробности в консоли.');
  }
}

// ---------- Запуск ----------
// beforeChange — автокопия перед изменением данных; afterChange — отметить изменение для напоминания о копии
export async function initTrips({ beforeChange, afterChange }) {
  hooks = { beforeChange, afterChange };
  view.fillCurrencySelects();
  view.bindTripsView({
    onNewTrip: newTrip,
    onBack: () => go('list'),
    onEditTrip: editTrip,
    onNewExpense: newExpense,
    onTripSubmit: handleTripSubmit,
    onTripCancel: handleTripCancel,
    onTripDelete: handleTripDelete,
    onTripCurrencyChange: handleTripCurrencyChange,
    onExpenseSubmit: handleExpenseSubmit,
    onExpenseCancel: handleExpenseCancel,
    onExpenseDelete: handleExpenseDelete,
    onExpenseCurrencyChange: () => refreshExpenseRate({ forceDefault: true }),
    onExpenseInput: () => refreshExpenseRate(),
  });
  await refreshTrips();
}
