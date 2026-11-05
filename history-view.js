// history-view.js — вкладка "Журнал": записи выбранной категории (или все, или только топливо) списком.
// Нажатие на запись открывает её на изменение (там же есть кнопка "Удалить запись").
// Данные приходят готовыми из stats.js (buildHistory).
import { num, moneyAuto, formatDate, plural } from './format.js';

const $ = (id) => document.getElementById(id);

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// options — [{ value, label }] из getHistoryOptions; selected — какое значение оставить выбранным
export function fillHistoryOptions(options, selected) {
  $('history-category').replaceChildren(
    ...options.map((o) => {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      return option;
    }),
  );
  $('history-category').value = selected;
}

export function readHistorySelection() {
  return $('history-category').value;
}

export function onHistoryChange(callback) {
  $('history-category').addEventListener('change', callback);
}

// model — результат buildHistory; onSelect получает запись, на которую нажали (она открывается на изменение)
export function renderHistory(model, { onSelect }) {
  $('history-summary').textContent = model.count === 0
    ? ''
    : `${model.count} ${plural(model.count, ['запись', 'записи', 'записей'])} · всего ${moneyAuto(model.total)}`;

  const list = $('history-list');
  list.replaceChildren();

  if (model.count === 0) {
    list.append(node('li', 'empty', 'Здесь пока нет записей.'));
    return;
  }

  for (const item of model.items) {
    const li = node('li');
    li.setAttribute('role', 'button');
    li.tabIndex = 0;

    const body = node('div', 'hist-body');

    // Дата и сумма
    const top = node('div', 'hist-top');
    top.append(node('span', 'title', formatDate(item.date)), node('span', 'title', moneyAuto(item.amount, item.currency)));

    // Пробег (и категория, если смотрим сразу несколько)
    const meta = [`${num(item.mileage)} км`];
    if (item.liters) meta.push(`${num(item.liters, 2)} л`); // у топлива показываем литры
    if (model.showCategory) meta.push(item.categoryName);
    body.append(top, node('div', 'sub', meta.join(' · ')));

    if (item.comment) body.append(node('div', 'hist-comment', item.comment));

    li.append(body);
    li.addEventListener('click', () => onSelect(item.record));
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(item.record);
      }
    });
    list.append(li);
  }
}
