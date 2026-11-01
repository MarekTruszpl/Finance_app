// format.js — общие функции показа чисел, сумм и дат (для статистики и журнала).
import { BASE_CURRENCY, CURRENCIES } from './defaults.js';

export const symbolOf = (code) => CURRENCIES.find((c) => c.code === code)?.symbol ?? code;

// 1234567.5 -> "1 234 567,5" (digits — сколько знаков после запятой показывать)
export const num = (n, digits = 0) => n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 1250 -> "1 250 zł"
export const money = (n, digits = 0, currency = BASE_CURRENCY) => `${num(n, digits)} ${symbolOf(currency)}`;

// Целые суммы без копеек, дробные с двумя знаками
export const moneyAuto = (n, currency = BASE_CURRENCY) => money(n, Number.isInteger(n) ? 0 : 2, currency);

// 2026-03-01 -> 01.03.2026
export const formatDate = (iso) => iso.split('-').reverse().join('.');

// "1 запись", "2 записи", "5 записей"
export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
