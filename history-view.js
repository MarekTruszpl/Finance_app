// history-view.js — вкладка "Журнал": записи выбранной категории (или все, или только топливо) списком.
// Запись можно открыть нажатием, изменить свайпом вправо и удалить свайпом влево (строка — в swipe-rows.js).
// Данные приходят готовыми из stats.js (buildHistory).
import { num, moneyAuto, formatDate, plural } from './format.js';
import { createSwipeRow, resetSwipeRows } from './swipe-rows.js';

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

// model — результат buildHistory.
// onEdit / onDelete получают запись (нажатие и свайп вправо — изменить, свайп влево — удалить); selectedId — какая открыта в форме
export function renderHistory(model, { onEdit, onDelete, selectedId = null }) {
  $('history-summary').textContent = model.count === 0
    ? ''
    : `${model.count} ${plural(model.count, ['запись', 'записи', 'записей'])} · всего ${moneyAuto(model.total)}`;

  const list = $('history-list');
  list.replaceChildren();
  resetSwipeRows();

  if (model.count === 0) {
    list.append(node('li', 'empty', 'Здесь пока нет записей.'));
    return;
  }

  for (const item of model.items) {
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

    list.append(createSwipeRow([body], {
      onEdit: () => onEdit(item.record),
      onDelete: () => onDelete(item.record),
      onTap: () => onEdit(item.record),
      selected: item.id === selectedId,
    }));
  }
}
