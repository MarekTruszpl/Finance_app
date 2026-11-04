// ui.js — всё, что связано с экраном. Здесь нет работы с базой и правил проверки:
// только показать данные и считать то, что ввёл пользователь.
import { BASE_CURRENCY, CURRENCIES } from './defaults.js';
import { formatNumberInput } from './logic.js';
import { ACTION_WIDTH, clampOffset, decideSwipe, gestureAxis } from './swipe.js';

const $ = (id) => document.getElementById(id);
// Порядок = порядок полей на экране (курсор встанет на первое неверное)
const FIELD_IDS = ['date', 'category', 'mileage', 'amount', 'rate', 'liters', 'comment'];

const formatNumber = (n) => n.toLocaleString('ru-RU');
const formatDate = (iso) => iso.split('-').reverse().join('.'); // 2026-03-01 -> 01.03.2026
const formatRate = (rate) => String(rate).replace('.', ','); // 3.9 -> 3,9
const symbolOf = (code) => CURRENCIES.find((c) => c.code === code)?.symbol ?? code;

// Сумма с символом валюты, например "3200 zł". Взята польская локаль, чтобы злотый
// выводился как "zł" и стоял после числа. Старые записи без валюты считаем злотыми.
function formatMoney(amount, currency = BASE_CURRENCY) {
  try {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${formatNumber(amount)} ${currency}`; // на случай неизвестного кода валюты
  }
}

// ---------- Переключатель "Ввод / Журнал / Статистика" ----------
const TABS = {
  entry: ['tab-entry', 'view-entry'],
  history: ['tab-history', 'view-history'],
  stats: ['tab-stats', 'view-stats'],
};

let currentTab = 'entry';
let editingNow = false;

// Значок камеры (фото чека) нужен только на вкладке "Ввод" и только для новой записи
function updateCameraVisibility() {
  const el = $('receipt-camera');
  if (el) el.hidden = currentTab !== 'entry' || editingNow;
}

// Показать вкладку: 'entry' | 'history' | 'stats'
export function showTab(name) {
  currentTab = name;
  updateCameraVisibility();
  for (const [key, [tabId, panelId]] of Object.entries(TABS)) {
    const active = key === name;
    $(tabId).setAttribute('aria-selected', String(active));
    $(panelId).hidden = !active;
  }
}

export function initTabs() {
  for (const [key, [tabId]] of Object.entries(TABS)) {
    $(tabId).addEventListener('click', () => showTab(key));
  }
}

// ---------- Форма ----------
// selectedId — какую категорию оставить выбранной (если она есть в списке)
export function fillCategories(categories, selectedId = null) {
  $('category').replaceChildren(
    ...categories.map((c) => {
      const option = document.createElement('option');
      option.value = String(c.id);
      option.textContent = c.name;
      return option;
    }),
  );
  if (selectedId !== null && categories.some((c) => c.id === selectedId)) {
    $('category').value = String(selectedId);
  }
}

export function fillCurrencies() {
  $('currency').replaceChildren(
    ...CURRENCIES.map((c) => {
      const option = document.createElement('option');
      option.value = c.code;
      option.textContent = c.code;
      option.title = c.name;
      return option;
    }),
  );
  $('currency').value = BASE_CURRENCY;
}

// Выбор валюты показываем только в разделах с мультивалютностью
// Если выбора нет, после суммы просто показываем символ базовой валюты (zł)
export function setCurrencyEnabled(enabled) {
  $('currency').hidden = !enabled;
  const unit = $('amount-unit');
  unit.hidden = enabled;
  unit.textContent = symbolOf(BASE_CURRENCY);
}

// Деление на разряды прямо во время ввода: 100500 -> 100 500
// Курсор возвращаем на то же место, чтобы можно было править число посередине.
function attachNumberFormat(id, options) {
  const input = $(id);
  const significant = options.decimals === 0 ? /[^\d]/g : /[^\d.,]/g; // что считаем "значащим"
  input.addEventListener('input', () => {
    const before = input.value;
    const caret = input.selectionStart ?? before.length;
    const formatted = formatNumberInput(before, options);
    if (formatted === before) return;

    const count = before.slice(0, caret).replace(significant, '').length; // цифры слева от курсора
    input.value = formatted;

    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < count) {
      if (/[\d,]/.test(formatted[pos])) seen++;
      pos++;
    }
    input.setSelectionRange(pos, pos);
  });
}

// Вызывать до onFormChange, чтобы остальной код видел уже отформатированное значение
export function initNumberFormatting() {
  attachNumberFormat('mileage', { decimals: 0 });
  attachNumberFormat('amount', { decimals: 2 });
  attachNumberFormat('liters', { decimals: 2 });
}

export function setDate(isoDate) {
  $('date').value = isoDate;
  $('date').max = isoDate; // в календаре нельзя выбрать будущее
}

// Что сейчас введено в форме (всё как текст, проверит logic.js)
export function readForm() {
  return {
    date: $('date').value,
    categoryId: Number($('category').value),
    mileage: $('mileage').value,
    amount: $('amount').value,
    currency: $('currency').value,
    rate: $('rate').value,
    liters: $('liters').value,
    comment: $('comment').value,
  };
}

// Топливо -> показываем литры, остальные категории -> комментарий
export function showCategoryFields(category) {
  const isFuel = category?.kind === 'fuel';
  $('field-liters').hidden = !isFuel;
  $('field-comment').hidden = isFuel;
}

// Подсказка под полем пробега и зелёная метка "+500 км" рядом с названием поля
// placeholder — число, которое серым стоит в пустом поле (null — просто 0)
export function showMileageInfo({ hint, delta, placeholder = null }) {
  $('mileage').placeholder = placeholder === null ? '0' : formatNumber(placeholder);
  $('mileage-hint').textContent = hint;
  const el = $('mileage-delta');
  if (delta === null || delta === undefined) {
    el.hidden = true;
    return;
  }
  const sign = delta > 0 ? 'plus' : delta < 0 ? 'minus' : 'zero';
  const prefix = delta > 0 ? '+' : delta < 0 ? '−' : '';
  el.textContent = `${prefix}${formatNumber(Math.abs(delta))} км`;
  el.dataset.sign = sign;
  el.hidden = false;
}

// ---------- Курс ----------

// currency — код валюты, для которой нужен курс; null — скрыть строку курса
export function showRateField(currency) {
  $('field-rate').hidden = !currency;
  if (!currency) return;
  $('rate-label').textContent = `Курс к ${symbolOf(BASE_CURRENCY)}`;
  $('rate').placeholder = `за 1 ${currency}`;
}

// Подсказки под полем курса.
//   last    — { rate, date } последнего курса этой валюты или null
//   stale   — true, если последний курс давно не обновлялся
//   preview — { amount, converted } для строки "100 USD ≈ 390 zł" или null
export function showRateInfo({ currency, last, stale, preview }) {
  let hint;
  if (!last) {
    hint = `Это первая запись в ${currency}. Сколько ${symbolOf(BASE_CURRENCY)} стоит 1 ${currency}?`;
  } else if (stale) {
    hint = `Последний курс ${formatRate(last.rate)} от ${formatDate(last.date)}. Он мог устареть, проверьте.`;
  } else {
    hint = `Последний курс: ${formatRate(last.rate)} (${formatDate(last.date)})`;
  }
  $('rate-hint').textContent = hint;
  $('rate-preview').textContent = preview
    ? `${formatMoney(preview.amount, currency)} ≈ ${formatMoney(preview.converted, BASE_CURRENCY)}`
    : '';
}

// Записать курс в поле (null — очистить)
export function setRate(rate) {
  $('rate').value = rate == null ? '' : formatRate(rate);
}

// errors — объект { поле: 'текст' } из validateRecord. Пустой объект убирает все ошибки.
export function showErrors(errors) {
  for (const id of FIELD_IDS) {
    const message = errors[id] ?? '';
    $('error-' + id).textContent = message;
    $(id).setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  const firstInvalid = FIELD_IDS.find((id) => errors[id]);
  if (firstInvalid) $(firstInvalid).focus();
}

// После сохранения: дату, категорию, валюту и курс оставляем, остальное очищаем
export function resetAfterSave() {
  for (const id of ['mileage', 'amount', 'liters', 'comment']) $(id).value = '';
  showErrors({});
}

export function setSaving(isSaving) {
  $('save').disabled = isSaving;
}

// Обработчики событий (их передаёт app.js)
export function onFormChange(callback) {
  for (const id of ['date', 'category', 'mileage', 'amount', 'rate']) {
    $(id).addEventListener('input', callback);
  }
}
export function onCurrencyChange(callback) {
  $('currency').addEventListener('change', callback);
}
export function onSubmit(callback) {
  $('entry-form').addEventListener('submit', (event) => {
    event.preventDefault(); // не перезагружать страницу
    callback();
  });
}

// ---------- Список и статистика ----------
// ---------- Список записей: изменить и удалить свайпом ----------
// Свайп вправо — "Изменить", свайп влево — "Удалить". Если провести палец до конца,
// действие выполняется сразу; если чуть меньше — строка раскрывается и показывает кнопку.

let openSwipeRow = null; // { li, reset } — строка, у которой сейчас раскрыта кнопка
let swipeCloserAttached = false;

function closeOpenRow() {
  if (!openSwipeRow) return;
  const row = openSwipeRow;
  openSwipeRow = null;
  row.reset();
}

// Нажатие в любом другом месте закрывает раскрытую строку (подключаем один раз)
function ensureSwipeCloser() {
  if (swipeCloserAttached || typeof document.addEventListener !== 'function') return;
  swipeCloserAttached = true;
  document.addEventListener('pointerdown', (event) => {
    if (openSwipeRow && !openSwipeRow.li.contains(event.target)) closeOpenRow();
  });
}

function actionButton(className, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

function attachSwipe(li, content, editButton, deleteButton, { onEdit, onDelete }) {
  let startX = 0;
  let startY = 0;
  let axis = null;       // 'x' — идёт свайп, 'y' — пользователь прокручивает список
  let offset = 0;        // где строка сейчас
  let restOffset = 0;    // где строка "стоит": 0 или ширина кнопки
  let tracking = false;
  let swipedAt = 0;

  const moveTo = (value, animate) => {
    content.style.transition = animate ? 'transform 0.2s ease' : 'none';
    content.style.transform = `translateX(${value}px)`;
  };
  const rest = (value) => {
    restOffset = value;
    offset = value;
    moveTo(value, true);
    openSwipeRow = value === 0 ? null : { li, reset: () => rest(0) };
  };
  const reveal = (value) => {
    if (openSwipeRow && openSwipeRow.li !== li) closeOpenRow();
    rest(value);
  };

  content.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (openSwipeRow && openSwipeRow.li !== li) closeOpenRow();
    tracking = true;
    axis = null;
    startX = event.clientX;
    startY = event.clientY;
  });

  content.addEventListener('pointermove', (event) => {
    if (!tracking) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === null) {
      axis = gestureAxis(dx, dy);
      if (axis === 'x' && content.setPointerCapture) content.setPointerCapture(event.pointerId);
    }
    if (axis !== 'x') return;
    offset = clampOffset(restOffset + dx);
    moveTo(offset, false);
  });

  const finish = () => {
    if (!tracking) return;
    tracking = false;
    if (axis !== 'x') return;
    axis = null;
    swipedAt = Date.now();
    const { action, rest: target } = decideSwipe(offset);
    rest(target);
    if (action === 'edit') onEdit();
    else if (action === 'delete') onDelete();
  };
  content.addEventListener('pointerup', finish);
  content.addEventListener('pointercancel', () => {
    if (tracking && axis === 'x') rest(restOffset);
    tracking = false;
    axis = null;
  });

  // Нажатие на раскрытую строку закрывает её (а нажатие на обычную ничего не делает)
  content.addEventListener('click', () => {
    if (Date.now() - swipedAt < 350) return; // это конец свайпа, а не нажатие
    if (restOffset !== 0) rest(0);
  });

  editButton.addEventListener('click', () => { rest(0); onEdit(); });
  deleteButton.addEventListener('click', () => { rest(0); onDelete(); });
  // Для клавиатуры: кнопка получает фокус — строка раскрывается, чтобы её было видно
  editButton.addEventListener('focus', () => reveal(ACTION_WIDTH));
  deleteButton.addEventListener('focus', () => reveal(-ACTION_WIDTH));

  li.tabIndex = 0;
  li.addEventListener('keydown', (event) => {
    if (event.target !== li) return; // клавиши внутри кнопок не перехватываем
    if (event.key === 'Enter') {
      event.preventDefault();
      onEdit();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDelete();
    }
  });
}

// opts.selectedId       — какая запись сейчас редактируется (подсвечивается)
// opts.onEdit(запись)   — свайп вправо или кнопка "Изменить"
// opts.onDelete(запись) — свайп влево или кнопка "Удалить"
export function renderRecords(records, nameById, { selectedId = null, onEdit = null, onDelete = null } = {}) {
  const list = $('records');
  list.replaceChildren();
  openSwipeRow = null;
  ensureSwipeCloser();

  if (records.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Пока нет записей. Добавьте первую в форме выше.';
    list.append(li);
    return;
  }

  for (const r of records) {
    const li = document.createElement('li');
    li.className = 'swipe-row';
    li.title = 'Свайп вправо: изменить, влево: удалить';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = nameById[r.category_id] ?? 'Без категории';
    const sub = document.createElement('div');
    sub.className = 'sub';
    const extra = r.liters != null ? `${formatNumber(r.liters)} л` : r.comment;
    sub.textContent = [formatDate(r.date), extra].filter(Boolean).join(' · ');
    left.append(title, sub);

    const right = document.createElement('div');
    right.className = 'right';
    const amount = document.createElement('div');
    amount.className = 'title';
    amount.textContent = formatMoney(r.amount, r.currency);
    const details = document.createElement('div');
    details.className = 'sub';
    const parts = [];
    // Для чужой валюты показываем, сколько это в злотых по сохранённому курсу
    if (r.currency && r.currency !== BASE_CURRENCY && r.amount_base != null) {
      parts.push(`≈ ${formatMoney(r.amount_base, BASE_CURRENCY)}`);
    }
    parts.push(`${formatNumber(r.mileage)} км`);
    details.textContent = parts.join(' · ');
    right.append(amount, details);

    // Слой с содержимым двигается, кнопки действий лежат под ним
    const content = document.createElement('div');
    content.className = 'swipe-content';
    content.append(left, right);

    const editButton = actionButton('swipe-action swipe-edit', 'Изменить');
    const deleteButton = actionButton('swipe-action swipe-delete', 'Удалить');
    li.append(editButton, deleteButton, content);
    attachSwipe(li, content, editButton, deleteButton, {
      onEdit: () => onEdit && onEdit(r),
      onDelete: () => onDelete && onDelete(r),
    });

    if (r.id === selectedId) li.setAttribute('aria-current', 'true');
    list.append(li);
  }
}

// Подпись под заголовком: последний введённый пробег
export function renderStats({ lastMileage }) {
  $('header-mileage').textContent =
    lastMileage == null ? '' : `Последний пробег: ${formatNumber(lastMileage)} км`;
}

// ---------- Уведомления ----------
let toastTimer;
export function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

export function showFatalError(message) {
  const banner = $('app-error');
  banner.textContent = message;
  banner.hidden = false;
}

// ---------- Редактирование и удаление ----------

// Загрузить запись в форму
export function fillForm(record) {
  $('date').value = record.date;
  $('category').value = String(record.category_id);
  $('mileage').value = formatNumberInput(String(record.mileage), { decimals: 0 });
  $('amount').value = formatNumberInput(formatRate(record.amount), { decimals: 2 });
  $('currency').value = record.currency ?? BASE_CURRENCY;
  setRate(record.currency && record.currency !== BASE_CURRENCY ? record.rate : null);
  $('liters').value = record.liters != null ? formatNumberInput(formatRate(record.liters), { decimals: 2 }) : '';
  $('comment').value = record.comment ?? '';
  showErrors({});
  window.scrollTo({ top: 0, behavior: 'smooth' }); // форма наверху, поднимаем экран к ней
}

// record — запись, которую редактируем; null — обычный режим добавления
export function setEditMode(record) {
  const editing = record !== null;
  editingNow = editing; // заполнять из чека можно только новую запись
  updateCameraVisibility();
  $('edit-banner').hidden = !editing;
  if (editing) $('edit-banner').textContent = `Редактирование записи от ${formatDate(record.date)}`;
  $('cancel-edit').hidden = !editing;
  $('delete').hidden = !editing;
  $('save').textContent = editing ? 'Сохранить изменения' : 'Сохранить';
}

export function confirmAction(message) {
  return window.confirm(message);
}

export function setShowMore(visible) {
  $('show-more').hidden = !visible;
}

export function onCancelEdit(callback) {
  $('cancel-edit').addEventListener('click', callback);
}
export function onDelete(callback) {
  $('delete').addEventListener('click', callback);
}
export function onShowMore(callback) {
  $('show-more').addEventListener('click', callback);
}

// ---------- Экраны ----------
export function showScreen(name) {
  $('screen-main').hidden = name !== 'main';
  $('screen-settings').hidden = name !== 'settings';
  window.scrollTo(0, 0);
}
export function onOpenSettings(callback) {
  $('open-settings').addEventListener('click', callback);
}
export function onCloseSettings(callback) {
  $('settings-back').addEventListener('click', callback);
}

// ---------- Категории в настройках ----------
const KIND_LABELS = { fuel: 'Топливо', regular: 'Обычная' };
const CATEGORY_FIELDS = ['name', 'kind'];

export function renderCategoryList(categories, { selectedId = null, onSelect }) {
  const list = $('categories-list');
  list.replaceChildren();

  for (const c of categories) {
    const li = document.createElement('li');
    if (c.archived) li.classList.add('archived');

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = c.name;
    left.append(title);
    if (c.archived) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'Скрыта';
      left.append(sub);
    }

    const right = document.createElement('div');
    right.className = 'sub';
    right.textContent = KIND_LABELS[c.kind] ?? '';

    li.append(left, right);
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.addEventListener('click', () => onSelect(c));
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(c);
      }
    });
    if (c.id === selectedId) li.setAttribute('aria-current', 'true');
    list.append(li);
  }
}

// category — редактируемая категория или null (новая)
// locked   — тип менять нельзя (у категории есть записи)
// actionLabel — подпись красной кнопки ("Удалить категорию", "Скрыть категорию",
//               "Вернуть в список") или null, если кнопка не нужна
export function openCategoryEditor({ category, locked, actionLabel }) {
  $('category-form').hidden = false;
  $('cat-banner').textContent = category ? 'Редактирование категории' : 'Новая категория';
  $('cat-name').value = category ? category.name : '';
  $('cat-kind').value = category ? category.kind : 'regular';
  $('cat-kind').disabled = locked;
  $('cat-kind-hint').textContent = locked
    ? 'Тип нельзя изменить: у категории уже есть записи.'
    : 'Топливо: в записи будут литры и подсказка пробега между заправками. Обычная: в записи будет комментарий.';
  $('cat-delete').hidden = !actionLabel;
  if (actionLabel) $('cat-delete').textContent = actionLabel;
  showCategoryErrors({});
  $('category-form').scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (!category) $('cat-name').focus({ preventScroll: true });
}

export function closeCategoryEditor() {
  $('category-form').hidden = true;
  showCategoryErrors({});
}

export function readCategoryForm() {
  return { name: $('cat-name').value, kind: $('cat-kind').value };
}

export function showCategoryErrors(errors) {
  for (const key of CATEGORY_FIELDS) {
    $('error-cat-' + key).textContent = errors[key] ?? '';
    $('cat-' + key).setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
  }
  const first = CATEGORY_FIELDS.find((key) => errors[key]);
  if (first) $('cat-' + first).focus();
}

export function onAddCategory(callback) {
  $('add-category').addEventListener('click', callback);
}
export function onCategorySubmit(callback) {
  $('category-form').addEventListener('submit', (event) => {
    event.preventDefault();
    callback();
  });
}
export function onCategoryCancel(callback) {
  $('cat-cancel').addEventListener('click', callback);
}
export function onCategoryAction(callback) {
  $('cat-delete').addEventListener('click', callback);
}

// ---------- Данные: копия, восстановление, CSV ----------

// Скачать файл (браузер сам предложит сохранить)
export function downloadFile(filename, content, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function alertMessage(message) {
  window.alert(message);
}

// Строки под кнопками раздела "Данные": когда была копия, защищено ли хранилище
export function setDataStatus({ lastBackupIso, changes, persisted }) {
  const lines = [];
  lines.push(
    lastBackupIso
      ? `Последняя копия: ${new Date(lastBackupIso).toLocaleDateString('ru-RU')}${changes > 0 ? `, изменений с тех пор: ${changes}` : ''}.`
      : 'Резервных копий ещё не было.',
  );
  if (persisted === true) lines.push('Защита хранилища: включена.');
  else if (persisted === false) lines.push('Защита хранилища: браузер не гарантирует сохранность данных, поэтому делайте копии.');
  lines.push('Копия (JSON) нужна, чтобы восстановить данные или перенести их на другое устройство. CSV открывается в Google Таблицах.');
  $('data-footer').textContent = lines.join('\n');
}

// Сохранить файл копии. На телефоне открывается окно "Поделиться" (там есть "Сохранить в Файлы"),
// на компьютере файл просто скачивается. Возвращает true, если копия сохранена,
// и false, если пользователь закрыл окно, ничего не выбрав.
// Вызывать нужно сразу по нажатию кнопки: телефон разрешает "Поделиться" только в ответ на касание.
export async function saveBackupFile(filename, content) {
  const isPhone = /Android|iPhone|iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
  if (isPhone && typeof File === 'function' && navigator.canShare) {
    const file = new File([content], filename, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Резервная копия' });
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false;
        // другая ошибка: пробуем обычное скачивание
      }
    }
  }
  downloadFile(filename, content, 'application/json');
  return true;
}

// ---------- Напоминание о копии ----------
export function showBackupReminder(reminder) {
  const box = $('backup-reminder');
  if (!reminder) {
    box.hidden = true;
    return;
  }
  let text;
  if (reminder.reason === 'never') {
    text = 'Резервной копии ещё нет. Сохраните её, чтобы не потерять записи.';
  } else if (reminder.reason === 'changes') {
    text = `С последней копии накопилось изменений: ${reminder.changes}. Сохраните свежую копию.`;
  } else {
    text = `Последняя копия сделана ${reminder.days} ${plural(reminder.days, ['день', 'дня', 'дней'])} назад, изменений с тех пор: ${reminder.changes}.`;
  }
  $('backup-reminder-text').textContent = text;
  box.hidden = false;
}
export function onReminderSave(callback) {
  $('reminder-save').addEventListener('click', callback);
}
export function onReminderLater(callback) {
  $('reminder-later').addEventListener('click', callback);
}

// ---------- Автокопии внутри приложения ----------
export function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export function showSnapshots(snapshots, { onSelect }) {
  const list = $('snapshots-list');
  list.replaceChildren();

  if (snapshots.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Автокопий пока нет. Первая появится при первом изменении данных.';
    list.append(li);
  }
  for (const s of snapshots) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = s.reason;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = formatDateTime(s.createdAt);
    left.append(title, sub);

    const right = document.createElement('div');
    right.className = 'sub';
    right.textContent = `${s.counts.records} ${plural(s.counts.records, ['запись', 'записи', 'записей'])}`;

    li.append(left, right);
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.addEventListener('click', () => onSelect(s));
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(s);
      }
    });
    list.append(li);
  }

  const panel = $('snapshots-panel');
  const wasHidden = panel.hidden;
  panel.hidden = false;
  if (wasHidden) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
export function closeSnapshots() {
  $('snapshots-panel').hidden = true;
}
export function onOpenSnapshots(callback) {
  $('open-snapshots').addEventListener('click', callback);
}
export function onCloseSnapshots(callback) {
  $('snapshots-close').addEventListener('click', callback);
}

export function onExportBackup(callback) {
  $('export-backup').addEventListener('click', callback);
}
export function onExportCsv(callback) {
  $('export-csv').addEventListener('click', callback);
}
// Кнопка "Восстановить" открывает выбор файла; callback получает выбранный файл
export function onRestoreFile(callback) {
  const input = $('restore-file');
  $('restore-backup').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = ''; // чтобы тот же файл можно было выбрать повторно
    if (file) callback(file);
  });
}

// ---------- Импорт из CSV и очистка ----------

// "1 запись", "2 записи", "5 записей"
function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Кнопка "Импорт из CSV" открывает выбор файла; callback получает выбранный файл
export function onImportFile(callback) {
  const input = $('import-file');
  $('import-csv').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (file) callback(file);
  });
}

export function fillImportCategories(categories) {
  $('import-category').replaceChildren(
    ...categories.map((c) => {
      const option = document.createElement('option');
      option.value = String(c.id);
      option.textContent = c.name;
      return option;
    }),
  );
}
export function readImportCategory() {
  return $('import-category').value;
}

export function showImportPreview({ fileName, total, ready, duplicates, errorsCount, details }) {
  const form = $('import-form');
  const wasHidden = form.hidden;
  form.hidden = false;
  $('import-banner').textContent = `Импорт из файла «${fileName}»`;
  $('import-total').textContent = String(total);
  $('import-ready').textContent = String(ready);
  $('import-dups').textContent = String(duplicates);
  $('import-errors').textContent = String(errorsCount);
  $('import-details').textContent = details;
  $('import-confirm').textContent = ready > 0
    ? `Импортировать ${ready} ${plural(ready, ['запись', 'записи', 'записей'])}`
    : 'Нечего импортировать';
  $('import-confirm').disabled = ready === 0;
  if (wasHidden) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function closeImportPanel() {
  $('import-form').hidden = true;
}

export function onImportCategoryChange(callback) {
  $('import-category').addEventListener('change', callback);
}
export function onImportConfirm(callback) {
  $('import-form').addEventListener('submit', (event) => {
    event.preventDefault();
    callback();
  });
}
export function onImportCancel(callback) {
  $('import-cancel').addEventListener('click', callback);
}
export function onClearRecords(callback) {
  $('clear-records').addEventListener('click', callback);
}

// ---------- Заполнение формы из чека ----------

// Подставляет в форму то, что нашлось на чеке; пустые значения поля не трогают
export function applyReceiptToForm({ date, amount, liters, categoryId, comment }) {
  if (date) $('date').value = date;
  if (amount != null) $('amount').value = formatNumberInput(formatRate(amount), { decimals: 2 });
  if (categoryId != null && [...$('category').options].some((o) => o.value === String(categoryId))) {
    $('category').value = String(categoryId);
  }
  if (liters != null) $('liters').value = formatNumberInput(formatRate(liters), { decimals: 2 });
  if (comment && $('comment').value.trim() === '') $('comment').value = comment;
  showErrors({});
}

export function focusMileage() {
  $('mileage').focus();
}
