Файлы для распознавания текста чека по фото (прямо на устройстве, без интернета после первого использования).

Что здесь должно лежать (6 файлов, вместе несколько мегабайт):
  tesseract.min.js                  — библиотека Tesseract.js 5.1.1 (Apache License 2.0)
  worker.min.js                     — её фоновый исполнитель
  tesseract-core-simd-lstm.wasm.js  — движок распознавания (iPhone с iOS 16.4 и новее)
  tesseract-core-lstm.wasm.js       — тот же движок для более старых устройств
  pol.traineddata                   — словарь польского языка (tessdata_fast, Apache License 2.0)
  eng.traineddata                   — словарь английского языка (tessdata_fast, Apache License 2.0)

Как скачать:
  1. Откройте Терминал в папке проекта.
  2. Выполните:  bash libs/ocr/download.sh
  3. Если какая-то ссылка не открылась (ошибка 404), пришлите текст ошибки — ссылку поправим.

Как проверить, что всё на месте:  ls libs/ocr  (должны быть все 6 файлов и этот README с download.sh).

Контрольные суммы SHA-256 (заполнить после скачивания, чтобы позже сверять файлы с оригиналом):
  8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa  tesseract-core-lstm.wasm.js
  ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf  tesseract-core-simd-lstm.wasm.js
  a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8  tesseract.min.js
  aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc  worker.min.js
  7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  eng.traineddata
  c4476cdbc0e33d898d32345122b7be1cbf85ace15f920f06c7714756e1ef79b2  pol.traineddata
Проверка на Mac (из папки проекта):  cd libs/ocr && shasum -a 256 *.js *.traineddata  — суммы должны совпасть с этими.

Если приложение будут распространять другим людям, к этим файлам нужно приложить тексты лицензий Apache 2.0.
Важно: файлы должны лежать без изменений, в папке libs/ocr (путь зашит в ocr.js и service-worker.js).
