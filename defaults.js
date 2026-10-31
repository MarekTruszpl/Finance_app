// Начальные категории раздела "car".
// kind: 'fuel'    -> в форме будут литры
//       'regular' -> в форме будет комментарий
// Позже категории можно будет менять в настройках: они хранятся в базе, а не в коде.
export const DEFAULT_CATEGORIES = [
  { section: 'car', name: 'Топливо',                 kind: 'fuel' },
  { section: 'car', name: 'ТО (масло, фильтры)',     kind: 'regular' },
  { section: 'car', name: 'Ремонт',                  kind: 'regular' },
  { section: 'car', name: 'Шины и диски',            kind: 'regular' },
  { section: 'car', name: 'Мойка и уход',            kind: 'regular' },
  { section: 'car', name: 'Страховка',               kind: 'regular' },
  { section: 'car', name: 'Налоги и штрафы',         kind: 'regular' },
  { section: 'car', name: 'Парковка и платные дороги', kind: 'regular' },
  { section: 'car', name: 'Прочее',                  kind: 'regular' },
];

// Валюта, в которой приложение показывает итоги (код ISO 4217).
export const BASE_CURRENCY = 'PLN';

// Настройки разделов. multiCurrency: true включает выбор валюты и ввод курса.
// Для автомобиля всё в базовой валюте, мультивалютность пригодится в разделе путешествий.
export const SECTIONS = {
  car:    { name: 'Автомобиль',   multiCurrency: false },
  travel: { name: 'Путешествия',  multiCurrency: true },
};

// Валюты, доступные при вводе. Чтобы добавить свою, допишите строку по образцу.
// Первой стоит базовая валюта.
export const CURRENCIES = [
  { code: 'PLN', symbol: 'zł',  name: 'Злотый' },
  { code: 'EUR', symbol: '€',   name: 'Евро' },
  { code: 'USD', symbol: '$',   name: 'Доллар США' },
  { code: 'GBP', symbol: '£',   name: 'Фунт стерлингов' },
  { code: 'CHF', symbol: 'CHF', name: 'Швейцарский франк' },
  { code: 'CZK', symbol: 'Kč',  name: 'Чешская крона' },
  { code: 'UAH', symbol: '₴',   name: 'Гривна' },
  { code: 'TRY', symbol: '₺',   name: 'Турецкая лира' },
];

// Версия формата данных в резервной копии. Увеличиваем, когда меняется структура записей:
// тогда приложение сможет прочитать и преобразовать старые копии.
export const SCHEMA_VERSION = 1;
