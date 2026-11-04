// theme-init.js — подключается в <head> до стилей, чтобы выбранная тема применялась без мигания.
// Выбор темы хранится в localStorage под ключом "theme" (его же использует ui.js). Нет значения: тема как в системе.
(() => {
  try {
    const mode = localStorage.getItem('theme');
    if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  } catch {
    // хранилище недоступно: остаётся тема системы
  }
})();
