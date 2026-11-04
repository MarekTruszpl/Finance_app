// receipt.js — разбор текста чека (после распознавания) в данные для формы расхода.
// Чистые функции: на входе текст, на выходе найденная сумма, дата, литры и подсказка категории.
// Текст после распознавания всегда содержит ошибки (польские буквы теряются, "l" становится "1"),
// поэтому правила намеренно нестрогие, а результат всегда показывается пользователю на проверку.
import { isRealDate, today as todayIso } from './logic.js';

const round2 = (n) => Math.round(n * 100) / 100;

// "1 234,56" -> 1234.56
const toNumber = (s) => Number(String(s).replace(/ /g, '').replace(',', '.'));

// Текст без диакритики и в нижнем регистре: "Przyktadowa", "Zaplacono", "ŁĄCZNIK" -> ascii для простых правил
function plain(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

function toLines(text) {
  return String(text ?? '')
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l !== '');
}

// Числа с запятой/точкой на строке: 222,78 и 1 234,56 (не даты, не проценты, не три знака после запятой)
function moneyTokens(line) {
  const out = [];
  const re = /\d+(?: \d{3})*[,.]\d{2}(?!\d)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const end = m.index + m[0].length;
    const before = m.index > 0 ? line[m.index - 1] : '';
    const after = line.slice(end, end + 2);
    if (/[\d.,]/.test(before)) continue;       // кусок длинного числа
    if (/^[.,]\d/.test(after)) continue;       // кусок даты 14.03.2025
    if (/^\s*%/.test(line.slice(end))) continue; // процент: 23,00%
    out.push(toNumber(m[0]));
  }
  return out;
}

// ---------- Сумма ----------

// Строки, числа в которых НЕ итог: сдача, налог, скидка, наличные от покупателя, нетто
const EXCLUDED = /reszta|wydano|zwrot|got[oó0]wk|gotowk|wp[łlt]ata|przyj[ęe]to|rabat|zni[żz]k|\bptu\b|vat|podatek|opodatk|netto|\brest\b|change|cash|tendered|\btax\b|discount|сдач|налог|ндс|скидк|наличн/i;

// Слова, рядом с которыми обычно стоит итог (чем больше число, тем увереннее)
const TOTAL_SCORES = [
  { score: 100, re: /do\s*zap.{1,2}aty|amount\s*due|total\s*due|к\s*оплате/i },
  { score: 90, re: /\bsuma\b|\brazem\b|\btotal\b|\bsum\b|итого|nale[zż]no/i },
  { score: 70, re: /\bkarta\b|\bcard\b|p[łlt]atno|zap[łlt]acono|\bpaid\b|visa|master|\bblik\b|оплач/i },
];

function lineScore(line) {
  let best = 0;
  for (const { score, re } of TOTAL_SCORES) if (re.test(line)) best = Math.max(best, score);
  return best;
}

// Сумма позиций: строки, которые заканчиваются числом и буквой налоговой ставки ("11,99 A").
// Нужна только для сверки итога: если итог прочитан с ошибкой, сумма позиций это покажет.
function itemsTotal(lines) {
  let sum = 0;
  let count = 0;
  for (const line of lines) {
    if (EXCLUDED.test(line) || lineScore(line) > 0) continue;
    const m = line.match(/(?:^|[^\d.,])(\d+(?: \d{3})*[,.]\d{2})\s*[A-G]$/);
    if (!m) continue;
    sum += toNumber(m[1]);
    count++;
  }
  return count > 0 ? round2(sum) : null;
}

const fmt = (n) => n.toFixed(2).replace('.', ',');

function findAmount(lines) {
  const candidates = [];
  lines.forEach((line, i) => {
    if (EXCLUDED.test(line)) return;
    const score = lineScore(line);
    if (score === 0) return;
    let tokens = moneyTokens(line);
    let value = tokens.length ? tokens[tokens.length - 1] : null;
    if (value === null && i + 1 < lines.length && !EXCLUDED.test(lines[i + 1])) {
      tokens = moneyTokens(lines[i + 1]); // "DO ZAPŁATY" и сумма на следующей строке
      value = tokens.length ? tokens[0] : null;
    }
    if (value !== null && value > 0) candidates.push({ value, score, index: i });
  });
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score || b.index - a.index);
    const best = candidates[0];
    let value = best.value;
    let source = best.score >= 90 ? 'keyword' : 'payment';
    let note = null;

    // Итог и строка оплаты иногда читаются по-разному (ошибка распознавания цифр): сверяем с суммой позиций
    const distinct = [...new Set(candidates.map((c) => c.value))];
    const total = itemsTotal(lines);
    if (distinct.length === 1 && total !== null && Math.abs(total - value) > 0.01) {
      note = `Итог ${fmt(value)} не сошёлся с суммой позиций ${fmt(total)}: возможна ошибка распознавания. Проверьте сумму по чеку.`;
    }
    if (distinct.length > 1) {
      const matching = total === null ? [] : distinct.filter((v) => Math.abs(v - total) <= 0.01);
      const list = distinct.map(fmt).join(' и ');
      if (matching.length === 1 && matching[0] !== value) {
        value = matching[0];
        source = 'reconciled';
        note = `На чеке прочитаны разные итоги (${list}). Взята сумма ${fmt(value)}: она сходится с суммой позиций. Проверьте её.`;
      } else if (matching.length !== 1) {
        note = `На чеке прочитаны разные итоги (${list}), сверить с позициями не удалось. Взята сумма ${fmt(value)}. Проверьте её по чеку.`;
      }
    }
    return { value, source, note };
  }
  // Ключевых слов нет: берём самое большое число среди "обычных" строк
  let max = null;
  for (const line of lines) {
    if (EXCLUDED.test(line)) continue;
    for (const v of moneyTokens(line)) if (v > 0 && (max === null || v > max)) max = v;
  }
  return max === null ? { value: null, source: null, note: null } : { value: max, source: 'largest', note: null };
}

// ---------- Дата ----------

// OCR путает буквы и цифры внутри дат: 2O25 -> 2025, l4 -> 14
function fixDateChars(line) {
  return line.replace(/[\dOoIl|]{1,4}[-./][\dOoIl|]{1,2}[-./][\dOoIl|]{2,4}/g, (m) => m.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1'));
}

function findDate(lines, todayStr) {
  const currentYear = Number(todayStr.slice(0, 4));
  const found = [];
  lines.forEach((rawLine, index) => {
    const line = fixDateChars(rawLine);
    const patterns = [
      { re: /(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g, order: 'ymd' },
      { re: /(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})(?!\d)/g, order: 'dmy' }, // как принято в Европе: день.месяц.год
    ];
    for (const { re, order } of patterns) {
      let m;
      while ((m = re.exec(line)) !== null) {
        if (m.index > 0 && /\d/.test(line[m.index - 1])) continue; // кусок длинного числа
        let [y, mo, d] = order === 'ymd' ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
        if (y.length === 2) y = `20${y}`;
        const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (isRealDate(iso) && Number(y) >= 2000 && Number(y) <= currentYear) {
          found.push({ iso, index, hasKeyword: /data|date|sprzeda|dnia/i.test(plain(rawLine)) });
        }
      }
    }
  });
  if (found.length === 0) return { date: null, future: false };
  const valid = found.filter((f) => f.iso <= todayStr);
  if (valid.length === 0) return { date: null, future: true };
  const preferred = valid.find((f) => f.hasKeyword) ?? valid[0];
  return { date: preferred.iso, future: false };
}

// ---------- Топливо и литры ----------

const FUEL_BRAND = /orlen|\bbp\b|shell|circle\s*k|lotos|\bmoya\b|amic|huzar|statoil|lukoil|\bmol\b|\bavia\b|stacja\s*pali|tankowan/i;
const FUEL_PRODUCT = /\b(pb\s?-?\s?9[58]|e\s?-?\s?9[58]|e10|diesel|olej\s*nap|lpg|benzyn|ethanol|unleaded|verva|efecta|ultimate|paliw)/i;

function decimalTokens(line) {
  const out = [];
  const re = /\d{1,3}[.,]\d{2,3}(?!\d)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const end = m.index + m[0].length;
    const before = m.index > 0 ? line[m.index - 1] : '';
    if (/[\d.,]/.test(before)) continue;
    if (/^[.,]\d/.test(line.slice(end, end + 2))) continue;
    if (/^\s*%/.test(line.slice(end))) continue;
    out.push(toNumber(m[0]));
  }
  return out;
}

// Литры и цена за литр. Надёжнее всего, когда литры × цена совпадают с суммой строки топлива.
// Возвращает также lineAmount: сумму именно этой строки (без кофе, хот-дога и прочего на том же чеке).
function findLiters(lines, amount, fuelSignal) {
  const tolerance = (target) => Math.max(0.05, target * 0.01);
  let best = null; // { liters, price, strong, diff, lineAmount }
  const fuelLines = new Set(); // строки, похожие на топливо (для предупреждения о нескольких заправках)

  lines.forEach((line, index) => {
    if (/\bkg\b|\bszt\b|\bpcs\b/i.test(line)) return; // вес и штучный товар — не топливо
    const unit = /\bl\b|litr|ltr/i.test(line);
    if (!fuelSignal && !unit) return;
    const looksFuel = unit || FUEL_PRODUCT.test(line) || (index > 0 && FUEL_PRODUCT.test(lines[index - 1]));
    const nums = decimalTokens(line);
    for (const q of nums) {
      if (q < 1 || q > 200) continue;
      for (const p of nums) {
        if (p === q || p < 2 || p > 15) continue;
        const product = q * p;
        const others = nums.filter((n) => n !== q && n !== p);
        // сначала числа с той же строки (сумма строки топлива), потом общий итог чека
        const targets = [
          ...others.map((value) => ({ value, sameLine: true })),
          ...(amount !== null ? [{ value: amount, sameLine: false }] : []),
        ];
        for (const { value: target, sameLine } of targets) {
          const diff = Math.abs(product - target);
          if (diff > tolerance(target)) continue;
          if (looksFuel) fuelLines.add(index);
          if (best === null || diff < best.diff) {
            best = { liters: round2(q), price: p, strong: true, diff, lineAmount: sameLine ? target : null };
          }
        }
      }
    }
  });
  if (best) return { ...best, multiple: fuelLines.size > 1 };

  // Литры и цена на разных строках ("Ilość: 42.15 L", "Cena: 6.49")
  if (fuelSignal) {
    for (const line of lines) {
      const m = line.match(/(\d{1,3}[.,]\d{2,3})\s*(?:l|ltr|litr\w*)(?![a-z])/i);
      if (!m) continue;
      const q = toNumber(m[1]);
      if (q < 1 || q > 200) continue;
      let price = null;
      if (amount !== null) {
        for (const other of lines) {
          for (const p of decimalTokens(other)) {
            if (p >= 2 && p <= 15 && Math.abs(q * p - amount) <= tolerance(amount)) price = p;
          }
        }
      }
      return { liters: round2(q), price, strong: price !== null, diff: 0, lineAmount: null, multiple: false };
    }
  }
  return null;
}

// ---------- Название места, валюта, категория ----------

function findMerchant(lines) {
  const skip = /paragon|faktura|fiskaln|\bnip\b|regon|\bkasa\b|\bnr\s*\d|\btel\b|www|^ul\.|^data|^date|rachunek|dokument/i;
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźżА-Яа-я]/g) ?? []).length;
    if (letters < 3 || letters / line.length < 0.5 || skip.test(plain(line))) continue;
    let name = line.replace(/\s+\d{2,}$/, '').trim(); // "BIEDRONKA 1234" -> "BIEDRONKA"
    if (name === name.toUpperCase() && name.length > 3) name = name.charAt(0) + name.slice(1).toLowerCase();
    return name.slice(0, 40);
  }
  return null;
}

function findCurrency(text) {
  if (/€|\beur\b|\beuro\b/i.test(text)) return 'EUR';
  if (/\$|\busd\b/i.test(text)) return 'USD';
  if (/£|\bgbp\b/i.test(text)) return 'GBP';
  if (/\bczk\b|kč/i.test(text)) return 'CZK';
  return 'PLN';
}

// Подсказка категории по словам на чеке. Названия категорий пользователь может менять,
// поэтому ищем по обрывкам слов; если подходящей нет, ничего не подсказываем.
const CATEGORY_RULES = [
  { re: /myjni|mycie|\bwash\b|\bmyj/, hints: ['мойк', 'уход'] },
  { re: /parking|autostrad|viatoll|e-?toll|\btoll\b|bramk|oplata drog/, hints: ['парков', 'платн', 'дорог'] },
  { re: /opon|wulkaniz|felg|\btyre|\btire|geometri/, hints: ['шин', 'диск'] },
  { re: /ubezpiecz|polisa|insurance|oc\/ac/, hints: ['страхов'] },
  { re: /przeglad|\bolej|filtr|klock|serwis|wymian|plyn|akumulator|swiec|\boil\b/, hints: ['то (', 'масл', 'обслуж', 'сервис'] },
  { re: /naprawa|warsztat|mechanik|blacharz|lakier|czesci|spawan/, hints: ['ремонт'] },
];

function suggestCategory(text, isFuel, categories) {
  const usable = categories.filter((c) => !c.archived);
  if (isFuel) return usable.find((c) => c.kind === 'fuel')?.id ?? null;
  const flat = plain(text);
  for (const rule of CATEGORY_RULES) {
    if (!rule.re.test(flat)) continue;
    const match = usable.find((c) => c.kind !== 'fuel' && rule.hints.some((h) => c.name.toLowerCase().includes(h)));
    if (match) return match.id;
  }
  return null;
}

// ---------- Всё вместе ----------

// text       — текст чека (распознанный или вставленный)
// options    — { today: 'ГГГГ-ММ-ДД', categories: [{ id, name, kind, archived? }] }
// Возвращает { amount, amountSource, date, liters, pricePerLiter, merchant, isFuel, currency, categoryId, warnings }
export function parseReceipt(text, { today = todayIso(), categories = [] } = {}) {
  const lines = toLines(text);
  const warnings = [];

  let { value: amount, source: amountSource, note: amountNote } = findAmount(lines);

  const fuelSignal = FUEL_BRAND.test(text) || FUEL_PRODUCT.test(text) || /\bON\b/.test(text);
  const fuel = findLiters(lines, amount, fuelSignal);
  const isFuel = fuelSignal || Boolean(fuel && fuel.strong);

  let liters = null;
  let pricePerLiter = null;
  let otherPurchases = false;
  let usedFuelLine = false;
  if (isFuel && fuel) {
    liters = fuel.liters;
    pricePerLiter = fuel.price;
    if (amount === null && fuel.strong && fuel.price) {
      amount = round2(fuel.liters * fuel.price); // суммы нет, но есть литры × цена
      amountSource = 'liters';
    }
    // На чеке кроме топлива может быть кофе, еда и т.п.: записываем только сумму строки топлива
    if (fuel.strong && fuel.lineAmount != null && fuel.lineAmount > 0) {
      otherPurchases = amount !== null && Math.abs(amount - fuel.lineAmount) > 0.01;
      usedFuelLine = true;
      amount = fuel.lineAmount;
      if (otherPurchases) amountSource = 'fuel-line';
    }
  }

  const { date, future } = findDate(lines, today);
  const currency = findCurrency(text);
  const merchant = findMerchant(lines);
  const categoryId = suggestCategory(text, isFuel, categories);

  if (amount === null) warnings.push('Сумму найти не удалось: введите её сами.');
  else if (usedFuelLine) {
    if (otherPurchases) warnings.push('На чеке есть и другие покупки: записана только сумма топлива. Проверьте её.');
  } else if (amountNote) warnings.push(amountNote);
  else if (amountSource === 'largest') warnings.push('Слов «итого», «razem», «suma» не нашлось: сумма взята как самое большое число на чеке. Проверьте её.');
  else if (amountSource === 'liters') warnings.push('Сумма посчитана как литры × цена. Проверьте её.');
  if (date === null) warnings.push(future ? 'Дата на чеке позже сегодняшней: оставлена сегодняшняя.' : 'Дату найти не удалось: оставлена сегодняшняя.');
  if (fuel?.multiple) warnings.push('На чеке несколько строк, похожих на топливо: взята одна. Проверьте литры и сумму.');
  if (isFuel && liters === null) warnings.push('Это похоже на заправку, но литры найти не удалось: введите их сами.');
  if (currency !== 'PLN') warnings.push(`Похоже, чек в ${currency}. В разделе «Автомобиль» суммы только в злотых.`);

  return { amount, amountSource, date, liters, pricePerLiter, merchant, isFuel, currency, categoryId, warnings };
}
