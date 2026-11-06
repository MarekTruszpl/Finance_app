// swipe.js — правила жеста "свайп экрана" для переключения вкладок (Ввод, Журнал, Статистика).
// Чистые функции: без экрана, поэтому проверяются тестами. Подключение к экрану — в ui.js (initTabSwipe).
//
// Как это работает: в первые LOCK_DISTANCE пикселей палец "выбирает" ось. Если он пошёл по горизонтали,
// жест считается свайпом, и экран переключается, как только палец прошёл TRIGGER_DISTANCE (не дожидаясь,
// пока его отпустят). Если по вертикали, это обычная прокрутка, и жест игнорируется целиком.
// Короткий быстрый "щелчок" пальцем тоже засчитывается, когда палец отпущен.

export const LOCK_DISTANCE = 10;     // px: через столько понимаем, горизонтальный жест или вертикальный
export const TRIGGER_DISTANCE = 50;  // px по горизонтали: свайп засчитан сразу
export const FLICK_DISTANCE = 28;    // px: минимум для быстрого щелчка
export const FLICK_SPEED = 0.4;      // px/мс: насколько быстрым должен быть щелчок
const AXIS_RATIO = 1.2;              // по горизонтали палец должен пройти заметно больше, чем по вертикали
const EDGE = 16;                     // у самого края экрана у iOS свои жесты, там не срабатываем

// Какую ось выбрал палец: null (рано судить), 'x' (свайп) или 'y' (прокрутка)
export function lockAxis(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_DISTANCE) return null;
  return Math.abs(dx) >= Math.abs(dy) * AXIS_RATIO ? 'x' : 'y';
}

// Когда ось выбрана как горизонтальная: 'next' (палец влево: следующий экран), 'prev' (вправо) или null.
// released — палец уже отпущен (тогда засчитывается и быстрый короткий щелчок)
export function swipeDirection({ dx, ms, startX, screenWidth, released = false }) {
  if (startX < EDGE || startX > screenWidth - EDGE) return null;
  const distance = Math.abs(dx);
  const flick = released && distance >= FLICK_DISTANCE && distance / Math.max(ms, 1) >= FLICK_SPEED;
  if (distance < TRIGGER_DISTANCE && !flick) return null;
  return dx < 0 ? 'next' : 'prev';
}

// Соседний экран в направлении жеста; null, если дальше некуда
export function neighborTab(order, current, direction) {
  const index = order.indexOf(current);
  if (index === -1) return null;
  const target = order[index + (direction === 'next' ? 1 : -1)];
  return target ?? null;
}
