#!/bin/bash
# Скачивает файлы распознавания фото в папку libs/ocr.
# Запуск (на Mac): откройте Терминал в папке проекта и выполните:  bash libs/ocr/download.sh
# Нужен интернет. Скачивать нужно один раз; потом файлы лежат в проекте и уходят на GitHub вместе с кодом.
set -e
cd "$(dirname "$0")"

TJS=5.1.1   # версия tesseract.js
CORE=5.1.1  # версия tesseract.js-core

get() { echo "Скачиваю $1"; curl -fL --progress-bar -o "$1" "$2"; }

get tesseract.min.js              "https://cdn.jsdelivr.net/npm/tesseract.js@$TJS/dist/tesseract.min.js"
get worker.min.js                 "https://cdn.jsdelivr.net/npm/tesseract.js@$TJS/dist/worker.min.js"
get tesseract-core-simd-lstm.wasm.js "https://cdn.jsdelivr.net/npm/tesseract.js-core@$CORE/tesseract-core-simd-lstm.wasm.js"
get tesseract-core-lstm.wasm.js   "https://cdn.jsdelivr.net/npm/tesseract.js-core@$CORE/tesseract-core-lstm.wasm.js"
get pol.traineddata               "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/pol.traineddata"
get eng.traineddata               "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata"

echo
echo "Готово. Размеры и контрольные суммы (SHA-256) — пришлите их мне, чтобы записать в README:"
ls -lh *.js *.traineddata | awk '{print $5, $9}'
shasum -a 256 *.js *.traineddata
