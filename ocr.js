// ocr.js — распознавание текста чека по фото прямо на устройстве (Tesseract.js).
// Фото никуда не отправляется и не сохраняется: оно читается в память, уменьшается, распознаётся и забывается.
// Файлы библиотеки лежат в libs/ocr/ (см. libs/ocr/README.txt). Грузятся только при первом распознавании.
// Разбор найденного текста (сумма, дата, литры) — в receipt.js.

export const OCR_DIR = './libs/ocr/';
export const OCR_LANGS = 'pol+eng';

const MAX_SIDE = 3000;        // самая длинная сторона после уменьшения, px
const MAX_PIXELS = 4_000_000; // общее число пикселей после уменьшения (бережём память iPhone)

export class OcrError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code; // 'unsupported' | 'missing-files' | 'image' | 'cancelled' | другое
  }
}

// ---------- Чистые функции (покрыты тестами) ----------

// Во сколько раз уменьшить фото. Увеличивать не нужно.
export function fitSize(width, height, { maxSide = MAX_SIDE, maxPixels = MAX_PIXELS } = {}) {
  const scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

// Делает фото чёрно-белым и растягивает контраст (1% самых тёмных и светлых пикселей отбрасываем).
// data — массив RGBA (как в ImageData), меняется на месте.
export function enhanceGray(data) {
  const total = data.length / 4;
  const gray = new Uint8Array(total);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < total; i += 4, p++) {
    const g = (299 * data[i] + 587 * data[i + 1] + 114 * data[i + 2]) / 1000 | 0;
    gray[p] = g;
    hist[g]++;
  }

  let low = 0;
  let high = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { low = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.99) { high = v; break; } }

  const stretch = high - low >= 30; // у почти одноцветного фото растягивать нечего
  for (let i = 0, p = 0; p < total; i += 4, p++) {
    let g = gray[p];
    if (stretch) g = Math.max(0, Math.min(255, ((g - low) * 255) / (high - low)));
    data[i] = data[i + 1] = data[i + 2] = g;
    data[i + 3] = 255;
  }
  return { low, high, stretched: stretch };
}

// Русский текст для индикатора по статусу Tesseract; null — статус не показываем
export function describeOcrStatus(status, progress = 0) {
  const percent = `${Math.round(progress * 100)}%`;
  switch (status) {
    case 'loading tesseract core':
    case 'initializing tesseract':
    case 'initialized tesseract':
      return 'Запускаю распознавание…';
    case 'loading language traineddata':
    case 'loaded language traineddata':
      return 'Загружаю словари…';
    case 'initializing api':
    case 'initialized api':
      return 'Готовлюсь…';
    case 'recognizing text':
      return `Читаю чек… ${percent}`;
    default:
      return null;
  }
}

// Понятное сообщение об ошибке; null — ошибка не показывается (отмена)
export function describeOcrError(err) {
  const code = err?.code;
  if (code === 'cancelled') return null;
  if (code === 'unsupported') {
    return 'Это устройство не поддерживает распознавание по фото. Вставьте текст или отсканируйте его камерой в поле ниже.';
  }
  if (code === 'missing-files') {
    return 'Файлы распознавания не найдены (папка libs/ocr). Инструкция: libs/ocr/README.txt.';
  }
  if (code === 'image') return 'Не удалось открыть фото. Попробуйте другое.';
  const raw = String(err?.message ?? err ?? '').slice(0, 120);
  return `Не удалось распознать фото${raw ? `: ${raw}` : ''}. Если ошибка повторяется, проверьте файлы в libs/ocr.`;
}

// ---------- Работа с браузером ----------

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new OcrError('image'));
    reader.readAsDataURL(file); // data: разрешён политикой безопасности (blob: — нет)
  });
}

// Фото -> уменьшенный чёрно-белый PNG (Blob). Поворот по EXIF браузер применяет сам.
async function prepareImage(file) {
  const img = new Image();
  img.src = await readAsDataUrl(file);
  try {
    await img.decode();
  } catch {
    throw new OcrError('image');
  }
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  enhanceGray(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 0; // освободить память
  if (!blob) throw new OcrError('image');
  return blob;
}

let tesseractPromise = null;

// Подключает libs/ocr/tesseract.min.js при первом использовании
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${OCR_DIR}tesseract.min.js`;
      script.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new OcrError('missing-files')));
      script.onerror = () => {
        tesseractPromise = null; // можно попробовать снова
        reject(new OcrError('missing-files'));
      };
      document.head.append(script);
    });
  }
  return tesseractPromise;
}

let current = null; // идущее распознавание: { cancel }

// Прервать распознавание (например, пользователь закрыл панель)
export function cancelRecognition() {
  if (current) current.cancel();
}

// Фото (File) -> текст чека. onProgress получает готовую строку для индикатора.
export async function recognizeReceipt(file, onProgress = () => {}) {
  if (typeof WebAssembly === 'undefined') throw new OcrError('unsupported');

  let worker = null;
  let rejectCancel;
  const cancelled = new Promise((_, reject) => { rejectCancel = reject; });
  cancelled.catch(() => {}); // чтобы отмена без ожидающего не давала лишней ошибки в консоли
  current = {
    cancel: () => {
      worker?.terminate();
      rejectCancel(new OcrError('cancelled'));
    },
  };

  const work = (async () => {
    onProgress('Готовлю фото…');
    const image = await prepareImage(file);
    const Tesseract = await loadTesseract();
    const base = new URL(OCR_DIR, document.baseURI).href;
    worker = await Tesseract.createWorker(OCR_LANGS, 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,                  // внутри ищется tesseract-core(-simd)-lstm.wasm.js
      langPath: base,                  // pol.traineddata и eng.traineddata
      gzip: false,                     // словари лежат без сжатия
      workerBlobURL: false,            // запуск из файла, поэтому blob: в политике безопасности не нужен
      cacheMethod: 'none',             // копию хранит service worker, дублировать в IndexedDB не нужно
      logger: (m) => {
        const text = describeOcrStatus(m.status, m.progress);
        if (text) onProgress(text);
      },
    });
    // 4 — «одна колонка текста переменной ширины», обычно лучше всего для чеков
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM?.SINGLE_COLUMN ?? '4',
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(image);
    return data.text;
  })();
  work.catch(() => {}); // если отменили раньше, чем работа завершилась

  try {
    return await Promise.race([work, cancelled]);
  } finally {
    current = null;
    if (worker) await worker.terminate().catch(() => {}); // освободить память телефона
  }
}
