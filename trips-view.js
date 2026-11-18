// trips-view.js — вкладка «Поездки»: список, одна поездка, формы поездки и расхода.
// Только показ и чтение полей: данных и правил здесь нет (они в trips.js, а сохранение — в trips-app.js).
import { money, moneyAuto, formatDate, plural } from './format.js';
import { CURRENCIES, BASE_CURRENCY } from './defaults.js';
import { formatTripDates } from './trips.js';

const $ = (id) => document.getElementById(id);

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Строка списка, на которую можно нажать (мышью, пальцем или клавишей Enter / пробел)
function pressable(li, onSelect) {
  li.setAttribute('role', 'button');
  li.tabIndex = 0;
  li.addEventListener('click', onSelect);
  li.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  });
}

const rateText = (rate) => String(rate).replace('.', ','); // 4.32 -> 4,32

// ---------- Какой из четырёх экранов виден ----------
const SCREENS = { list: 'trips-screen-list', trip: 'trips-screen-trip', tripForm: 'trip-form', expenseForm: 'expense-form' };

// name: 'list' | 'trip' | 'tripForm' | 'expenseForm'. scrollTop: при переходе открываем экран сверху
export function showScreen(name, { scrollTop = true } = {}) {
  for (const [key, id] of Object.entries(SCREENS)) $(id).hidden = key !== name;
  if (scrollTop) window.scrollTo(0, 0);
}

export function fillCurrencySelects() {
  for (const id of ['tf-currency', 'ef-currency']) {
    $(id).replaceChildren(
      ...CURRENCIES.map((c) => {
        const option = node('option', '', c.code);
        option.value = c.code;
        option.title = c.name;
        return option;
      }),
    );
    $(id).value = BASE_CURRENCY;
  }
}

// ---------- Список поездок ----------
// items — результат buildTripList: [{ trip, total, count }]
export function renderTripList(items, { onOpen }) {
  const list = $('trips-list');
  list.replaceChildren();
  if (items.length === 0) {
    list.append(node('li', 'empty', 'Поездок пока нет. Нажмите «Новая поездка».'));
    $('trips-note').textContent = '';
    return;
  }
  for (const { trip, total, count } of items) {
    const li = node('li');
    const body = node('div', 'hist-body');
    body.append(
      node('div', 'title', trip.name),
      node('div', 'sub', formatTripDates(trip.date_from, trip.date_to)),
    );
    const right = node('div', 'right');
    right.append(
      node('div', 'title', total === 0 ? '—' : moneyAuto(total)),
      node('div', 'sub', count === 0 ? 'нет расходов' : `${count} ${plural(count, ['расход', 'расхода', 'расходов'])}`),
    );
    li.append(body, right);
    pressable(li, () => onOpen(trip.id));
    list.append(li);
  }
  const grand = items.reduce((sum, item) => sum + item.total, 0);
  $('trips-note').textContent = `${items.length} ${plural(items.length, ['поездка', 'поездки', 'поездок'])} · всего ${moneyAuto(Math.round(grand * 100) / 100)}`;
}

// ---------- Экран поездки ----------
// model: { trip, summary (summarizeTrip), expenses (отсортированные), categoryName(id) }
export function renderTrip(model, { onSelectExpense }) {
  const { trip, summary, expenses, categoryName } = model;
  $('trip-title').textContent = trip.name;
  $('trip-dates').textContent = `${formatTripDates(trip.date_from, trip.date_to)} · ${summary.days} ${plural(summary.days, ['день', 'дня', 'дней'])}`;
  $('trip-total').textContent = money(summary.total, Number.isInteger(summary.total) ? 0 : 2);
  $('trip-sub').textContent = summary.count === 0
    ? 'Расходов пока нет'
    : `${summary.count} ${plural(summary.count, ['расход', 'расхода', 'расходов'])} · в среднем ${moneyAuto(summary.perDay)} в день`;

  // По категориям: полоска показывает долю в общей сумме
  $('trip-categories-block').hidden = summary.count === 0;
  const cats = $('trip-categories');
  cats.replaceChildren();
  for (const c of summary.byCategory) {
    const li = node('li');
    const left = node('div', 'stat-cat-left');
    const meter = node('div', 'meter');
    const fill = node('span', 'meter-fill meter-other');
    fill.style.width = `${Math.max(2, Math.round(c.share * 100))}%`;
    meter.append(fill);
    left.append(node('div', 'title', c.name), meter);
    const right = node('div', 'right');
    right.append(node('div', 'title', moneyAuto(c.total)), node('div', 'sub', `${Math.round(c.share * 100)}%`));
    li.append(left, right);
    cats.append(li);
  }

  // Расходы: нажатие открывает расход на изменение
  const list = $('trip-expenses');
  list.replaceChildren();
  if (expenses.length === 0) list.append(node('li', 'empty', 'Нажмите «Добавить расход».'));
  for (const e of expenses) {
    const li = node('li');
    const body = node('div', 'hist-body');
    const top = node('div', 'hist-top');
    top.append(node('span', 'title', formatDate(e.date)), node('span', 'title', moneyAuto(e.amount, e.currency)));
    const meta = [categoryName(e.category_id)];
    if (e.currency !== BASE_CURRENCY) meta.push(`= ${moneyAuto(e.amount_base)}`); // сколько это в злотых
    body.append(top, node('div', 'sub', meta.join(' · ')));
    if (e.comment) body.append(node('div', 'hist-comment', e.comment));
    li.append(body);
    pressable(li, () => onSelectExpense(e));
    list.append(li);
  }
}

// ---------- Ошибки полей ----------
// fields: { id поля: ключ ошибки }; первое неверное поле получает курсор
function showErrors(fields, errors) {
  for (const [id, key] of Object.entries(fields)) {
    const message = errors[key] ?? '';
    $('error-' + id).textContent = message;
    $(id).setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  const first = Object.keys(fields).find((id) => errors[fields[id]]);
  if (first) $(first).focus();
}

const TRIP_FIELDS = { 'tf-name': 'name', 'tf-date-from': 'date_from', 'tf-date-to': 'date_to', 'tf-currency': 'currency', 'tf-rate': 'rate' };
const EXPENSE_FIELDS = { 'ef-date': 'date', 'ef-category': 'category', 'ef-amount': 'amount', 'ef-currency': 'currency', 'ef-rate': 'rate', 'ef-comment': 'comment' };

export const showTripErrors = (errors) => showErrors(TRIP_FIELDS, errors);
export const showExpenseErrors = (errors) => showErrors(EXPENSE_FIELDS, errors);

// ---------- Форма поездки ----------
// values: { name, date_from, date_to, currency, rate }; mode: { isEdit, expenseCount }
export function fillTripForm(values, { isEdit, expenseCount = 0 }) {
  $('tf-banner').textContent = isEdit ? 'Изменение поездки' : 'Новая поездка';
  $('tf-name').value = values.name;
  $('tf-date-from').value = values.date_from;
  $('tf-date-to').value = values.date_to;
  $('tf-currency').value = values.currency;
  $('tf-rate').value = values.rate === '' || values.rate == null ? '' : rateText(values.rate);
  $('tf-delete').hidden = !isEdit;
  $('tf-footer').textContent = isEdit && expenseCount > 0
    ? 'Курс поездки подставляется в новые расходы. Уже внесённые расходы не пересчитываются.'
    : 'Курс — сколько злотых за 1 единицу валюты. Его можно поменять в каждом расходе отдельно.';
  showTripErrors({});
  updateTripRateField();
}

export const readTripForm = () => ({
  name: $('tf-name').value,
  date_from: $('tf-date-from').value,
  date_to: $('tf-date-to').value,
  currency: $('tf-currency').value,
  rate: $('tf-rate').value,
});

// Строка курса нужна, только если валюта не злотые
export function updateTripRateField() {
  const foreign = $('tf-currency').value !== BASE_CURRENCY;
  $('field-tf-rate').hidden = !foreign;
  if (foreign) $('tf-rate-label').textContent = `Курс 1 ${$('tf-currency').value}`;
}

export const setTripRateHint = (text) => { $('tf-rate-hint').textContent = text; };
export const setTripRate = (rate) => { $('tf-rate').value = rateText(rate); };
export const isTripRateEmpty = () => $('tf-rate').value.trim() === '';

// ---------- Форма расхода ----------
export function fillExpenseCategories(categories, selectedId) {
  $('ef-category').replaceChildren(
    ...categories.map((c) => {
      const option = node('option', '', c.name);
      option.value = String(c.id);
      return option;
    }),
  );
  if (selectedId != null && categories.some((c) => c.id === selectedId)) $('ef-category').value = String(selectedId);
}

// values: { date, categoryId?, amount, currency, rate, comment }; mode: { isEdit, tripName }
export function fillExpenseForm(values, { isEdit, tripName }) {
  $('ef-banner').textContent = `${isEdit ? 'Изменение расхода' : 'Новый расход'} · ${tripName}`;
  $('ef-date').value = values.date;
  if (values.categoryId != null) $('ef-category').value = String(values.categoryId);
  $('ef-amount').value = values.amount === '' ? '' : String(values.amount).replace('.', ',');
  $('ef-currency').value = values.currency;
  $('ef-rate').value = values.rate === '' || values.rate == null ? '' : rateText(values.rate);
  $('ef-comment').value = values.comment;
  $('ef-delete').hidden = !isEdit;
  showExpenseErrors({});
}

export const readExpenseForm = () => ({
  date: $('ef-date').value,
  categoryId: Number($('ef-category').value) || null,
  amount: $('ef-amount').value,
  currency: $('ef-currency').value,
  rate: $('ef-rate').value,
  comment: $('ef-comment').value,
});

export function setExpenseRateVisible(visible, currency) {
  $('field-ef-rate').hidden = !visible;
  if (visible) $('ef-rate').previousElementSibling.textContent = `Курс 1 ${currency}`;
}
export const setExpenseRate = (rate) => { $('ef-rate').value = rate == null ? '' : rateText(rate); };
export const setExpenseRateHint = (text) => { $('ef-rate-hint').textContent = text; };
export const setExpensePreview = (text) => { $('ef-preview').textContent = text; };
export const focusExpenseAmount = () => $('ef-amount').focus();

// ---------- Подключение событий ----------
// h — обработчики из trips-app.js
export function bindTripsView(h) {
  $('trip-new').addEventListener('click', h.onNewTrip);
  $('trip-back').addEventListener('click', h.onBack);
  $('trip-edit').addEventListener('click', h.onEditTrip);
  $('expense-new').addEventListener('click', h.onNewExpense);

  $('trip-form').addEventListener('submit', (event) => { event.preventDefault(); h.onTripSubmit(); });
  $('tf-cancel').addEventListener('click', h.onTripCancel);
  $('tf-delete').addEventListener('click', h.onTripDelete);
  $('tf-currency').addEventListener('change', h.onTripCurrencyChange);

  $('expense-form').addEventListener('submit', (event) => { event.preventDefault(); h.onExpenseSubmit(); });
  $('ef-cancel').addEventListener('click', h.onExpenseCancel);
  $('ef-delete').addEventListener('click', h.onExpenseDelete);
  $('ef-currency').addEventListener('change', h.onExpenseCurrencyChange);
  for (const id of ['ef-amount', 'ef-rate']) $(id).addEventListener('input', h.onExpenseInput);

  // Красная подсказка поля исчезает, как только в нём что-то изменили
  for (const fields of [TRIP_FIELDS, EXPENSE_FIELDS]) {
    for (const id of Object.keys(fields)) {
      const clear = () => {
        $('error-' + id).textContent = '';
        $(id).setAttribute('aria-invalid', 'false');
      };
      $(id).addEventListener('input', clear);
      $(id).addEventListener('change', clear);
    }
  }
}

