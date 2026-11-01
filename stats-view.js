// stats-view.js — показывает вкладку "Статистика": строки, графики и списки.
// Данные приходят готовыми из stats.js (buildStatsModel).
import { BASE_CURRENCY } from './defaults.js';
import { num, money, symbolOf } from './format.js';
import { percentChange } from './stats.js';
import { renderLineChart, renderBarChart, renderLegend } from './charts.js';

const $ = (id) => document.getElementById(id);
const symbol = symbolOf(BASE_CURRENCY);

export function readStatsPeriod() {
  return $('stats-period').value;
}
export function onStatsPeriodChange(callback) {
  $('stats-period').addEventListener('change', callback);
}
// Стрелки выбора месяца: callback получает -1 (раньше) или +1 (позже)
export function onMonthNav(callback) {
  $('month-prev').addEventListener('click', () => callback(-1));
  $('month-next').addEventListener('click', () => callback(1));
}

function box(className, text) {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Подпись сравнения: "Сентябрь 2026: 2 130 zł · +15%"
function compareLine(title, prevText, cur, prev) {
  const pct = percentChange(cur, prev);
  const diff = cur - prev;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  let change;
  if (pct !== null) change = `${sign}${num(Math.abs(Math.round(pct)))}%`;
  else change = cur > 0 ? 'раньше не было' : 'без изменений';
  return { text: `${title}: ${prevText} · ${change}`, trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

function summaryRow({ label, note, value, sub, trend, kind }) {
  const row = document.createElement('div');
  row.className = 'row stat-row';
  const name = box('stat-name');
  const title = document.createElement('span');
  title.className = 'row-label';
  title.textContent = label;
  name.append(title);
  if (note) name.append(box('stat-note', note)); // пояснение мелким шрифтом под названием
  const values = box('stat-values');
  values.append(box('stat-value', value));
  if (sub) {
    const line = box('stat-sub', sub);
    line.dataset.trend = trend;
    line.dataset.kind = kind;
    values.append(line);
  }
  row.append(name, values);
  return row;
}

function renderSummary(model) {
  const { current: cur, previous: prev } = model;
  const defs = [
    { label: 'Всего', cur: cur.total, prev: prev?.total, fmt: (v) => money(v), kind: 'expense' },
    { label: 'Топливо', cur: cur.fuel, prev: prev?.fuel, fmt: (v) => money(v), kind: 'expense' },
    { label: 'Сервис и прочее', cur: cur.other, prev: prev?.other, fmt: (v) => money(v), kind: 'expense' },
    { label: 'Пробег', cur: cur.mileage, prev: prev?.mileage, fmt: (v) => `${num(v)} км`, kind: 'distance' },
    { label: 'Стоимость 1000 км', note: 'без топлива', cur: cur.costPer1000, prev: prev?.costPer1000, fmt: (v) => money(v), kind: 'expense' },
  ];
  $('stats-summary').replaceChildren(
    ...defs.map((d) => {
      const value = d.cur == null ? '—' : d.fmt(d.cur);
      let sub = null;
      let trend = 'flat';
      if (model.previous && d.cur != null && d.prev != null) {
        ({ text: sub, trend } = compareLine(model.compareTitle, d.fmt(d.prev), d.cur, d.prev));
      }
      return summaryRow({ label: d.label, note: d.note, value, sub, trend, kind: d.kind });
    }),
  );
}

// Подсказка и подробности под графиком (появляются по нажатию на столбец)
function showHint(id) {
  const el = $(id);
  el.hidden = false;
  el.replaceChildren(box('info-hint', 'Нажмите на столбец, чтобы увидеть подробности'));
}

// rows: [{ label, value, strong? }]
function showInfo(id, title, rows) {
  const items = [box('info-title', title)];
  for (const r of rows) {
    const row = box(r.strong ? 'info-row info-strong' : 'info-row');
    row.append(box('', r.label), box('', r.value));
    items.push(row);
  }
  $(id).replaceChildren(...items);
}

function renderCharts(model) {
  const { chart } = model;
  if (chart.type === 'cumulative') {
    $('stats-chart-title').textContent = `Расходы нарастающим итогом, ${symbol}`;
    renderLineChart($('stats-chart'), {
      series: [
        { className: 'line-previous', values: chart.previous },
        { className: 'line-current', values: chart.current },
      ],
      pointsCount: Math.max(chart.previous.length, chart.current.length),
      ariaLabel: `Расходы нарастающим итогом: ${chart.currentLabel} и ${chart.previousLabel}`,
    });
    renderLegend($('stats-legend'), [
      { label: chart.currentLabel, swatch: 'swatch-current' },
      { label: chart.previousLabel, swatch: 'swatch-previous' },
    ]);
    $('stats-chart-info').hidden = true; // у линий подробностей по нажатию пока нет
    $('stats-chart2-block').hidden = true;
    return;
  }

  const unit = model.grouping === 'year' ? 'годам' : 'месяцам';
  $('stats-chart-title').textContent = `Расходы по ${unit}, ${symbol}`;
  const groups = model.groups; // столбики идут в том же порядке, что и группы
  showHint('stats-chart-info');
  renderBarChart($('stats-chart'), {
    labels: chart.labels,
    stacks: [
      { className: 'bar-fuel', values: chart.fuel },
      { className: 'bar-other', values: chart.other },
    ],
    ariaLabel: `Расходы по ${unit}: топливо и остальное`,
    slotLabels: groups.map((g) => `${g.title}: всего ${money(g.total)}`),
    onSelect: (i) => showInfo('stats-chart-info', groups[i].title, [
      { label: 'Топливо', value: money(groups[i].fuel) },
      { label: 'Сервис и прочее', value: money(groups[i].other) },
      { label: 'Всего', value: money(groups[i].total), strong: true },
    ]),
  });
  renderLegend($('stats-legend'), [
    { label: 'Топливо', swatch: 'swatch-fuel' },
    { label: 'Сервис и прочее', swatch: 'swatch-other' },
  ]);

  $('stats-chart2-block').hidden = false;
  $('stats-chart2-title').textContent = `Пробег по ${unit}, км`;
  showHint('stats-chart2-info');
  renderBarChart($('stats-chart2'), {
    labels: chart.labels,
    stacks: [{ className: 'bar-mileage', values: chart.mileage }],
    ariaLabel: `Пробег по ${unit}`,
    slotLabels: groups.map((g) => `${g.title}: пробег ${num(g.mileage)} км`),
    onSelect: (i) => showInfo('stats-chart2-info', groups[i].title, [
      { label: 'Пробег', value: `${num(groups[i].mileage)} км` },
      { label: 'Стоимость 1000 км (без топлива)', value: groups[i].costPer1000 == null ? '—' : money(groups[i].costPer1000) },
    ]),
  });
}

function renderCategories(model) {
  const list = $('stats-categories');
  list.replaceChildren();
  if (model.categories.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Расходов за период нет.';
    list.append(li);
    return;
  }
  for (const c of model.categories) {
    const li = document.createElement('li');
    const left = box('stat-cat-left');
    left.append(box('title', c.name));
    const meter = box('meter');
    const fill = document.createElement('span');
    fill.className = `meter-fill ${c.kind === 'fuel' ? 'meter-fuel' : 'meter-other'}`;
    fill.style.width = `${Math.max(2, Math.round(c.share))}%`;
    meter.append(fill);
    left.append(meter);

    const right = box('right');
    right.append(box('title', money(c.amount)), box('sub', `${num(Math.round(c.share))}%`));
    li.append(left, right);
    list.append(li);
  }
}

function renderGroups(model) {
  const visible = model.groups.filter((g) => g.total > 0 || g.mileage > 0);
  $('stats-groups-block').hidden = visible.length === 0;
  $('stats-groups-title').textContent = model.grouping === 'year' ? 'По годам' : 'По месяцам';

  const list = $('stats-groups');
  list.replaceChildren();
  for (const g of [...visible].reverse()) { // новые сверху
    const li = document.createElement('li');
    const left = box('');
    left.append(box('title', g.title), box('sub', `Топливо ${money(g.fuel)} · Остальное ${money(g.other)}`));
    const right = box('right');
    right.append(box('title', money(g.total)), box('sub', `${num(g.mileage)} км`));
    li.append(left, right);
    list.append(li);
  }
}

export function renderStatsView(model) {
  const nav = model.monthNav;
  $('month-nav').hidden = !nav;
  if (nav) {
    $('month-nav-title').textContent = nav.title;
    $('month-prev').disabled = !nav.canPrev;
    $('month-next').disabled = !nav.canNext;
  }
  $('stats-range').textContent = model.compareText ? `${model.rangeText} · ${model.compareText}` : model.rangeText;
  renderSummary(model);
  $('stats-empty').hidden = !model.isEmpty;
  $('stats-details').hidden = model.isEmpty;
  if (model.isEmpty) return;
  renderCharts(model);
  renderCategories(model);
  renderGroups(model);
}
