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

// Сравнение с прошлым периодом: { change: "▲ +15%", trend: 'up' | 'down' | 'flat' }
function compareParts(cur, prev) {
  const pct = percentChange(cur, prev);
  const diff = cur - prev;
  const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  if (pct === null) return { change: cur > 0 ? 'раньше не было' : 'без изменений', trend };
  const shown = pct !== 0 && Math.abs(pct) < 1 ? num(Math.abs(pct), 1) : num(Math.abs(Math.round(pct)));
  const arrow = diff > 0 ? '▲ +' : diff < 0 ? '▼ −' : '';
  return { change: diff === 0 ? 'без изменений' : `${arrow}${shown}%`, trend };
}

// Переключатель "100 км | 1000 км"
function unitSwitch(current, onChange) {
  const wrap = box('unit-switch');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'На сколько километров считать стоимость');
  for (const unit of [100, 1000]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'unit-btn';
    button.textContent = `${unit} км`;
    button.setAttribute('aria-pressed', String(unit === current));
    button.addEventListener('click', () => onChange(unit));
    wrap.append(button);
  }
  return wrap;
}

// Одна плитка: название, значение и сравнение с прошлым периодом
function tile(def, model, { wide, costUnit, onCostUnitChange }) {
  const el = box(`tile${wide ? ' tile-wide' : ''}${def.tone ? ` tile-${def.tone}` : ''}`);

  const main = box('tile-main');
  main.append(box('tile-label', def.label));
  if (def.unitSwitch) main.append(unitSwitch(costUnit, onCostUnitChange));

  const side = box('tile-side');
  side.append(box('tile-value', def.cur == null ? '—' : def.fmt(def.cur)));
  if (model.previous && def.cur != null && def.prev != null) {
    const { change, trend } = compareParts(def.cur, def.prev);
    const delta = box('tile-delta', change);
    delta.dataset.trend = trend;
    delta.dataset.kind = def.kind;
    side.append(delta, box('tile-prev', `${model.compareTitle}: ${def.fmt(def.prev)}`));
  }
  el.append(main, side);
  return el;
}

// Плитки по две в ряд; если их нечётное число, последняя занимает всю ширину (и ниже по высоте)
function renderSummary(model, { costUnit, onCostUnitChange }) {
  const { current: cur, previous: prev } = model;
  const per = (v) => (v == null ? null : costUnit === 100 ? v / 10 : v); // стоимость 1000 км -> на 100 км
  const defs = [
    { label: 'Всего', tone: 'total', cur: cur.total, prev: prev?.total, fmt: (v) => money(v), kind: 'expense' },
    { label: 'Топливо', tone: 'fuel', cur: cur.fuel, prev: prev?.fuel, fmt: (v) => money(v), kind: 'expense' },
    { label: 'Сервис и прочее', tone: 'other', cur: cur.other, prev: prev?.other, fmt: (v) => money(v), kind: 'expense' },
    { label: 'Пробег', tone: 'mileage', cur: cur.mileage, prev: prev?.mileage, fmt: (v) => `${num(v)} км`, kind: 'distance' },
    {
      label: 'Стоимость без топлива',
      tone: 'cost',
      cur: per(cur.costPer1000),
      prev: per(prev?.costPer1000),
      fmt: (v) => money(v, costUnit === 100 ? 2 : 0),
      kind: 'expense',
      unitSwitch: true,
    },
  ];
  const lastIsAlone = defs.length % 2 === 1;
  $('stats-summary').replaceChildren(
    ...defs.map((def, i) => tile(def, model, {
      wide: lastIsAlone && i === defs.length - 1,
      costUnit,
      onCostUnitChange,
    })),
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

// opts.costUnit — 100 или 1000 (для плитки стоимости); opts.onCostUnitChange(unit) — смена переключателя
export function renderStatsView(model, { costUnit = 1000, onCostUnitChange = () => {} } = {}) {
  const nav = model.monthNav;
  $('month-nav').hidden = !nav;
  if (nav) {
    $('month-nav-title').textContent = nav.title;
    $('month-prev').disabled = !nav.canPrev;
    $('month-next').disabled = !nav.canNext;
  }
  $('stats-range').textContent = model.compareText ? `${model.rangeText} · ${model.compareText}` : model.rangeText;
  renderSummary(model, { costUnit, onCostUnitChange });
  $('stats-empty').hidden = !model.isEmpty;
  $('stats-details').hidden = model.isEmpty;
  if (model.isEmpty) return;
  renderCharts(model);
  renderCategories(model);
  renderGroups(model);
}
