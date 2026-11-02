// swipe.js — правила жеста "свайп" для строк списка. Чистые функции: без экрана, поэтому проверяются тестами.

export const ACTION_WIDTH = 96;    // ширина открытой кнопки действия, px
export const OPEN_THRESHOLD = 48;  // сдвиг, после которого строка остаётся открытой
export const FULL_THRESHOLD = 150; // сдвиг "до конца": действие выполняется сразу
const MAX_OFFSET = 170;            // дальше строку не тянем
const SLOP = 8;                    // сколько пальцу нужно сдвинуться, чтобы понять направление жеста

export const clampOffset = (x) => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, x));

// Куда повёл палец: 'x' (свайп), 'y' (прокрутка списка) или null (пока рано судить)
export function gestureAxis(dx, dy) {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

// Что делать, когда палец отпустили на сдвиге x (x > 0 — вправо: изменить, x < 0 — влево: удалить).
// Возвращает { action: 'edit' | 'delete' | null, rest: куда сдвинуть строку и оставить }.
export function decideSwipe(x) {
  if (x >= FULL_THRESHOLD) return { action: 'edit', rest: 0 };
  if (x <= -FULL_THRESHOLD) return { action: 'delete', rest: 0 };
  if (x >= OPEN_THRESHOLD) return { action: null, rest: ACTION_WIDTH };
  if (x <= -OPEN_THRESHOLD) return { action: null, rest: -ACTION_WIDTH };
  return { action: null, rest: 0 };
}
