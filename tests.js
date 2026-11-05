// tests.js — проверки для logic.js.
// Запуск: откройте tests.html через Live Server (результат на странице и в консоли).
import {
  parseNumber, validateRecord, getTotalMileage, getLastMileage, getFuelMileageInfo,
  getLastRate, convertToBase, daysSince, validateCategory, describeMissingFields, getVisibleCategories, formatNumberInput,
  getLastMileageForGroup, buildBackup, validateBackup, buildCsv, getBackupReminder, localDateOf,
} from './logic.js';
import { parseCsv, normalizeNumberText, parseDateText, prepareImport, describeImport } from './importer.js';
import {
  niceScale, percentChange, getPeriod, groupRanges, getMileageDriven, summarize,
  cumulativeByDay, byCategory, buildStatsModel, shiftMonth, getHistoryOptions, buildHistory,
} from './stats.js';
import { decideScreenSwipe, neighborTab } from './swipe.js';
import { parseReceipt } from './receipt.js';
import { fitSize, enhanceGray, describeOcrStatus, describeOcrError, OcrError } from './ocr.js';

const results = [];
const check = (name, condition) => results.push({ name, ok: Boolean(condition) });

// Тестовые данные
const fuel = { id: 1, kind: 'fuel' };
const repair = { id: 2, kind: 'regular' };
const saved = [
  { id: 1, date: '2026-01-10', mileage: 100000 },
  { id: 2, date: '2026-02-10', mileage: 100500 },
];
const base = { section: 'car', date: '2026-03-01', mileage: '101000', amount: '3200', liters: '50', comment: '' };

// parseNumber
check('parseNumber: запятая "45,5" -> 45.5', parseNumber('45,5') === 45.5);
check('parseNumber: буквы -> NaN', Number.isNaN(parseNumber('abc')));
check('parseNumber: минус -> NaN', Number.isNaN(parseNumber('-5')));
check('parseNumber: пустая строка -> NaN', Number.isNaN(parseNumber('')));

// Топливо
const okFuel = validateRecord(base, fuel, saved);
check('топливо: корректная запись проходит', okFuel.ok);
check('топливо: числа сохраняются числами', okFuel.record.mileage === 101000 && okFuel.record.liters === 50);
check('топливо: без литров -> ошибка', validateRecord({ ...base, liters: '' }, fuel, saved).errors.liters);
check('топливо: литры 0 -> ошибка', validateRecord({ ...base, liters: '0' }, fuel, saved).errors.liters);

// Не топливо
const okRepair = validateRecord({ ...base, liters: '', comment: ' Замена колодок ' }, repair, saved);
check('ремонт: литры не нужны', okRepair.ok && okRepair.record.liters === null);
check('ремонт: комментарий обрезает пробелы', okRepair.record.comment === 'Замена колодок');
check('ремонт: длинный комментарий -> ошибка', validateRecord({ ...base, comment: 'я'.repeat(201) }, repair, saved).errors.comment);

// Сумма, дата, категория
check('сумма 0 -> ошибка', validateRecord({ ...base, amount: '0' }, fuel, saved).errors.amount);
check('сумма текстом -> ошибка', validateRecord({ ...base, amount: 'много' }, fuel, saved).errors.amount);
check('дата в будущем -> ошибка', validateRecord({ ...base, date: '2999-01-01' }, fuel, saved).errors.date);
check('несуществующая дата -> ошибка', validateRecord({ ...base, date: '2026-02-30' }, fuel, saved).errors.date);
check('категория не выбрана -> ошибка', validateRecord(base, null, saved).errors.category);

// Пробег
check('пробег меньше предыдущего -> ошибка', validateRecord({ ...base, mileage: '100400' }, fuel, saved).errors.mileage);
check('пробег дробный -> ошибка', validateRecord({ ...base, mileage: '101000.5' }, fuel, saved).errors.mileage);
check('запись "задним числом" между соседями проходит', validateRecord({ ...base, date: '2026-01-20', mileage: '100200' }, fuel, saved).ok);
check('задним числом, но больше следующей записи -> ошибка', validateRecord({ ...base, date: '2026-01-20', mileage: '100900' }, fuel, saved).errors.mileage);
check('редактирование: запись не конфликтует сама с собой', validateRecord({ ...base, id: 2, date: '2026-02-10', mileage: '100500' }, fuel, saved).ok);

// Подсчёт пробега
check('общий пробег: нет записей -> 0', getTotalMileage([]) === 0);
check('общий пробег: одна запись -> 0', getTotalMileage([{ mileage: 100000 }]) === 0);
check('общий пробег: max - min', getTotalMileage(saved) === 500);
check('последний пробег', getLastMileage(saved) === 100500 && getLastMileage([]) === null);


// Валюта
check('валюта по умолчанию: PLN', okFuel.record.currency === 'PLN');
check('валюта передаётся из формы', validateRecord({ ...base, currency: 'EUR', rate: '4,3' }, fuel, saved).record.currency === 'EUR');

// Подсказка "+N км" для топлива
const mixed = [
  { id: 1, date: '2026-01-10', category_id: 1, mileage: 100000 }, // заправка
  { id: 2, date: '2026-01-15', category_id: 2, mileage: 100300 }, // ремонт
  { id: 3, date: '2026-02-10', category_id: 1, mileage: 100500 }, // заправка
];
const info = getFuelMileageInfo({ date: '2026-03-01', mileage: '101000' }, fuel, mixed);
check('подсказка: +500 от прошлой заправки', info && info.previous === 100500 && info.delta === 500);
check('подсказка: ремонт не считается заправкой', getFuelMileageInfo({ date: '2026-01-20', mileage: '100400' }, fuel, mixed).previous === 100000);
check('подсказка: не топливо -> null', getFuelMileageInfo({ date: '2026-03-01', mileage: '101000' }, repair, mixed) === null);
check('подсказка: заправок нет -> null', getFuelMileageInfo({ date: '2026-03-01', mileage: '101000' }, fuel, []) === null);
check('подсказка: пробег не введён -> delta null', getFuelMileageInfo({ date: '2026-03-01', mileage: '' }, fuel, mixed).delta === null);

// Курс и валюта
check('PLN: курс 1, сумма в базовой = сумма', okFuel.record.rate === 1 && okFuel.record.amount_base === 3200);
const usd = validateRecord({ ...base, currency: 'USD', amount: '100', rate: '3,9' }, fuel, saved);
check('USD: сохраняется в долларах', usd.ok && usd.record.currency === 'USD' && usd.record.amount === 100);
check('USD: курс 3,9 и пересчёт в злоты 390', usd.record.rate === 3.9 && usd.record.amount_base === 390);
check('USD без курса -> ошибка', validateRecord({ ...base, currency: 'USD', rate: '' }, fuel, saved).errors.rate);
check('USD курс 0 -> ошибка', validateRecord({ ...base, currency: 'USD', rate: '0' }, fuel, saved).errors.rate);
check('USD курс текстом -> ошибка', validateRecord({ ...base, currency: 'USD', rate: 'abc' }, fuel, saved).errors.rate);
check('PLN: введённый курс игнорируется', validateRecord({ ...base, currency: 'PLN', rate: 'abc' }, fuel, saved).record.rate === 1);
check('convertToBase округляет до копеек', convertToBase(33.33, 3.9) === 129.99);

const rated = [
  { id: 1, date: '2026-03-05', currency: 'USD', rate: 3.9 },
  { id: 2, date: '2026-03-07', currency: 'USD', rate: 4 },
  { id: 3, date: '2026-03-06', currency: 'EUR', rate: 4.3 },
  { id: 4, date: '2026-03-07', currency: 'USD', rate: 4.1 },
  { id: 5, date: '2026-03-01', currency: 'PLN' },
];
check('последний курс: берём самую позднюю дату', getLastRate('EUR', rated).rate === 4.3);
check('последний курс: при равной дате — более новая запись', getLastRate('USD', rated).rate === 4.1);
check('последний курс: дата возвращается', getLastRate('USD', rated).date === '2026-03-07');
check('последний курс: валюты ещё не было -> null', getLastRate('GBP', rated) === null);
check('daysSince: 30 дней', daysSince('2026-01-01', new Date(2026, 0, 31)) === 30);

// Редактирование
check('редактирование: id сохраняется в записи', validateRecord({ ...base, id: 2, date: '2026-02-10', mileage: '100500' }, fuel, saved).record.id === 2);
check('редактирование: нельзя превысить пробег следующей записи', validateRecord({ ...base, id: 1, date: '2026-01-10', mileage: '100600' }, fuel, saved).errors.mileage);
const editInfo = getFuelMileageInfo({ id: 3, date: '2026-02-10', mileage: '100600' }, fuel, mixed);
check('редактирование: заправка не сравнивается сама с собой', editInfo.previous === 100000 && editInfo.delta === 600);

// Категории
const cats = [
  { id: 1, section: 'car', name: 'Топливо', kind: 'fuel' },
  { id: 2, section: 'car', name: 'Ремонт', kind: 'regular', archived: true },
];
const newCat = validateCategory({ section: 'car', name: '  Мойка   авто ', kind: 'regular' }, cats);
check('категория: новая проходит, пробелы убираются', newCat.ok && newCat.category.name === 'Мойка авто' && newCat.category.archived === false);
check('категория: пустое название -> ошибка', validateCategory({ section: 'car', name: '  ', kind: 'regular' }, cats).errors.name);
check('категория: название длиннее 40 -> ошибка', validateCategory({ section: 'car', name: 'я'.repeat(41), kind: 'regular' }, cats).errors.name);
check('категория: повтор названия без учёта регистра -> ошибка', validateCategory({ section: 'car', name: 'ТОПЛИВО', kind: 'regular' }, cats).errors.name);
check('категория: своё же название при редактировании ок', validateCategory({ id: 1, section: 'car', name: 'Топливо', kind: 'fuel' }, cats, true).ok);
check('категория: неизвестный тип -> ошибка', validateCategory({ section: 'car', name: 'Х', kind: 'other' }, cats).errors.kind);
check('категория: тип с записями менять нельзя', validateCategory({ id: 1, section: 'car', name: 'Топливо', kind: 'regular' }, cats, true).errors.kind);
check('категория: тип без записей менять можно', validateCategory({ id: 1, section: 'car', name: 'Топливо', kind: 'regular' }, cats, false).ok);
check('категория: признак "скрыта" сохраняется', validateCategory({ id: 2, section: 'car', name: 'Ремонт 2', kind: 'regular' }, cats).category.archived === true);
check('видимые категории: скрытые не показываются', getVisibleCategories(cats).length === 1);
check('видимые категории: нужная скрытая остаётся', getVisibleCategories(cats, 2).length === 2);

// Деление на разряды при вводе
const NB = '\u00A0';
check('разряды: 100500 -> "100 500"', formatNumberInput('100500') === `100${NB}500`);
check('разряды: 1234567 -> "1 234 567"', formatNumberInput('1234567') === `1${NB}234${NB}567`);
check('разряды: короткое число без изменений', formatNumberInput('999') === '999');
check('разряды: буквы убираются', formatNumberInput('12ab3') === '123');
check('разряды: целое поле убирает запятую', formatNumberInput('12,5') === '125');
check('разряды: дробная часть "1234,5"', formatNumberInput('1234,5', { decimals: 2 }) === `1${NB}234,5`);
check('разряды: точка превращается в запятую', formatNumberInput('1234.5', { decimals: 2 }) === `1${NB}234,5`);
check('разряды: не больше 2 знаков после запятой', formatNumberInput('1,2345', { decimals: 2 }) === '1,23');
check('разряды: ",5" -> "0,5"', formatNumberInput(',5', { decimals: 2 }) === '0,5');
check('разряды: запятая в конце сохраняется', formatNumberInput('5,', { decimals: 2 }) === '5,');
check('разряды: ведущие нули убираются', formatNumberInput('007') === '7');
check('разряды: пустая строка', formatNumberInput('') === '');
check('parseNumber: понимает пробел-разряд', parseNumber(`100${NB}500`) === 100500 && parseNumber('1 234,5') === 1234.5);
check('parseNumber: узкий неразрывный пробел', parseNumber('1\u202F234') === 1234);
check('валидация принимает отформатированный пробег', validateRecord({ ...base, mileage: `101${NB}000`, amount: `3${NB}200` }, fuel, saved).ok);

// Последний пробег по группам (топливо / остальные)
const groupCats = [{ id: 1, kind: 'fuel' }, { id: 2, kind: 'regular' }];
const groupRecs = [
  { id: 1, category_id: 1, mileage: 102800 },
  { id: 2, category_id: 2, mileage: 98000 },
  { id: 3, category_id: 2, mileage: 99000 },
];
check('группа топливо: 102800', getLastMileageForGroup(groupRecs, groupCats, { fuel: true }) === 102800);
check('группа не топливо: 99000', getLastMileageForGroup(groupRecs, groupCats, { fuel: false }) === 99000);
check('группа без записей -> null', getLastMileageForGroup([groupRecs[0]], groupCats, { fuel: false }) === null);

// Резервная копия
const bCats = [{ id: 1, section: 'car', name: 'Топливо', kind: 'fuel' }, { id: 2, section: 'car', name: 'Ремонт', kind: 'regular' }];
const bRecs = [
  { id: 1, section: 'car', date: '2026-03-01', category_id: 1, mileage: 100000, amount: 3200.5, liters: 50, comment: '', currency: 'PLN', rate: 1, amount_base: 3200.5 },
  { id: 2, section: 'car', date: '2026-02-10', category_id: 2, mileage: 99000, amount: 150, liters: null, comment: 'Масло; фильтр "Mann"' },
  { id: 3, section: 'car', date: '2026-02-11', category_id: 2, mileage: 99100, amount: 20, liters: null, comment: '=1+1' },
];
const backup = buildBackup(bCats, bRecs, new Date('2026-10-31T10:00:00Z'));
check('копия: служебные поля', backup.app === 'finance-app' && backup.schemaVersion === 1 && backup.exportedAt === '2026-10-31T10:00:00.000Z');
check('копия: после JSON проходит проверку', validateBackup(JSON.parse(JSON.stringify(backup)), { requiredSection: 'car' }).ok);
check('копия: сводка', validateBackup(backup).summary.records === 3);
check('копия: чужой файл -> ошибка', !validateBackup({ hello: 1 }).ok);
check('копия: более новая версия -> ошибка', !validateBackup({ ...backup, schemaVersion: 99 }).ok);
check('копия: запись с неизвестной категорией -> ошибка', !validateBackup({ ...backup, records: [{ ...bRecs[0], category_id: 77 }] }).ok);
check('копия: плохая дата -> ошибка', !validateBackup({ ...backup, records: [{ ...bRecs[0], date: '2026-02-30' }] }).ok);
check('копия: повтор id -> ошибка', !validateBackup({ ...backup, records: [bRecs[0], bRecs[0]] }).ok);
check('копия: нет категорий нужного раздела -> ошибка', !validateBackup(backup, { requiredSection: 'travel' }).ok);
check('копия: пустые категории -> ошибка', !validateBackup({ ...backup, categories: [], records: [] }).ok);

// CSV
const csv = buildCsv(bRecs, bCats).split('\r\n');
check('csv: заголовок', csv[0] === 'Раздел;Дата;Категория;Пробег;Сумма;Валюта;Курс;Сумма в zł;Литры;Комментарий');
check('csv: сортировка по дате', csv[1].includes('2026-02-10') && csv[3].includes('2026-03-01'));
check('csv: запятая вместо точки, пустой комментарий', csv[3] === 'Автомобиль;2026-03-01;Топливо;100000;3200,5;PLN;1;3200,5;50;');
check('csv: ; и кавычки в комментарии экранируются', csv[1].endsWith('"Масло; фильтр ""Mann"""'));
check('csv: формула в комментарии обезврежена', csv[2].endsWith("'=1+1"));

// Импорт из CSV (формат вашей таблицы: пустой столбец A, заголовки Data / Koszt / Przebieg)
check('csv-разбор: кавычки и перенос строки в ячейке', JSON.stringify(parseCsv('a,"b\nc",d')) === JSON.stringify([['a', 'b\nc', 'd']]));
check('csv-разбор: "" внутри кавычек', parseCsv('"он сказал ""да""",x')[0][0] === 'он сказал "да"');
check('csv-разбор: BOM убирается', parseCsv('\uFEFFa,b')[0][0] === 'a');
check('число из таблицы: "200 zł"', normalizeNumberText('200 zł') === '200');
check('число из таблицы: "1 200,50 zł"', normalizeNumberText('1 200,50 zł') === '1200.50');
check('число из таблицы: "123.000" (разряды)', normalizeNumberText('123.000') === '123000');
check('число из таблицы: "1.234,56"', normalizeNumberText('1.234,56') === '1234.56');
check('число из таблицы: "1,234.56"', normalizeNumberText('1,234.56') === '1234.56');
check('число из таблицы: "0,500" — дробь', normalizeNumberText('0,500') === '0.500');
check('число из таблицы: без цифр -> пусто', normalizeNumberText('abc') === '');
check('число из таблицы: минус сохраняется', normalizeNumberText('-50 zł') === '-50');
check('дата: 14.03.2025', parseDateText('14.03.2025') === '2025-03-14');
check('дата: 5.6.25', parseDateText('5.6.25') === '2025-06-05');
check('дата: ГГГГ-ММ-ДД', parseDateText('2025-03-14') === '2025-03-14');
check('дата: 31.02.2025 -> null', parseDateText('31.02.2025') === null);
check('дата: текст -> null', parseDateText('abc') === null);

const importCats = [
  { id: 1, section: 'car', name: 'Топливо', kind: 'fuel' },
  { id: 2, section: 'car', name: 'Ремонт', kind: 'regular' },
  { id: 3, section: 'car', name: 'Шины и диски', kind: 'regular' },
];
const importOpts = { section: 'car', categories: importCats, defaultCategoryId: 2, existingRecords: [] };
const sheetCsv = [
  ',,,"9 999 zł",',
  ',Data,,Koszt,Przebieg',
  ',14.03.2025,Wymiana filtra,200 zł,123 000',
  ',14.03.2025,Wymiana uszczelki,100 zł,123 000',
  ',10.04.2025,"Olej, filtr","1 250 zł","246 100"',
  ',01.05.2025,Opony,"1 200,50 zł","247 000"',
  ',,,,',
  ',,Razem,,',
].join('\n');
const imp = prepareImport(sheetCsv, importOpts);
check('импорт: таблица и колонки распознаны', imp.ok && imp.columns.date === 1 && imp.columns.comment === 2 && imp.columns.amount === 3 && imp.columns.mileage === 4);
check('импорт: 4 записи готовы, ошибок нет', imp.ready.length === 4 && imp.errors.length === 0 && imp.total === 4);
check('импорт: итоговая строка пропущена', imp.skipped === 1);
const firstImported = imp.ready[0];
check('импорт: поля записи', firstImported.date === '2025-03-14' && firstImported.amount === 200 && firstImported.mileage === 123000
  && firstImported.comment === 'Wymiana filtra' && firstImported.category_id === 2 && firstImported.section === 'car'
  && firstImported.currency === 'PLN' && firstImported.amount_base === 200);
check('импорт: запятая внутри кавычек не ломает колонки', imp.ready.some((r) => r.comment === 'Olej, filtr' && r.amount === 1250));
check('импорт: "1 200,50 zł" = 1200.5', imp.ready.some((r) => r.amount === 1200.5));
const again = prepareImport(sheetCsv, { ...importOpts, existingRecords: imp.ready.map((r, i) => ({ ...r, id: i + 1 })) });
check('импорт: повторный импорт — всё дубликаты', again.ready.length === 0 && again.duplicates === 4);
const bad = prepareImport(sheetCsv + '\n,02.05.2025,Ошибка,50 zł,100\n,31.02.2025,Плохая дата,50 zł,300 000\n,03.05.2025,Без пробега,50 zł,', importOpts);
check('импорт: хорошие записи остаются, 3 строки с ошибками', bad.ready.length === 4 && bad.errors.length === 3);
check('импорт: ошибка пробега указывает строку', bad.errors.some((e) => e.startsWith('Строка 9') && e.includes('Пробег')));
check('импорт: ошибка даты указывает строку', bad.errors.some((e) => e.startsWith('Строка 10') && e.includes('Дата')));
const semi = prepareImport('Data;Opis;Koszt;Przebieg\n14.03.2025;Test;"200,50 zł";123000', importOpts);
check('импорт: разделитель ";" определяется сам', semi.ok && semi.ready.length === 1 && semi.ready[0].amount === 200.5 && semi.ready[0].comment === 'Test');
const ru = prepareImport('Дата,Описание,Сумма,Пробег\n14.03.2025,Масло,150,123000', importOpts);
check('импорт: русские заголовки', ru.ok && ru.ready.length === 1 && ru.ready[0].comment === 'Масло');
const withCat = prepareImport('Data,Kategoria,Koszt,Przebieg\n14.03.2025,Шины и диски,400,123000\n15.03.2025,Неизвестная,10,123001\n16.03.2025,Топливо,20,123002', importOpts);
check('импорт: категория из файла по названию', withCat.ready[0].category_id === 3);
check('импорт: неизвестная категория и топливо -> по умолчанию', withCat.ready[1].category_id === 2 && withCat.ready[2].category_id === 2);
check('импорт: нет заголовков -> ошибка', prepareImport('a,b\n1,2', importOpts).ok === false);
check('импорт: описание содержит колонки и пропуск', describeImport(imp).includes('сумма — D') && describeImport(imp).includes('Пропущено'));

// Напоминание о резервной копии
const remindNow = new Date(2026, 9, 31, 12, 0);
const freshIso = new Date(2026, 9, 25, 12).toISOString();
const staleIso = new Date(2026, 9, 10, 12).toISOString();
check('напоминание: записей нет -> нет', getBackupReminder({ recordCount: 0, changes: 5, lastBackupIso: null, now: remindNow }) === null);
check('напоминание: записи есть, копий не было', getBackupReminder({ recordCount: 3, changes: 0, lastBackupIso: null, now: remindNow }).reason === 'never');
check('напоминание: свежая копия, мало изменений -> нет', getBackupReminder({ recordCount: 3, changes: 3, lastBackupIso: freshIso, now: remindNow }) === null);
check('напоминание: 10 изменений', getBackupReminder({ recordCount: 30, changes: 10, lastBackupIso: freshIso, now: remindNow }).reason === 'changes');
const byDays = getBackupReminder({ recordCount: 30, changes: 1, lastBackupIso: staleIso, now: remindNow });
check('напоминание: давно не делали и есть изменения', byDays.reason === 'days' && byDays.days === 21);
check('напоминание: давно, но изменений нет -> нет', getBackupReminder({ recordCount: 30, changes: 0, lastBackupIso: staleIso, now: remindNow }) === null);
check('localDateOf: местная дата метки времени', localDateOf(new Date(2026, 9, 31, 23, 30).toISOString()) === '2026-10-31');

// Статистика
check('niceScale: 870 -> 1000 с шагом 250', niceScale(870).max === 1000 && niceScale(870).step === 250);
check('niceScale: 1234 -> 1500', niceScale(1234).max === 1500);
check('niceScale: ноль не ломается', niceScale(0).max > 0);
check('percentChange: 500 к 800 = -37,5', percentChange(500, 800) === -37.5);
check('percentChange: раньше было 0 -> null', percentChange(5, 0) === null);

const pm = getPeriod('month', '2026-10-15');
check('период "месяц": с 1 по 15 число', pm.from === '2026-10-01' && pm.to === '2026-10-15');
check('сравнение: с 1 по 15 число прошлого месяца', pm.compare.from === '2026-09-01' && pm.compare.to === '2026-09-15');
check('сравнение 31 марта -> до 28 февраля', getPeriod('month', '2026-03-31').compare.to === '2026-02-28');
check('сравнение в январе -> декабрь прошлого года', getPeriod('month', '2026-01-15').compare.from === '2025-12-01' && getPeriod('month', '2026-01-15').compare.to === '2025-12-15');
const py = getPeriod('year', '2026-10-15');
check('период "год": с 1 января по сегодня, сравнение с тем же отрезком прошлого года',
  py.from === '2026-01-01' && py.to === '2026-10-15' && py.compare.from === '2025-01-01' && py.compare.to === '2025-10-15');
check('год: 29 февраля сравнивается с 28 февраля', getPeriod('year', '2028-02-29').compare.to === '2027-02-28');
const pl = getPeriod('lastYear', '2026-10-15');
check('период "прошлый год"', pl.from === '2025-01-01' && pl.to === '2025-12-31' && pl.compare === null);
check('всё время: до 24 месяцев — по месяцам', getPeriod('all', '2026-10-15', { firstDate: '2025-03-14' }).grouping === 'month');
check('всё время: больше 2 лет — по годам', getPeriod('all', '2026-10-15', { firstDate: '2023-01-01' }).grouping === 'year');
check('группы по годам: 2023–2026 = 4', groupRanges('year', '2023-01-01', '2026-10-15').length === 4);
const gm = groupRanges('month', '2026-09-05', '2026-10-15');
check('группы по месяцам: границы обрезаются по периоду', gm.length === 2 && gm[0].from === '2026-09-05' && gm[0].to === '2026-09-30' && gm[1].to === '2026-10-15');
check('группы по месяцам: подписи', gm[0].label === 'сен' && gm[1].label === 'окт');
check('группы за прошлый год: 12 месяцев', groupRanges('month', '2025-01-01', '2025-12-31').length === 12);

const sCats = [{ id: 1, name: 'Топливо', kind: 'fuel' }, { id: 2, name: 'Ремонт', kind: 'regular' }];
const sRecs = [
  { id: 1, date: '2026-09-05', category_id: 1, mileage: 100000, amount: 300 },
  { id: 2, date: '2026-09-12', category_id: 2, mileage: 100300, amount: 500 },
  { id: 3, date: '2026-09-28', category_id: 1, mileage: 100900, amount: 250 },
  { id: 4, date: '2026-10-03', category_id: 1, mileage: 101200, amount: 320 },
  { id: 5, date: '2026-10-10', category_id: 2, mileage: 101500, amount: 180 },
];
const sKind = { 1: 'fuel', 2: 'regular' };
check('пробег за период: от последней записи до периода', getMileageDriven(sRecs, '2026-10-01', '2026-10-15') === 600);
check('пробег за период: первая запись — точка отсчёта', getMileageDriven(sRecs, '2026-09-01', '2026-09-15') === 300);
check('пробег за весь период', getMileageDriven(sRecs, '2000-01-01', '2026-12-31') === 1500);
check('пробег за пустой период = 0', getMileageDriven(sRecs, '2026-11-01', '2026-11-30') === 0);
const sOct = summarize(sRecs, sKind, { from: '2026-10-01', to: '2026-10-15' });
check('итоги месяца: топливо, остальное, всего', sOct.fuel === 320 && sOct.other === 180 && sOct.total === 500 && sOct.count === 2);
check('итоги месяца: стоимость 1000 км без топлива (180 zł на 600 км = 300)', Math.abs(sOct.costPer1000 - 300) < 1e-9);
check('итоги: без пробега стоимость 1000 км не считается', summarize([], sKind, { from: '2026-10-01', to: '2026-10-31' }).costPer1000 === null);
check('итоги: сумма берётся в злотых (amount_base)', summarize([{ id: 9, date: '2026-10-01', category_id: 2, mileage: 1, amount: 100, amount_base: 390 }], sKind, { from: '2026-10-01', to: '2026-10-31' }).other === 390);
const cum = cumulativeByDay(sRecs, 2026, 10, 15);
check('нарастающим итогом: октябрь', cum.length === 15 && cum[2] === 320 && cum[9] === 500 && cum[14] === 500);
const cumPrev = cumulativeByDay(sRecs, 2026, 9, 30);
check('нарастающим итогом: сентябрь', cumPrev.length === 30 && cumPrev[4] === 300 && cumPrev[11] === 800 && cumPrev[29] === 1050);
const statCats = byCategory(sRecs, sCats, { from: '2026-10-01', to: '2026-10-15' });
check('по категориям: сортировка и доли', statCats.length === 2 && statCats[0].name === 'Топливо' && Math.round(statCats[0].share) === 64 && Math.round(statCats[1].share) === 36);

const mMonth = buildStatsModel({ kind: 'month', records: sRecs, categories: sCats, today: '2026-10-15' });
check('модель "месяц": текущий и прошлый', mMonth.current.total === 500 && mMonth.previous.total === 800 && mMonth.previous.mileage === 300);
check('модель "месяц": график нарастающим итогом', mMonth.chart.type === 'cumulative' && mMonth.chart.current.length === 15 && mMonth.chart.previous.length === 30);
check('модель "месяц": подписи периода', mMonth.rangeText === '1–15 октября 2026' && mMonth.compareText === 'Сравнение: 1–15 сентября 2026');
const mYear = buildStatsModel({ kind: 'year', records: sRecs, categories: sCats, today: '2026-10-15' });
check('модель "год": 10 месяцев, сентябрь и октябрь', mYear.groups.length === 10 && mYear.groups[8].total === 1050 && mYear.groups[8].mileage === 900 && mYear.groups[9].total === 500 && mYear.groups[9].mileage === 600);
check('модель "год": пробег за год', mYear.current.mileage === 1500 && mYear.chart.type === 'bars');
const mLast = buildStatsModel({ kind: 'lastYear', records: sRecs, categories: sCats, today: '2026-10-15' });
check('модель "прошлый год": 12 месяцев, данных нет', mLast.groups.length === 12 && mLast.isEmpty === true);
const mAll = buildStatsModel({ kind: 'all', records: sRecs, categories: sCats, today: '2026-10-15' });
check('модель "всё время": по месяцам, 2 столбика', mAll.grouping === 'month' && mAll.chart.labels.join() === 'сен,окт' && mAll.current.total === 1550);
check('модель "всё время" без записей', buildStatsModel({ kind: 'all', records: [], categories: sCats, today: '2026-10-15' }).isEmpty === true);

// Выбор месяца
const pSep = getPeriod('month', '2026-10-15', { month: '2026-09' });
check('выбор месяца: прошедший месяц целиком', pSep.from === '2026-09-01' && pSep.to === '2026-09-30' && pSep.title === 'Сентябрь 2026');
check('выбор месяца: сравнение с предыдущим целиком', pSep.compare.from === '2026-08-01' && pSep.compare.to === '2026-08-31');
check('выбор месяца: текущий месяц как и раньше', getPeriod('month', '2026-10-15', { month: '2026-10' }).to === '2026-10-15');
check('выбор месяца: будущий месяц заменяется текущим', getPeriod('month', '2026-10-15', { month: '2027-03' }).from === '2026-10-01');
check('выбор месяца: январь сравнивается с декабрём', getPeriod('month', '2026-10-15', { month: '2026-01' }).compare.from === '2025-12-01' && getPeriod('month', '2026-10-15', { month: '2026-01' }).compare.to === '2025-12-31');
check('выбор месяца: мусор вместо месяца игнорируется', getPeriod('month', '2026-10-15', { month: 'abc' }).from === '2026-10-01');
check('shiftMonth: назад через границу года', shiftMonth('2026-01', -1) === '2025-12');
check('shiftMonth: вперёд через границу года', shiftMonth('2026-12', 1) === '2027-01');
const mSep = buildStatsModel({ kind: 'month', month: '2026-09', records: sRecs, categories: sCats, today: '2026-10-15' });
check('сентябрь: итоги и пробег', mSep.current.total === 1050 && mSep.current.mileage === 900 && mSep.previous.count === 0);
check('сентябрь: график на весь месяц и август', mSep.chart.current.length === 30 && mSep.chart.previous.length === 31);
check('сентябрь: стрелки — назад нельзя (первая запись), вперёд можно', mSep.monthNav.canPrev === false && mSep.monthNav.canNext === true && mSep.monthNav.nextMonth === '2026-10');
check('октябрь: стрелки — назад можно, вперёд нельзя', mMonth.monthNav.canPrev === true && mMonth.monthNav.canNext === false && mMonth.monthNav.prevMonth === '2026-09');
check('стрелок нет вне режима "месяц"', mYear.monthNav === null);

// Журнал по категориям
const hCats = [
  { id: 1, name: 'Топливо', kind: 'fuel' },
  { id: 2, name: 'Ремонт', kind: 'regular' },
  { id: 3, name: 'Шины', kind: 'regular' },
  { id: 4, name: 'Старая', kind: 'regular', archived: true },
  { id: 5, name: 'Скрытая пустая', kind: 'regular', archived: true },
];
const hRecs = [
  { id: 1, date: '2026-03-10', category_id: 2, mileage: 100500, amount: 200, comment: 'Колодки' },
  { id: 2, date: '2026-03-01', category_id: 1, mileage: 100000, amount: 300 },
  { id: 3, date: '2026-02-05', category_id: 2, mileage: 99000, amount: 150, comment: 'Масло' },
  { id: 4, date: '2026-03-10', category_id: 3, mileage: 100500, amount: 800 },
  { id: 5, date: '2026-01-20', category_id: 4, mileage: 98000, amount: 50, comment: 'Мойка' },
  { id: 6, date: '2026-04-01', category_id: 99, mileage: 101000, amount: 10 },
];
const hOptions = getHistoryOptions(hCats, hRecs);
check('журнал: список — Все, Топливо, Все кроме топлива, затем категории (без скрытых пустых)', hOptions.map((o) => o.label).join('|') === 'Все|Топливо|Все, кроме топлива|Ремонт|Шины|Старая (скрыта)');
check('журнал: по умолчанию «Все» — первый пункт', hOptions[0].value === 'all');
const hAll = buildHistory({ records: hRecs, categories: hCats, selection: 'all' });
check('журнал "Все": топливо входит, от новых к старым', hAll.items.map((i) => i.id).join() === '6,4,1,2,3,5');
check('журнал "Все": при одной дате выше запись, внесённая позже', hAll.items.findIndex((i) => i.id === 4) < hAll.items.findIndex((i) => i.id === 1));
check('журнал "Все": подписи категорий и "Без категории"', hAll.showCategory === true && hAll.items[0].categoryName === 'Без категории' && hAll.items[5].categoryName === 'Старая');
check('журнал: поля записи', hAll.items[4].date === '2026-02-05' && hAll.items[4].mileage === 99000 && hAll.items[4].amount === 150 && hAll.items[4].comment === 'Масло');
check('журнал: пустой комментарий', hAll.items[1].comment === '');
check('журнал "Все": сумма и количество', hAll.count === 6 && hAll.total === 1510);
const hNonFuel = buildHistory({ records: hRecs, categories: hCats, selection: 'nonfuel' });
check('журнал "Все, кроме топлива": топлива нет', hNonFuel.items.map((i) => i.id).join() === '6,4,1,3,5' && hNonFuel.total === 1210 && hNonFuel.showCategory === true);
const hFuel = buildHistory({ records: hRecs, categories: hCats, selection: 'fuel' });
check('журнал "Топливо": только заправки', hFuel.items.map((i) => i.id).join() === '2' && hFuel.total === 300 && hFuel.showCategory === false);
const hRepair = buildHistory({ records: hRecs, categories: hCats, selection: '2' });
check('журнал по категории: только она, свежие сверху', hRepair.items.map((i) => i.id).join() === '1,3' && hRepair.showCategory === false && hRepair.total === 350);
check('журнал: одна категория топлива отдельным пунктом не дублируется', hOptions.filter((o) => o.label === 'Топливо').length === 1);
check('журнал: если категорий топлива несколько, каждая выбирается отдельно', (() => {
  const cats = [...hCats, { id: 6, name: 'Газ', kind: 'fuel' }];
  return getHistoryOptions(cats, hRecs).some((o) => o.value === '1') && getHistoryOptions(cats, hRecs).some((o) => o.value === '6');
})());
check('журнал: литры попадают в запись', buildHistory({ records: [{ id: 9, date: '2026-05-01', category_id: 1, mileage: 1, amount: 10, liters: 5.5 }], categories: hCats, selection: 'fuel' }).items[0].liters === 5.5);

// Пустая форма: одна подсказка вместо красных ошибок
check('пустая форма: пробег и сумма', describeMissingFields({ mileage: 'x', amount: 'y' }) === 'Введите пробег и сумму');
check('пустая форма: пробег, сумма и литры', describeMissingFields({ mileage: 'x', amount: 'y', liters: 'z' }) === 'Введите пробег, сумму и литры');
check('пустая форма: одно поле', describeMissingFields({ amount: 'y' }) === 'Введите сумму');
check('пустая форма: ошибка даты — обычные ошибки', describeMissingFields({ date: 'x', mileage: 'y' }) === null);
check('пустая форма: нет ошибок — null', describeMissingFields({}) === null);

// Свайп экрана: переключение вкладок
const swipe = (dx, dy = 0, extra = {}) => decideScreenSwipe({ dx, dy, ms: 200, startX: 200, screenWidth: 390, ...extra });
check('свайп экрана: влево — следующий экран', swipe(-120) === 'next');
check('свайп экрана: вправо — предыдущий экран', swipe(120) === 'prev');
check('свайп экрана: короткий жест не считается', swipe(-40) === null && swipe(55) === null);
check('свайп экрана: небольшая диагональ засчитывается', swipe(-100, 60) === 'next' && swipe(100, -60) === 'prev');
check('свайп экрана: прокрутка вниз с лёгким сдвигом в бок не считается', swipe(-90, 120) === null);
check('свайп экрана: почти горизонтальный жест считается', swipe(-120, 40) === 'next');
check('свайп экрана: медленное перетаскивание не считается', swipe(-150, 0, { ms: 1200 }) === null);
check('свайп экрана: от самого края экрана не срабатывает', swipe(120, 0, { startX: 10 }) === null && swipe(-120, 0, { startX: 380 }) === null);
const tabOrder = ['entry', 'history', 'stats'];
check('вкладки: влево с «Ввода» — «Журнал»', neighborTab(tabOrder, 'entry', 'next') === 'history');
check('вкладки: вправо со «Статистики» — «Журнал»', neighborTab(tabOrder, 'stats', 'prev') === 'history');
check('вкладки: за краем ничего нет', neighborTab(tabOrder, 'stats', 'next') === null && neighborTab(tabOrder, 'entry', 'prev') === null);
check('вкладки: неизвестная вкладка — ничего', neighborTab(tabOrder, 'x', 'next') === null);

// Разбор чека. Тексты ниже — настоящий вывод распознавания (Tesseract) на зашумлённых снимках
// выдуманных чеков: с потерянными польскими буквами и опечатками ("zt", "Zaptacono", "Przyktadowa").
const RECEIPTS = {
  "orlen": "ORLEN\n\nStacja Paliw nr 1234\n\nul. Przyktadowa 5, 00-001 Warszawa\nNIP 123-456-78-90\n\nPARAGON FISKALNY\n\n2025-03-14 18:42 Nr 012345\nPB95\n\n35,420 l x 6,290 222,78 A\nSPRZEDAZ OPODATKOWANA A 222,78\nPTU A 23,00% 41,66\nSUMA PTU A 41,66\nSUMA PLN 222,78\nKarta ptatnicza 222,78\nReszta 0,00\n",
  "sklep": "BIEDRONKA 1234\n\nJMP S.A. NIP 779-10-11-327\n\nPARAGON FISKALNY\n\nChleb pszenny 1 x 4,29 4,29 C\nMleko 3,2% 2 x 3,49 6,98 C\nSer z6tty 1x 12,99 12,99 C\nWoda 1,51 3 x 1,99 5,97 A\nSPRZEDAZ OPODATKOWANA A 5,97\nSPRZEDAZ OPODATKOWANA C 24,26\nPTU A 23% ih al72\nPTU C 5% 1,16\nSUMA PTU 2,28\nSUMA PLN 30,23\nGotowka 50,00\nReszta 19,77\n14.03.2025 12:31\n",
  "myjnia": "MYJNIA BEZDOTYKOWA BLASK\n\nul. Wodna 3, Poznan\n\nData: 20.03.2025 11:05\n\nProgram 3 - piana aktywna 25,00\nRAZEM 25,00 zt\nZaptacono karta 25,00\n",
  "serwis": "AUTO SERWIS KOWALSKI\n\nFAKTURA / PARAGON\n\nData sprzedazy: 05.04.2025\n\nWymiana oleju silnikowego 1x 180,00\nFiltr oleju 1x 45,00\nFiltr powietrza 1x 60,00\nWartos¢é netto 231,71\nVAT 23% 53,29\nDo zaptaty: 285,00 PLN\n",
  "bp": "BP Warszawa Zoliborz\nPARAGON FISKALNY #4821\n09-04-2025 07:15\n\nDiesel Ultimate\n\nIlosé: 42.15 L\n\nCena: 6.49 PLN/L\nWartosé: 273.55 PLN\nRAZEM 273,55\n\nKARTA 273,55\n",
  "eur": "PARKHAUS CENTRAL\n\nDate: 12/06/2025 16:20\nParking 3h 8.50\nService fee 1.00\nTOTAL EUR 9.50\nPaid by card 9.50\n"
};

const rCats = [
  { id: 1, name: 'Топливо', kind: 'fuel' }, { id: 2, name: 'ТО (масло, фильтры)', kind: 'regular' }, { id: 3, name: 'Ремонт', kind: 'regular' },
  { id: 4, name: 'Шины и диски', kind: 'regular' }, { id: 5, name: 'Мойка и уход', kind: 'regular' }, { id: 6, name: 'Страховка', kind: 'regular' },
  { id: 7, name: 'Парковка и платные дороги', kind: 'regular' }, { id: 8, name: 'Прочее', kind: 'regular' },
];
const rOpts = { today: '2026-11-02', categories: rCats };
const rp = (text, extra = {}) => parseReceipt(text, { ...rOpts, ...extra });

const rOrlen = rp(RECEIPTS.orlen);
check('чек Orlen: сумма по слову SUMA', rOrlen.amount === 222.78 && rOrlen.amountSource === 'keyword');
check('чек Orlen: литры и цена (литры × цена = сумма)', rOrlen.liters === 35.42 && rOrlen.pricePerLiter === 6.29);
check('чек Orlen: дата, место, топливо', rOrlen.date === '2025-03-14' && rOrlen.merchant === 'Orlen' && rOrlen.isFuel === true);
check('чек Orlen: категория "Топливо"', rOrlen.categoryId === 1 && rOrlen.warnings.length === 0);
const rShop = rp(RECEIPTS.sklep);
check('чек магазина: сумма не путается со сдачей, наличными и налогом', rShop.amount === 30.23);
check('чек магазина: не топливо, литров нет, категории нет', rShop.isFuel === false && rShop.liters === null && rShop.categoryId === null);
check('чек магазина: дата в конце чека, название без номера', rShop.date === '2025-03-14' && rShop.merchant === 'Biedronka');
const rWash = rp(RECEIPTS.myjnia);
check('чек мойки: сумма, дата, категория "Мойка"', rWash.amount === 25 && rWash.date === '2025-03-20' && rWash.categoryId === 5);
const rService = rp(RECEIPTS.serwis);
check('чек сервиса: "Do zaptaty" с опечаткой, а не нетто и позиции', rService.amount === 285 && rService.date === '2025-04-05');
check('чек сервиса: категория "ТО" по словам про масло и фильтры', rService.categoryId === 2);
const rBp = rp(RECEIPTS.bp);
check('чек BP: литры и цена на разных строках, "Ilosc" с ошибкой', rBp.liters === 42.15 && rBp.pricePerLiter === 6.49 && rBp.amount === 273.55);
check('чек BP: дата ДД-ММ-ГГГГ и категория "Топливо"', rBp.date === '2025-04-09' && rBp.categoryId === 1);
const rEur = rp(RECEIPTS.eur);
check('чек в евро: сумма с точкой, валюта, предупреждение', rEur.amount === 9.5 && rEur.currency === 'EUR' && rEur.warnings.some((w) => w.includes('EUR')));
check('чек в евро: дата ДД/ММ/ГГГГ и категория "Парковка"', rEur.date === '2025-06-12' && rEur.categoryId === 7);

// Особые случаи
const noKeywords = rp('Sklep\n12.03.2025\nBulka 3,50\nSok 7,20');
check('без слов-подсказок: берётся самое большое число и выводится предупреждение', noKeywords.amount === 7.2 && noKeywords.amountSource === 'largest' && noKeywords.warnings.length > 0);
check('сумма на следующей строке после "DO ZAPŁATY"', rp('DO ZAPŁATY\n150,00 PLN').amount === 150);
check('сумма с пробелом-разрядом', rp('RAZEM 1 234,56 zł').amount === 1234.56);
check('число с тремя знаками (литры, цена) не считается суммой', rp('35,420 l x 6,290').amount === null);
check('проценты и даты не считаются суммой', rp('PTU A 23,00% 14.03.2025').amount === null);
check('цифры, заменённые буквами в дате (2O25-O3-l4)', rp('RAZEM 10,00\nData: 2O25-O3-l4').date === '2025-03-14');
check('будущая дата не принимается', rp('RAZEM 10,00\n31.12.2026').date === null && rp('RAZEM 10,00\n31.12.2026').warnings.some((w) => w.includes('позже')));
check('вес (кг) не принимается за литры', rp('Szynka 1,250 kg x 39,90 = 49,88\nRAZEM 49,88').isFuel === false);
check('бутылка воды (1,5l) не делает чек заправкой', rp('Woda 1,5l 2 x 1,99 3,98\nRAZEM 3,98').isFuel === false);
check('заправка без бренда: литры × цена = сумма', (() => { const r = rp('PB95\n35,420 l 6,290 222,80 A\nRAZEM 222,80'); return r.isFuel && r.liters === 35.42; })());
check('пустой текст: ничего не найдено, есть предупреждения', (() => { const r = rp(''); return r.amount === null && r.date === null && r.warnings.length >= 2; })());
check('скрытая категория не предлагается', rp(RECEIPTS.myjnia, { categories: rCats.map((c) => (c.id === 5 ? { ...c, archived: true } : c)) }).categoryId === null);
check('нет категории "Топливо" — не предлагаем', rp(RECEIPTS.orlen, { categories: rCats.filter((c) => c.kind !== 'fuel') }).categoryId === null);

// ocr.js (сам запуск распознавания проверяется на телефоне; здесь только чистые функции)
check('fitSize: маленькое фото не увеличивается', (() => { const s = fitSize(800, 1200); return s.width === 800 && s.height === 1200 && s.scale === 1; })());
check('fitSize: большое фото укладывается в лимит пикселей', (() => { const s = fitSize(4000, 3000); return s.width * s.height <= 4_000_000 * 1.01; })());
check('fitSize: пропорции сохраняются', (() => { const s = fitSize(4000, 3000); return Math.abs(s.width / s.height - 4 / 3) < 0.01; })());
check('fitSize: длинная узкая панорама чека не сжимается в точку', (() => { const s = fitSize(1000, 8000); return s.height <= 3000 && s.width >= 300; })());
check('enhanceGray: растягивает контраст бледного фото', (() => {
  const px = new Uint8ClampedArray(400); // 100 пикселей: половина серых 100, половина 150
  for (let p = 0; p < 100; p++) { const v = p < 50 ? 100 : 150; px.set([v, v, v, 255], p * 4); }
  const r = enhanceGray(px);
  return r.stretched && px[0] === 0 && px[99 * 4] === 255;
})());
check('enhanceGray: одноцветное фото не растягивается и не ломается', (() => {
  const px = new Uint8ClampedArray(40).fill(128);
  const r = enhanceGray(px);
  return !r.stretched && px[0] === 128 && px[3] === 255;
})());
check('enhanceGray: цвет превращается в оттенки серого', (() => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  enhanceGray(px);
  return px[0] === px[1] && px[1] === px[2] && px[4] === px[5] && px[5] === px[6];
})());
check('describeOcrStatus: чтение показывает проценты', describeOcrStatus('recognizing text', 0.456) === 'Читаю чек… 46%');
check('describeOcrStatus: неизвестный статус скрывается', describeOcrStatus('что-то новое', 0.5) === null);
check('describeOcrError: отмена не показывается', describeOcrError(new OcrError('cancelled')) === null);
check('describeOcrError: нет файлов — указывает на README', describeOcrError(new OcrError('missing-files')).includes('libs/ocr'));
check('describeOcrError: неизвестная ошибка содержит текст ошибки', describeOcrError(new Error('boom')).includes('boom'));
check('describeOcrError: ошибка-строка не ломает функцию', typeof describeOcrError('сбой сети') === 'string');

// Настоящий вывод Tesseract по фото чека (итог в строке SUMA прочитан неверно: 300.58 вместо 305.57)
const ORLEN_OCR = `PARAGON FISKALNY
STACJA PALIW ORLEN NR 4102
ul. Marszałkowska 100, 00-001. Warszawa

2026-11-04 08:30            Wydruk 000142
1. BENZYNA PB95

42.50 | x 6.59 zł             280.08 A
2. KAWA ESPRESSO 200ML

1.00 szt x 11.99 zł            11,99 A
3. HOT DOG GIGANTE                W

1.00 szt x 13.50 zł            13.50 A
SUMA PLN             300.58
Forma płatności:
Karta płatnicza                    305.57
Rozliczenie podatku PTU:

PTU A 23,00%          57.14        54 43
BDO: 000012345                         4567`;
const orlenOcr = rp(ORLEN_OCR, { today: '2026-11-04' });
check('только топливо: сумма строки бензина (280,08), а не итог чека с кофе и хот-догом', orlenOcr.amount === 280.08 && orlenOcr.amountSource === 'fuel-line');
check('только топливо: литры, дата и категория с того же чека найдены', orlenOcr.liters === 42.5 && orlenOcr.date === '2026-11-04' && orlenOcr.isFuel);
check('только топливо: есть пометка о других покупках', orlenOcr.warnings.some((w) => w.includes('другие покупки')));
check('только топливо: ошибка в итоге не влияет на сумму топлива', rp(ORLEN_OCR.replace('300.58', '999.99'), { today: '2026-11-04' }).amount === 280.08);
check('только топливо: чек без другого — пометки о покупках нет', (() => {
  const r = rp('STACJA ORLEN\n2026-11-04\nBENZYNA PB95\n35,42 l x 6,29 zł 222,80 A\nSUMA PLN 222,80', { today: '2026-11-04' });
  return r.amount === 222.8 && r.liters === 35.42 && r.warnings.length === 0;
})());
check('штучный товар (szt) не принимается за топливо', (() => { const r = rp('STACJA ORLEN\n2,00 szt x 5,00 zł 10,00 A\nRAZEM 10,00'); return r.liters === null; })());
check('две строки топлива: предупреждение', (() => {
  const r = rp('STACJA ORLEN\nBENZYNA PB95\n10,00 l x 6,00 zł 60,00 A\nBENZYNA PB95\n20,00 l x 6,00 zł 120,00 A\nRAZEM 180,00');
  return r.warnings.some((w) => w.includes('несколько строк'));
})());

// Сверка итогов на обычном (не топливном) чеке: итог в строке SUMA прочитан неверно
const SHOP_OCR = `BIEDRONKA 1234
2026-11-04
Chleb 1 szt x 4.50 4.50 A
Mleko 2 szt x 3.00 6.00 A
SUMA PLN 10.80
Forma płatności:
Karta płatnicza 10.50`;
const shop = rp(SHOP_OCR, { today: '2026-11-04' });
check('сверка: итог и оплата расходятся, побеждает совпадающий с позициями', shop.amount === 10.5 && shop.amountSource === 'reconciled');
check('сверка: предупреждение содержит оба числа', shop.warnings.some((w) => w.includes('10,80') && w.includes('10,50')));
check('сверка: без расхождений предупреждений нет', rp(SHOP_OCR.replace('10.80', '10.50'), { today: '2026-11-04' }).warnings.length === 0);
check('сверка: обе строки одинаково неверны — предупреждение о несходстве с позициями', (() => {
  const r = rp(SHOP_OCR.replace('10.80', '10.20').replace('10.50', '10.20'), { today: '2026-11-04' });
  return r.amount === 10.2 && r.warnings.some((w) => w.includes('не сошёлся'));
})());
check('сверка: расхождение без позиций — берётся итог с предупреждением', (() => {
  const r = rp('SUMA 100,00\nKarta płatnicza 120,00');
  return r.amount === 100 && r.warnings.some((w) => w.includes('разные итоги'));
})());

// Вывод
const failed = results.filter((r) => !r.ok);
console.log(`Тесты: ${results.length - failed.length} из ${results.length} пройдено`);
failed.forEach((r) => console.error('ПРОВАЛ:', r.name));

if (typeof document !== 'undefined') {
  const ul = document.getElementById('results');
  document.getElementById('summary').textContent =
    failed.length === 0 ? `Все тесты пройдены (${results.length})` : `Провалено: ${failed.length} из ${results.length}`;
  for (const r of results) {
    const li = document.createElement('li');
    li.textContent = `${r.ok ? '✔' : '✘'} ${r.name}`;
    li.style.color = r.ok ? '#1a7f37' : '#c62828';
    ul.append(li);
  }
}
