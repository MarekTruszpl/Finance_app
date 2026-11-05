// swipe.js — правила жеста "свайп экрана" для переключения вкладок (Ввод, Журнал, Статистика).
// Чистые функции: без экрана, поэтому проверяются тестами. Подключение к экрану — в ui.js (initTabSwipe).

export const MIN_DISTANCE = 70;   // сколько пикселей нужно пройти пальцем по горизонтали
export const MAX_DURATION = 700;  // дольше — это не свайп, а медленное перетаскивание или выделение
const EDGE = 24;                  // у самого края экрана у iOS свои жесты, там не срабатываем
const DIRECTION_RATIO = 1.8;      // по горизонтали палец должен пройти заметно больше, чем по вертикали

// Что сделать с жестом. Возвращает 'next' (свайп влево: следующий экран), 'prev' (вправо: предыдущий) или null.
export function decideScreenSwipe({ dx, dy, ms, startX, screenWidth }) {
  if (ms > MAX_DURATION) return null;
  if (Math.abs(dx) < MIN_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return null; // это прокрутка вверх или вниз
  if (startX < EDGE || startX > screenWidth - EDGE) return null;
  return dx < 0 ? 'next' : 'prev';
}

// Соседний экран в направлении жеста; null, если дальше некуда
export function neighborTab(order, current, direction) {
  const index = order.indexOf(current);
  if (index === -1) return null;
  const target = order[index + (direction === 'next' ? 1 : -1)];
  return target ?? null;
}
