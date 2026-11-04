// receipt-view.js — панель "Заполнить из чека" на вкладке "Ввод".
// Принимает текст чека, показывает, что удалось найти, и по кнопке передаёт найденное в форму.
// Сам разбор текста лежит в receipt.js.
import { moneyAuto, formatDate, num } from './format.js';

const $ = (id) => document.getElementById(id);

function row(label, value) {
  const el = document.createElement('div');
  el.className = 'row';
  const name = document.createElement('span');
  name.className = 'row-label';
  name.textContent = label;
  const text = document.createElement('span');
  text.className = 'row-value';
  text.textContent = value;
  el.append(name, text);
  return el;
}

export function openReceiptPanel() {
  $('receipt-panel').hidden = false;
  $('open-receipt').hidden = true;
  $('receipt-text').value = '';
  showReceiptStatus('');
  $('receipt-result').hidden = true;
  $('receipt-notes').hidden = true;
  $('receipt-apply').hidden = true;
  $('receipt-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function closeReceiptPanel() {
  $('receipt-panel').hidden = true;
  $('open-receipt').hidden = false;
}

export function readReceiptText() {
  return $('receipt-text').value;
}

// parsed — результат parseReceipt; categoryName — название предложенной категории или null
export function showReceiptResult(parsed, { categoryName }) {
  const rows = [
    row('Сумма', parsed.amount != null ? moneyAuto(parsed.amount) : 'не найдена'),
    row('Дата', parsed.date ? formatDate(parsed.date) : 'не найдена (будет сегодняшняя)'),
  ];
  if (parsed.isFuel) rows.push(row('Литры', parsed.liters != null ? `${num(parsed.liters, 2)} л` : 'не найдены'));
  rows.push(row('Категория', categoryName ?? 'выберите сами'));
  if (!parsed.isFuel) rows.push(row('Комментарий', parsed.merchant ?? '—'));

  $('receipt-result').replaceChildren(...rows);
  $('receipt-result').hidden = false;

  $('receipt-notes').textContent = parsed.warnings.join('\n');
  $('receipt-notes').hidden = parsed.warnings.length === 0;

  // Кнопка "Заполнить" нужна, если нашлось хоть что-то
  $('receipt-apply').hidden = parsed.amount == null && !parsed.date && parsed.liters == null;
}

// Текст из распознавания по фото
export function setReceiptText(text) {
  $('receipt-text').value = text;
}

// Строка состояния под кнопкой фото; null или пустая строка — скрыть
export function showReceiptStatus(text) {
  $('receipt-status').textContent = text ?? '';
  $('receipt-status').hidden = !text;
}

// Пока идёт распознавание, кнопки действий недоступны
export function setReceiptBusy(busy) {
  $('receipt-photo').disabled = busy;
  $('receipt-parse').disabled = busy;
  $('receipt-apply').disabled = busy;
}

// Кнопка открывает выбор: снять на камеру или взять из галереи; callback получает файл
export function onReceiptPhoto(callback) {
  $('receipt-photo').addEventListener('click', () => $('receipt-file').click());
  $('receipt-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // чтобы можно было выбрать то же фото повторно
    if (file) callback(file);
  });
}

export function onReceiptOpen(callback) {
  $('open-receipt').addEventListener('click', callback);
}
export function onReceiptParse(callback) {
  $('receipt-parse').addEventListener('click', callback);
}
export function onReceiptApply(callback) {
  $('receipt-apply').addEventListener('click', callback);
}
export function onReceiptClose(callback) {
  $('receipt-close').addEventListener('click', callback);
}
