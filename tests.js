// tests.js — проверки для logic.js.
// Запуск: откройте tests.html через Live Server (результат на странице и в консоли).
import {
  parseNumber, validateRecord, getTotalMileage, getLastMileage, getFuelMileageInfo,
  getLastRate, convertToBase, daysSince, validateCategory, getVisibleCategories, formatNumberInput,
  getLastMileageForGroup, buildBackup, validateBackup, buildCsv, getBackupReminder, localDateOf,
} from './logic.js';
import { parseCsv, normalizeNumberText, parseDateText, prepareImport, describeImport } from './importer.js';

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
check('число из таблицы: "245.000" (разряды)', normalizeNumberText('245.000') === '245000');
check('число из таблицы: "1.234,56"', normalizeNumberText('1.234,56') === '1234.56');
check('число из таблицы: "1,234.56"', normalizeNumberText('1,234.56') === '1234.56');
check('число из таблицы: "0,500" — дробь', normalizeNumberText('0,500') === '0.500');
check('число из таблицы: без цифр -> пусто', normalizeNumberText('abc') === '');
check('число из таблицы: минус сохраняется', normalizeNumberText('-50 zł') === '-50');
check('дата: 25.06.2025', parseDateText('25.06.2025') === '2025-06-25');
check('дата: 5.6.25', parseDateText('5.6.25') === '2025-06-05');
check('дата: ГГГГ-ММ-ДД', parseDateText('2025-06-25') === '2025-06-25');
check('дата: 31.02.2025 -> null', parseDateText('31.02.2025') === null);
check('дата: текст -> null', parseDateText('abc') === null);

const importCats = [
  { id: 1, section: 'car', name: 'Топливо', kind: 'fuel' },
  { id: 2, section: 'car', name: 'Ремонт', kind: 'regular' },
  { id: 3, section: 'car', name: 'Шины и диски', kind: 'regular' },
];
const importOpts = { section: 'car', categories: importCats, defaultCategoryId: 2, existingRecords: [] };
const sheetCsv = [
  ',,,"43 425 zł",',
  ',Data,,Koszt,Przebieg',
  ',25.06.2025,Łączniki stabilizatora,200 zł,245 000',
  ',25.06.2025,Gumki stabilizatora,100 zł,245 000',
  ',10.07.2025,"Olej, filtr","1 250 zł","246 100"',
  ',01.08.2025,Opony,"1 200,50 zł","247 000"',
  ',,,,',
  ',,Razem,,',
].join('\n');
const imp = prepareImport(sheetCsv, importOpts);
check('импорт: таблица и колонки распознаны', imp.ok && imp.columns.date === 1 && imp.columns.comment === 2 && imp.columns.amount === 3 && imp.columns.mileage === 4);
check('импорт: 4 записи готовы, ошибок нет', imp.ready.length === 4 && imp.errors.length === 0 && imp.total === 4);
check('импорт: итоговая строка пропущена', imp.skipped === 1);
const firstImported = imp.ready[0];
check('импорт: поля записи', firstImported.date === '2025-06-25' && firstImported.amount === 200 && firstImported.mileage === 245000
  && firstImported.comment === 'Łączniki stabilizatora' && firstImported.category_id === 2 && firstImported.section === 'car'
  && firstImported.currency === 'PLN' && firstImported.amount_base === 200);
check('импорт: запятая внутри кавычек не ломает колонки', imp.ready.some((r) => r.comment === 'Olej, filtr' && r.amount === 1250));
check('импорт: "1 200,50 zł" = 1200.5', imp.ready.some((r) => r.amount === 1200.5));
const again = prepareImport(sheetCsv, { ...importOpts, existingRecords: imp.ready.map((r, i) => ({ ...r, id: i + 1 })) });
check('импорт: повторный импорт — всё дубликаты', again.ready.length === 0 && again.duplicates === 4);
const bad = prepareImport(sheetCsv + '\n,02.08.2025,Ошибка,50 zł,100\n,31.02.2025,Плохая дата,50 zł,300 000\n,03.08.2025,Без пробега,50 zł,', importOpts);
check('импорт: хорошие записи остаются, 3 строки с ошибками', bad.ready.length === 4 && bad.errors.length === 3);
check('импорт: ошибка пробега указывает строку', bad.errors.some((e) => e.startsWith('Строка 9') && e.includes('Пробег')));
check('импорт: ошибка даты указывает строку', bad.errors.some((e) => e.startsWith('Строка 10') && e.includes('Дата')));
const semi = prepareImport('Data;Opis;Koszt;Przebieg\n25.06.2025;Test;"200,50 zł";245000', importOpts);
check('импорт: разделитель ";" определяется сам', semi.ok && semi.ready.length === 1 && semi.ready[0].amount === 200.5 && semi.ready[0].comment === 'Test');
const ru = prepareImport('Дата,Описание,Сумма,Пробег\n25.06.2025,Масло,150,245000', importOpts);
check('импорт: русские заголовки', ru.ok && ru.ready.length === 1 && ru.ready[0].comment === 'Масло');
const withCat = prepareImport('Data,Kategoria,Koszt,Przebieg\n25.06.2025,Шины и диски,400,245000\n26.06.2025,Неизвестная,10,245001\n27.06.2025,Топливо,20,245002', importOpts);
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
