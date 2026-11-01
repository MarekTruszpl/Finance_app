// app.js — точка входа: соединяет данные (storage), логику (logic) и экран (ui).
import { DEFAULT_CATEGORIES, BASE_CURRENCY, SECTIONS } from './defaults.js';
import {
  getRecords, getAllRecords, saveRecord, deleteRecord,
  getCategories, saveCategory, deleteCategory, countRecordsByCategory, seedCategoriesIfEmpty,
  getAllCategories, replaceAllData, getLastBackupAt, setLastBackupAt, addRecords, clearRecords,
  saveSnapshot, getSnapshots, requestPersistentStorage, getChangesSinceBackup, bumpChanges, resetChanges,
  getSnoozeUntil, setSnoozeUntil, getLastDailySnapshotDay, setLastDailySnapshotDay,
} from './storage.js';
import {
  today, parseNumber, validateRecord, validateCategory, getVisibleCategories,
  getLastMileage, getLastMileageForGroup, getFuelMileageInfo, getLastRate, convertToBase,
  daysSince, STALE_RATE_DAYS, buildBackup, validateBackup, buildCsv, getBackupReminder,
} from './logic.js';
import { prepareImport, describeImport } from './importer.js';
import { buildStatsModel, buildHistory, getHistoryOptions } from './stats.js';
import { fillHistoryOptions, readHistorySelection, onHistoryChange, renderHistory } from './history-view.js';
import { renderStatsView, readStatsPeriod, onStatsPeriodChange, onMonthNav } from './stats-view.js';
import * as ui from './ui.js';

const SECTION = 'car';
const MULTI_CURRENCY = SECTIONS[SECTION].multiCurrency; // для автомобиля false: только злотые
const PAGE_SIZE = 10; // сколько записей показывать сразу и по кнопке "Показать ещё"

let records = [];    // записи текущего раздела
let allRecords = []; // записи всех разделов (для поиска последнего курса)
let categories = []; // все категории раздела, включая скрытые
let editingId = null;      // id редактируемой записи; null — обычное добавление
let categoryEditor = null; // { id, used } пока открыт редактор категории; id = null для новой
let visibleCount = PAGE_SIZE;
let pendingImport = null; // { text, fileName } выбранного CSV, пока открыт предпросмотр
let importResult = null;   // результат prepareImport для предпросмотра
let allCategories = [];   // категории всех разделов (для резервной копии и CSV)
let persisted = null;     // включено ли постоянное хранение: true / false / null (браузер не сообщает)
let snapshotsOpen = false; // открыт ли список автокопий
let statsMonth = null;    // выбранный на вкладке "Статистика" месяц ('2026-09'); null — текущий
let statsModel = null;    // последние показанные данные статистики (там же доступные соседние месяцы)

const findCategory = (id) => categories.find((c) => c.id === id);
const fmt = (n) => n.toLocaleString('ru-RU');

// ---------- Обновление главного экрана ----------

// Список категорий в форме: без скрытых (кроме категории редактируемой записи)
function refreshCategorySelect() {
  const editedRecord = records.find((r) => r.id === editingId);
  const keepId = editedRecord ? editedRecord.category_id : null;
  ui.fillCategories(getVisibleCategories(categories, keepId), ui.readForm().categoryId);
}

// Строка курса: видна только в мультивалютных разделах и для валюты, отличной от базовой
function refreshRateField() {
  const form = ui.readForm();
  if (!MULTI_CURRENCY || form.currency === BASE_CURRENCY) {
    ui.showRateField(null);
    return;
  }
  ui.showRateField(form.currency);

  const last = getLastRate(form.currency, allRecords);
  const amount = parseNumber(form.amount);
  const rate = parseNumber(form.rate);
  ui.showRateInfo({
    currency: form.currency,
    last,
    stale: last !== null && daysSince(last.date) > STALE_RATE_DAYS,
    preview: !Number.isNaN(amount) && !Number.isNaN(rate) && rate > 0
      ? { amount, converted: convertToBase(amount, rate) }
      : null,
  });
}

// Пересчитать поля формы, зависящие от категории, пробега и валюты
function refreshForm() {
  const form = ui.readForm();
  const category = findCategory(form.categoryId);
  ui.showCategoryFields(category);

  // Что показывать в поле "Пробег" (серым) и под ним:
  //   топливо          -> пробег прошлой заправки (+ зелёная метка прироста)
  //   остальные        -> последний пробег среди записей не по топливу
  // При редактировании саму запись не учитываем.
  const others = records.filter((r) => r.id !== editingId);
  const lastAll = getLastMileage(others);
  const lastNonFuel = getLastMileageForGroup(others, categories, { fuel: false });
  const fuelInfo = getFuelMileageInfo({ ...form, id: editingId ?? undefined }, category, records);

  if (lastAll === null) {
    ui.showMileageInfo({ hint: 'Первая запись станет точкой отсчёта пробега', delta: null });
  } else if (category?.kind === 'fuel') {
    if (fuelInfo) {
      ui.showMileageInfo({
        hint: `Прошлая заправка: ${fmt(fuelInfo.previous)} км`,
        delta: fuelInfo.delta,
        placeholder: fuelInfo.previous,
      });
    } else {
      ui.showMileageInfo({
        hint: `Заправок ещё не было. Последний пробег: ${fmt(lastAll)} км`,
        delta: null,
        placeholder: lastAll,
      });
    }
  } else if (lastNonFuel !== null) {
    ui.showMileageInfo({
      hint: `Последний пробег: ${fmt(lastNonFuel)} км`,
      delta: null,
      placeholder: lastNonFuel,
    });
  } else {
    ui.showMileageInfo({
      hint: `Последний пробег: ${fmt(lastAll)} км`,
      delta: null,
      placeholder: lastAll,
    });
  }
  refreshRateField();
}

function renderList() {
  const nameById = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  ui.renderRecords(records.slice(0, visibleCount), nameById, {
    selectedId: editingId,
    onSelect: handleSelect,
  });
  ui.setShowMore(records.length > visibleCount);
}

// Загрузить записи из базы и обновить все экраны
async function reload() {
  allRecords = await getAllRecords();
  allCategories = await getAllCategories();
  records = await getRecords(SECTION);
  renderList();
  ui.renderStats({ lastMileage: getLastMileage(records) });
  refreshStats();
  refreshHistory();
  refreshForm();
  refreshReminder();
  refreshDataStatus();
}

// ---------- Режим редактирования записи ----------

function handleSelect(record) {
  editingId = record.id;
  refreshCategorySelect(); // чтобы скрытая категория этой записи была в списке
  ui.fillForm(record);
  ui.setEditMode(record);
  renderList(); // подсветить выбранную строку
  refreshForm();
}

function exitEditMode() {
  editingId = null;
  ui.setEditMode(null);
  ui.resetAfterSave(); // очистить поля
  ui.setDate(today());
  refreshCategorySelect();
  renderList();
  refreshForm();
}

// ---------- Действия с записями ----------

async function handleSave() {
  const form = ui.readForm();
  const category = findCategory(form.categoryId);
  const isEdit = editingId !== null;

  const input = {
    ...form,
    section: SECTION,
    currency: MULTI_CURRENCY ? form.currency : BASE_CURRENCY,
  };
  if (isEdit) input.id = editingId; // запись с id перезапишет существующую

  const result = validateRecord(input, category, records);
  ui.showErrors(result.errors);
  if (!result.ok) return;

  ui.setSaving(true);
  try {
    await ensureDailySnapshot();
    await saveRecord(result.record);
    noteChange();
    if (isEdit) exitEditMode();
    else ui.resetAfterSave();
    await reload();
    ui.showToast(isEdit ? 'Изменения сохранены' : 'Сохранено');
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось сохранить. Подробности в консоли.');
  } finally {
    ui.setSaving(false);
  }
}

async function handleDelete() {
  if (editingId === null) return;
  if (!ui.confirmAction('Удалить эту запись? Это действие нельзя отменить.')) return;

  try {
    await ensureDailySnapshot();
    await deleteRecord(editingId);
    noteChange();
    exitEditMode();
    await reload();
    ui.showToast('Запись удалена');
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось удалить. Подробности в консоли.');
  }
}

// Выбрали другую валюту: подставляем её последний курс (его можно изменить)
function handleCurrencyChange() {
  const { currency } = ui.readForm();
  const last = currency === BASE_CURRENCY ? null : getLastRate(currency, allRecords);
  ui.setRate(last ? last.rate : null);
  refreshForm();
}

// ---------- Настройки: категории ----------

function renderCategorySettings() {
  ui.renderCategoryList(categories, {
    selectedId: categoryEditor?.id ?? null,
    onSelect: handleCategorySelect,
  });
}

async function reloadCategories() {
  categories = await getCategories(SECTION);
  renderCategorySettings();
}

function closeCategoryEditor() {
  categoryEditor = null;
  ui.closeCategoryEditor();
  renderCategorySettings();
}

function openSettings() {
  closeCategoryEditor();
  ui.showScreen('settings');
}

function closeSettings() {
  closeCategoryEditor();
  refreshCategorySelect(); // категории могли измениться
  refreshForm();
  ui.showScreen('main');
}

function handleAddCategory() {
  categoryEditor = { id: null, used: 0 };
  ui.openCategoryEditor({ category: null, locked: false, actionLabel: null });
  renderCategorySettings();
}

async function handleCategorySelect(category) {
  try {
    const used = await countRecordsByCategory(category.id);
    categoryEditor = { id: category.id, used };
    ui.openCategoryEditor({
      category,
      locked: used > 0, // тип у категории с записями менять нельзя
      actionLabel: category.archived ? 'Вернуть в список' : used > 0 ? 'Скрыть категорию' : 'Удалить категорию',
    });
    renderCategorySettings();
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось открыть категорию.');
  }
}

async function handleCategorySave() {
  if (!categoryEditor) return;
  const input = { ...ui.readCategoryForm(), section: SECTION };
  if (categoryEditor.id !== null) input.id = categoryEditor.id;

  const result = validateCategory(input, categories, categoryEditor.used > 0);
  ui.showCategoryErrors(result.errors);
  if (!result.ok) return;

  try {
    await saveCategory(result.category);
    noteChange();
    await reloadCategories();
    closeCategoryEditor();
    ui.showToast('Сохранено');
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось сохранить. Подробности в консоли.');
  }
}

// Красная кнопка редактора: удалить (нет записей), скрыть (есть записи) или вернуть (скрытая)
async function handleCategoryAction() {
  const category = findCategory(categoryEditor?.id);
  if (!category) return;

  try {
    if (category.archived) {
      await saveCategory({ ...category, archived: false });
      ui.showToast('Категория возвращена в список');
    } else {
      if (categories.filter((c) => !c.archived).length <= 1) {
        ui.showToast('Нужна хотя бы одна видимая категория');
        return;
      }
      if (categoryEditor.used > 0) {
        if (!ui.confirmAction(`Скрыть «${category.name}»? Записи останутся в истории, но выбрать категорию в форме будет нельзя.`)) return;
        await saveCategory({ ...category, archived: true });
        ui.showToast('Категория скрыта');
      } else {
        if (!ui.confirmAction(`Удалить категорию «${category.name}»?`)) return;
        await deleteCategory(category.id);
        ui.showToast('Категория удалена');
      }
    }
    noteChange();
    await reloadCategories();
    closeCategoryEditor();
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось выполнить действие. Подробности в консоли.');
  }
}

// ---------- Данные: резервная копия, восстановление, CSV ----------

async function handleBackup() {
  // Данные берём из памяти, а не из базы: окно "Поделиться" на телефоне открывается только
  // сразу по касанию, а чтение базы занимает время.
  const backup = buildBackup(allCategories, allRecords);
  try {
    const saved = await ui.saveBackupFile(`finance-backup-${today()}.json`, JSON.stringify(backup, null, 2));
    if (!saved) return; // окно "Поделиться" закрыли, ничего не выбрав
    markBackupDone(backup.exportedAt);
    ui.showToast('Резервная копия сохранена');
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось создать копию. Подробности в консоли.');
  }
}

// Копия сделана: сбрасываем счётчик изменений и напоминание
function markBackupDone(isoString) {
  setLastBackupAt(isoString);
  resetChanges();
  setSnoozeUntil(null);
  refreshReminder();
  refreshDataStatus();
}

function handleCsv() {
  try {
    // '\uFEFF' в начале подсказывает таблицам, что файл в UTF-8 (иначе русские буквы ломаются)
    ui.downloadFile(`finance-${today()}.csv`, '\uFEFF' + buildCsv(allRecords, allCategories), 'text/csv;charset=utf-8');
    ui.showToast('Файл CSV скачан');
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось выгрузить. Подробности в консоли.');
  }
}

async function handleRestore(file) {
  try {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      ui.alertMessage('Не удалось прочитать файл: это не JSON-копия приложения.');
      return;
    }

    const check = validateBackup(data, { requiredSection: SECTION });
    if (!check.ok) {
      ui.alertMessage('Этот файл не подходит:\n• ' + check.errors.join('\n• '));
      return;
    }

    const when = data.exportedAt ? ` от ${new Date(data.exportedAt).toLocaleDateString('ru-RU')}` : '';
    const question = `Копия${when}: записей — ${check.summary.records}, категорий — ${check.summary.categories}.\n\n`
      + 'Все текущие данные будут заменены. Продолжить?';
    if (!ui.confirmAction(question)) return;

    await saveSnapshot('Перед восстановлением из файла', 'safety');
    await replaceAllData({ categories: data.categories, records: data.records });
    resetChanges(); // данные теперь совпадают с файлом копии
    await refreshAfterReplace();
    ui.showToast('Данные восстановлены. Прежние сохранены в автокопиях.');
  } catch (err) {
    console.error(err);
    ui.alertMessage('Не удалось восстановить данные. Текущие данные не изменены. Подробности в консоли.');
  }
}

// ---------- Импорт из CSV и очистка ----------

function closeImport() {
  pendingImport = null;
  importResult = null;
  ui.closeImportPanel();
}

// Разобрать файл заново и обновить предпросмотр (вызывается при выборе файла и смене категории)
function refreshImportPreview() {
  const result = prepareImport(pendingImport.text, {
    section: SECTION,
    categories,
    defaultCategoryId: Number(ui.readImportCategory()),
    existingRecords: records,
  });
  if (!result.ok) {
    ui.alertMessage(result.error);
    closeImport();
    return;
  }
  importResult = result;
  ui.showImportPreview({
    fileName: pendingImport.fileName,
    total: result.total,
    ready: result.ready.length,
    duplicates: result.duplicates,
    errorsCount: result.errors.length,
    details: describeImport(result),
  });
}

async function handleImportFile(file) {
  try {
    const options = getVisibleCategories(categories).filter((c) => c.kind !== 'fuel');
    if (options.length === 0) {
      ui.alertMessage('Для импорта нужна хотя бы одна категория не по топливу. Добавьте её в настройках.');
      return;
    }
    pendingImport = { text: await file.text(), fileName: file.name };
    ui.fillImportCategories(options);
    refreshImportPreview();
  } catch (err) {
    console.error(err);
    ui.alertMessage('Не удалось прочитать файл. Подробности в консоли.');
  }
}

async function handleImportConfirm() {
  if (!importResult || importResult.ready.length === 0) return;
  const count = importResult.ready.length;
  try {
    await saveSnapshot('Перед импортом из CSV', 'safety');
    await addRecords(importResult.ready);
    noteChange(count);
    closeImport();
    await reload();
    ui.showToast(`Импортировано записей: ${count}`);
  } catch (err) {
    console.error(err);
    ui.alertMessage('Не удалось сохранить записи. Подробности в консоли.');
  }
}

async function handleClearRecords() {
  if (allRecords.length === 0) {
    ui.showToast('Записей нет');
    return;
  }
  const question = `Удалить ВСЕ записи (${allRecords.length})? Категории останутся.\n\n`
    + 'Это действие нельзя отменить. Если данные нужны, сначала скачайте резервную копию.';
  if (!ui.confirmAction(question)) return;

  try {
    await saveSnapshot('Перед удалением всех записей', 'safety');
    await clearRecords();
    noteChange();
    exitEditMode();
    await reload();
    ui.showToast('Все записи удалены. Вернуть можно в «Автокопии в приложении».');
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось удалить. Подробности в консоли.');
  }
}

// ---------- Защита данных: автокопии, напоминания ----------

// Автокопия "начала дня": перед первым изменением данных за день запоминаем, как всё было.
async function ensureDailySnapshot() {
  try {
    if (allRecords.length === 0) return; // защищать пока нечего
    if (getLastDailySnapshotDay() === today()) return;
    await saveSnapshot('Автокопия в начале дня', 'daily');
    setLastDailySnapshotDay(today());
  } catch (err) {
    console.error(err); // автокопия не должна мешать сохранению записи
  }
}

// Данные изменились: запоминаем это для напоминания о резервной копии
function noteChange(count = 1) {
  bumpChanges(count);
  refreshReminder();
  refreshDataStatus();
}

function refreshReminder() {
  const snoozeUntil = getSnoozeUntil();
  const snoozed = snoozeUntil !== null && new Date(snoozeUntil) > new Date();
  ui.showBackupReminder(
    snoozed
      ? null
      : getBackupReminder({
        recordCount: allRecords.length,
        changes: getChangesSinceBackup(),
        lastBackupIso: getLastBackupAt(),
      }),
  );
}

// "Позже": не напоминаем 3 дня
function snoozeReminder() {
  setSnoozeUntil(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString());
  refreshReminder();
}

function refreshDataStatus() {
  ui.setDataStatus({ lastBackupIso: getLastBackupAt(), changes: getChangesSinceBackup(), persisted });
}

// После замены всех данных (восстановление из файла или из автокопии) обновляем экраны
async function refreshAfterReplace() {
  categories = await getCategories(SECTION);
  visibleCount = PAGE_SIZE;
  closeCategoryEditor();
  exitEditMode();
  await reload();
  if (snapshotsOpen) await showSnapshotsPanel();
}

async function showSnapshotsPanel() {
  try {
    snapshotsOpen = true;
    ui.showSnapshots(await getSnapshots(), { onSelect: handleSnapshotRestore });
  } catch (err) {
    console.error(err);
    ui.showToast('Не удалось открыть автокопии.');
  }
}

function closeSnapshotsPanel() {
  snapshotsOpen = false;
  ui.closeSnapshots();
}

async function handleSnapshotRestore(snapshot) {
  const question = `Вернуть данные к копии от ${ui.formatDateTime(snapshot.createdAt)}?\n\n`
    + `Записей в копии: ${snapshot.counts.records}. Текущие данные будут заменены, но перед этим `
    + 'приложение сохранит ещё одну автокопию.';
  if (!ui.confirmAction(question)) return;

  try {
    await saveSnapshot('Перед возвратом к автокопии', 'safety');
    await replaceAllData(snapshot.data);
    noteChange();
    await refreshAfterReplace();
    ui.showToast('Данные возвращены');
  } catch (err) {
    console.error(err);
    ui.alertMessage('Не удалось вернуть данные. Подробности в консоли.');
  }
}

// ---------- Статистика ----------

function refreshStats() {
  statsModel = buildStatsModel({ kind: readStatsPeriod(), month: statsMonth, records, categories, today: today() });
  renderStatsView(statsModel);
}

// Сменили период: возвращаемся к текущему месяцу
function handleStatsPeriodChange() {
  statsMonth = null;
  refreshStats();
}

// Стрелки: -1 — предыдущий месяц, +1 — следующий
function handleMonthNav(direction) {
  const nav = statsModel?.monthNav;
  const target = direction < 0 ? nav?.prevMonth : nav?.nextMonth;
  const allowed = direction < 0 ? nav?.canPrev : nav?.canNext;
  if (!target || !allowed) return;
  statsMonth = target;
  refreshStats();
}

// ---------- Журнал ----------

// Журнал: всё, что внесено в категории, кроме топлива, от старых записей к новым
function refreshHistory({ rebuildOptions = true } = {}) {
  let selection = readHistorySelection() || 'all';
  if (rebuildOptions) {
    const options = getHistoryOptions(categories, records);
    if (!options.some((o) => o.value === selection)) selection = 'all';
    fillHistoryOptions(options, selection);
  }
  renderHistory(buildHistory({ records, categories, selection }), { onSelect: handleHistorySelect });
}

// Нажали на запись в журнале: открываем её на редактирование во вкладке "Ввод"
function handleHistorySelect(record) {
  ui.showTab('entry');
  handleSelect(record);
}

// ---------- Работа без интернета ----------

// Service worker хранит копию приложения на устройстве. Работает только по https или на localhost.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./service-worker.js').catch((err) => {
    console.error('Не удалось подключить работу без интернета:', err);
  });
}

// ---------- Запуск ----------

(async function start() {
  try {
    ui.initTabs();
    await seedCategoriesIfEmpty(DEFAULT_CATEGORIES);
    categories = await getCategories(SECTION);

    ui.fillCategories(getVisibleCategories(categories));
    ui.fillCurrencies();
    ui.setCurrencyEnabled(MULTI_CURRENCY);
    ui.setDate(today());

    ui.initNumberFormatting(); // деление на разряды при вводе

    // Главный экран
    ui.onFormChange(refreshForm);
    ui.onCurrencyChange(handleCurrencyChange);
    ui.onSubmit(handleSave);
    ui.onCancelEdit(exitEditMode);
    ui.onDelete(handleDelete);
    ui.onShowMore(() => {
      visibleCount += PAGE_SIZE;
      renderList();
    });

    // Настройки
    ui.onOpenSettings(openSettings);
    ui.onCloseSettings(closeSettings);
    ui.onAddCategory(handleAddCategory);
    ui.onCategorySubmit(handleCategorySave);
    ui.onCategoryCancel(closeCategoryEditor);
    ui.onCategoryAction(handleCategoryAction);
    renderCategorySettings();

    // Данные
    ui.onExportBackup(handleBackup);
    ui.onExportCsv(handleCsv);
    ui.onRestoreFile(handleRestore);
    ui.onOpenSnapshots(showSnapshotsPanel);
    ui.onCloseSnapshots(closeSnapshotsPanel);
    ui.onImportFile(handleImportFile);
    ui.onImportCategoryChange(refreshImportPreview);
    ui.onImportConfirm(handleImportConfirm);
    ui.onImportCancel(closeImport);
    ui.onClearRecords(handleClearRecords);

    onStatsPeriodChange(handleStatsPeriodChange); // вкладка "Статистика"
    onMonthNav(handleMonthNav);
    onHistoryChange(() => refreshHistory({ rebuildOptions: false }));

    // Напоминание о копии
    ui.onReminderSave(handleBackup);
    ui.onReminderLater(snoozeReminder);

    persisted = await requestPersistentStorage(); // просим браузер не очищать данные
    await reload();
    registerServiceWorker();
  } catch (err) {
    console.error(err);
    ui.showFatalError('Не удалось запустить хранилище: ' + err.message);
  }
})();
