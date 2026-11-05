// swipe-rows.js — строка списка со свайпом: вправо — "Изменить", влево — "Удалить", нажатие — открыть.
// Если провести палец до конца, действие выполняется сразу; если чуть меньше — строка раскрывается и показывает кнопку.
// Правила жеста (пороги, направление) лежат в swipe.js и проверяются тестами; здесь только работа с экраном.
import { ACTION_WIDTH, clampOffset, decideSwipe, gestureAxis } from './swipe.js';

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

function attachSwipe(li, content, editButton, deleteButton, { onEdit, onDelete, onTap }) {
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

  // Нажатие на раскрытую строку закрывает её, на обычную — выполняет onTap (например, открывает запись)
  content.addEventListener('click', () => {
    if (Date.now() - swipedAt < 350) return; // это конец свайпа, а не нажатие
    if (restOffset !== 0) rest(0);
    else if (onTap) onTap();
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

// Перед перерисовкой списка: забыть раскрытую строку (она исчезнет вместе со списком)
export function resetSwipeRows() {
  openSwipeRow = null;
  ensureSwipeCloser();
}

// children — что показать в строке; opts.onEdit / onDelete / onTap вызываются без аргументов
export function createSwipeRow(children, { onEdit, onDelete, onTap = null, selected = false }) {
  const li = document.createElement('li');
  li.className = 'swipe-row';
  li.title = 'Свайп вправо: изменить, влево: удалить';

  // Слой с содержимым двигается, кнопки действий лежат под ним
  const content = document.createElement('div');
  content.className = 'swipe-content';
  content.append(...children);

  const editButton = actionButton('swipe-action swipe-edit', 'Изменить');
  const deleteButton = actionButton('swipe-action swipe-delete', 'Удалить');
  li.append(editButton, deleteButton, content);
  attachSwipe(li, content, editButton, deleteButton, { onEdit, onDelete, onTap });
  if (selected) li.setAttribute('aria-current', 'true');
  return li;
}
