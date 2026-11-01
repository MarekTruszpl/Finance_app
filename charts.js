// charts.js — простые графики в виде SVG. Без внешних библиотек, поэтому работают без интернета.
// Цвета и шрифты задаются в style.css (классы bar-*, line-*, grid, axis-label).
import { niceScale } from './stats.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340; // ширина области рисования; SVG сам растягивается по ширине экрана
const MARGIN = { top: 12, right: 8, bottom: 22, left: 46 };

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatAxis(value) {
  if (value >= 1000) return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс.`;
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function createChart(height, ariaLabel) {
  return el('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', role: 'img', 'aria-label': ariaLabel });
}

// Горизонтальные линии и подписи по оси Y
function drawGrid(svg, scale, height) {
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const ticks = Math.round(scale.max / scale.step);
  for (let i = 0; i <= ticks; i++) {
    const y = MARGIN.top + plotH - (i / ticks) * plotH;
    svg.append(el('line', { x1: MARGIN.left, x2: W - MARGIN.right, y1: y, y2: y, class: 'grid' }));
    svg.append(el('text', { x: MARGIN.left - 6, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' }, formatAxis(i * scale.step)));
  }
}

// Линии (например, расходы нарастающим итогом по дням месяца)
// series: [{ className, values: [число на каждый день] }]; pointsCount — сколько дней на оси X
export function renderLineChart(container, { series, pointsCount, ariaLabel }) {
  const height = 200;
  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const scale = niceScale(Math.max(0, ...series.flatMap((s) => s.values)));
  const svg = createChart(height, ariaLabel);
  drawGrid(svg, scale, height);

  const xAt = (i) => MARGIN.left + (pointsCount <= 1 ? 0 : (i / (pointsCount - 1)) * plotW);
  const yAt = (v) => MARGIN.top + plotH - (v / scale.max) * plotH;

  for (const day of [1, 5, 10, 15, 20, 25, 30]) {
    if (day > pointsCount) continue;
    svg.append(el('text', { x: xAt(day - 1), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' }, String(day)));
  }
  for (const s of series) {
    if (s.values.length === 0) continue;
    const points = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    svg.append(el('polyline', { points, class: s.className, fill: 'none' }));
    const last = s.values.length - 1;
    svg.append(el('circle', { cx: xAt(last).toFixed(1), cy: yAt(s.values[last]).toFixed(1), r: 3, class: `${s.className}-dot` }));
  }
  container.replaceChildren(svg);
}

// Столбики, можно составные (топливо + остальное)
// stacks: [{ className, values: [число на каждую подпись] }], снизу вверх
// onSelect(i) — вызывается при нажатии на столбец (нажимать можно на всю колонку, даже если столбик низкий)
// slotLabels[i] — подпись колонки для скринридера
export function renderBarChart(container, { labels, stacks, ariaLabel, onSelect = null, slotLabels = [] }) {
  const height = 190;
  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const totals = labels.map((_, i) => stacks.reduce((sum, s) => sum + (s.values[i] || 0), 0));
  const scale = niceScale(Math.max(0, ...totals));
  const svg = createChart(height, ariaLabel);
  drawGrid(svg, scale, height);

  const slot = plotW / Math.max(1, labels.length);
  const barW = Math.min(28, slot * 0.62);
  const labelEvery = Math.ceil(labels.length / 12); // не больше ~12 подписей под осью
  const slotX = (i) => MARGIN.left + slot * i;

  // 1) Подсветка выбранной колонки (рисуется под столбиками)
  const backgrounds = labels.map((_, i) => {
    const bg = el('rect', { x: slotX(i).toFixed(1), y: MARGIN.top, width: slot.toFixed(1), height: plotH, class: 'bar-bg' });
    svg.append(bg);
    return bg;
  });

  // 2) Столбики и подписи под осью
  labels.forEach((label, i) => {
    const x = slotX(i) + (slot - barW) / 2;
    let top = MARGIN.top + plotH;
    for (const s of stacks) {
      const value = s.values[i] || 0;
      if (value <= 0) continue;
      const h = (value / scale.max) * plotH;
      top -= h;
      svg.append(el('rect', { x: x.toFixed(1), y: top.toFixed(1), width: barW.toFixed(1), height: h.toFixed(1), class: s.className }));
    }
    if (i % labelEvery === 0) {
      svg.append(el('text', { x: (x + barW / 2).toFixed(1), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' }, label));
    }
  });

  // 3) Невидимые области нажатия поверх всего
  if (onSelect) {
    labels.forEach((label, i) => {
      const hit = el('rect', {
        x: slotX(i).toFixed(1),
        y: MARGIN.top,
        width: slot.toFixed(1),
        height: height - MARGIN.top,
        class: 'bar-hit',
        tabindex: 0,
        role: 'button',
        'aria-label': slotLabels[i] ?? label,
      });
      const select = () => {
        backgrounds.forEach((bg, j) => bg.setAttribute('class', j === i ? 'bar-bg selected' : 'bar-bg'));
        onSelect(i);
      };
      hit.addEventListener('click', select);
      hit.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
      svg.append(hit);
    });
  }
  container.replaceChildren(svg);
}

// Подписи к цветам: [{ label, swatch: 'swatch-fuel' }]
export function renderLegend(container, items) {
  container.replaceChildren(
    ...items.map(({ label, swatch }) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const box = document.createElement('i');
      box.className = `legend-swatch ${swatch}`;
      item.append(box, label);
      return item;
    }),
  );
}
