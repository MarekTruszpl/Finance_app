// receipt-view.js — всё на экране, что связано с фото чека: значок камеры, строка состояния, раздел в настройках.
// Сам разбор текста лежит в receipt.js, распознавание фото — в ocr.js.

const $ = (id) => document.getElementById(id);

// Строка над формой: ход работы или предупреждения. kind: 'info' | 'warn'. Пустой текст — скрыть.
export function showReceiptStatus(text, kind = 'info') {
  const el = $('receipt-status');
  el.textContent = text ?? '';
  el.classList.toggle('receipt-note--warn', kind === 'warn');
  el.hidden = !text;
}

// Пока идёт распознавание, значок камеры недоступен
export function setReceiptBusy(busy) {
  $('receipt-camera').disabled = busy;
}

// Показать или скрыть текст последнего чека (в настройках, для проверки распознавания)
export function toggleReceiptDebug(text) {
  const el = $('receipt-debug');
  if (!el.hidden) {
    el.hidden = true;
    return;
  }
  el.textContent = text.trim() === '' ? 'Пока нет распознанных чеков.' : text;
  el.hidden = false;
}

// Камера открывается сразу (capture), галерея — из настроек. callback получает файл с фото.
export function onReceiptPhoto(callback) {
  $('receipt-camera').addEventListener('click', () => $('receipt-file').click());
  $('receipt-gallery').addEventListener('click', () => $('receipt-file-gallery').click());
  for (const id of ['receipt-file', 'receipt-file-gallery']) {
    $(id).addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // чтобы можно было выбрать то же фото повторно
      if (file) callback(file);
    });
  }
}

export function onReceiptShowText(callback) {
  $('receipt-show-text').addEventListener('click', callback);
}
