// storage.js — единственный файл, который знает, ГДЕ лежат данные.
// Остальной код вызывает только эти функции. Если позже понадобится
// синхронизация или другое хранилище, поменяется только этот файл.

// Dexie подключён в index.html и доступен как глобальный объект.
const db = new Dexie('finance_app');

// Описываем таблицы. В списке указаны только поля, по которым ищем (индексы).
// Остальные поля (amount, liters, comment...) Dexie сохранит сам.
db.version(1).stores({
  records:    '++id, section, category_id, date', // ++id = автоматический номер
  categories: '++id, section',
});

// Версия 2: добавились автокопии внутри приложения (таблица snapshots)
db.version(2).stores({
  records:    '++id, section, category_id, date',
  categories: '++id, section',
  snapshots:  '++id, createdAt',
});

// ---------- Записи ----------

// Все записи раздела (например 'car'), новые сверху.
export async function getRecords(section) {
  const list = await db.records.where('section').equals(section).toArray();
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

// Все записи всех разделов. Нужны, чтобы найти последний курс валюты:
// курс, введённый в путешествии, подходит и для автомобиля.
export async function getAllRecords() {
  return db.records.toArray();
}

// Добавить запись (без id) или обновить (с id). Возвращает id.
export async function saveRecord(record) {
  return db.records.put(record);
}

export async function deleteRecord(id) {
  return db.records.delete(id);
}

export async function clearRecords() {
  return db.records.clear();
}

// ---------- Категории ----------

export async function getCategories(section) {
  return db.categories.where('section').equals(section).toArray();
}

export async function saveCategory(category) {
  return db.categories.put(category);
}

// Заполнить категории начальными значениями, только если таблица пуста.
export async function seedCategoriesIfEmpty(defaults) {
  const count = await db.categories.count();
  if (count === 0) {
    await db.categories.bulkAdd(defaults);
  }
}

export async function deleteCategory(id) {
  return db.categories.delete(id);
}

// Сколько записей используют категорию (чтобы решить: удалить её или только скрыть)
export async function countRecordsByCategory(categoryId) {
  return db.records.where('category_id').equals(categoryId).count();
}

// ---------- Резервная копия ----------

export async function getAllCategories() {
  return db.categories.toArray();
}

// Полностью заменить данные содержимым резервной копии (всё или ничего: одной транзакцией).
// Записи и категории сохраняются с прежними id, поэтому связи между ними не теряются.
export async function replaceAllData({ categories, records }) {
  await db.transaction('rw', db.records, db.categories, async () => {
    await db.records.clear();
    await db.categories.clear();
    await db.categories.bulkAdd(categories);
    await db.records.bulkAdd(records);
  });
}

// Дата последней резервной копии нужна только для напоминания, поэтому лежит отдельно от данных
const LAST_BACKUP_KEY = 'finance_last_backup';

export function getLastBackupAt() {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

export function setLastBackupAt(isoString) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, isoString);
  } catch {
    // не страшно: просто не покажем дату последней копии
  }
}

// Добавить сразу много записей (импорт). Записи без id получают номера автоматически.
export async function addRecords(records) {
  return db.records.bulkAdd(records);
}

// ---------- Постоянное хранение ----------

// Просим браузер не очищать данные сайта сами. Возвращает true / false,
// либо null, если браузер этого не умеет.
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

// ---------- Автокопии внутри приложения ----------
const MAX_SNAPSHOTS = 10; // храним столько последних

// kind: 'daily' — копия в начале дня, 'safety' — копия перед опасным действием
export async function saveSnapshot(reason, kind = 'safety') {
  const [categories, records] = await Promise.all([db.categories.toArray(), db.records.toArray()]);
  await db.snapshots.add({
    createdAt: new Date().toISOString(),
    reason,
    kind,
    counts: { records: records.length, categories: categories.length },
    data: { categories, records },
  });
  // Удаляем самые старые, если копий стало больше лимита
  const keys = await db.snapshots.orderBy('createdAt').primaryKeys(); // от старых к новым
  const extra = keys.length - MAX_SNAPSHOTS;
  if (extra > 0) await db.snapshots.bulkDelete(keys.slice(0, extra));
}

// Все автокопии, новые сверху
export async function getSnapshots() {
  return db.snapshots.orderBy('createdAt').reverse().toArray();
}

// ---------- Мелкие настройки (для напоминаний) ----------
// Лежат в localStorage отдельно от данных: терять их не страшно.

function readMeta(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeMeta(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // не страшно
  }
}

const CHANGES_KEY = 'finance_changes_since_backup';
const SNOOZE_KEY = 'finance_remind_snooze_until';
const DAILY_KEY = 'finance_last_daily_snapshot';

// Сколько изменений данных сделано с момента последней резервной копии
export function getChangesSinceBackup() {
  return Number(readMeta(CHANGES_KEY)) || 0;
}
export function bumpChanges(count = 1) {
  writeMeta(CHANGES_KEY, String(getChangesSinceBackup() + count));
}
export function resetChanges() {
  writeMeta(CHANGES_KEY, '0');
}

// До какого момента не напоминать ("Позже")
export function getSnoozeUntil() {
  return readMeta(SNOOZE_KEY);
}
export function setSnoozeUntil(isoString) {
  writeMeta(SNOOZE_KEY, isoString);
}

// Дата (ГГГГ-ММ-ДД), когда делали автокопию "начала дня"
export function getLastDailySnapshotDay() {
  return readMeta(DAILY_KEY);
}
export function setLastDailySnapshotDay(day) {
  writeMeta(DAILY_KEY, day);
}
