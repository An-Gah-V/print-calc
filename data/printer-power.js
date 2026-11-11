// Справочник: среднее потребление электричества популярными 3D-принтерами (FDM).
// Данные собраны 11.11.2026, подробная таблица с расчётами — research/printer-power.xlsx.
// Это .js, а не .json, чтобы страница открывалась двойным щелчком без сервера.
//
// Поля: brand — бренд, model — модель, type — устройство корпуса,
// idle — ожидание, Вт (текст: обычно диапазон), pla/petg/abs/pc — средняя мощность при печати, Вт
// (null — данных нет), max — паспортная (максимальная) мощность, Вт,
// rel — достоверность: "off" официально, "rev" замер в обзоре, "est" оценка,
// note — пояснение, src — ключ источника из SOURCES.
"use strict";

window.PRINTER_POWER = {
  updated: "11.11.2026",
  printers: [
    { brand: "Bambu Lab", model: "A1 mini", type: "Открытый, стол двигается", idle: "6–7", pla: 80, petg: 75, abs: null, pc: null, max: 150, rel: "off", note: "Короткий тест 17–23 мин вместе с нагревом", src: "bambu" },
    { brand: "Bambu Lab", model: "A1", type: "Открытый, стол двигается", idle: "4–5", pla: 95, petg: null, abs: 200, pc: 150, max: 1300, rel: "off", note: "Короткий тест 17–19 мин вместе с нагревом; ABS и PC — так в таблице Bambu, хотя для открытого A1 их не рекомендуют", src: "bambu" },
    { brand: "Bambu Lab", model: "A2L", type: "Открытый, стол двигается", idle: "5–5,5", pla: 145, petg: null, abs: null, pc: null, max: 1000, rel: "off", note: "0,145 кВт·ч за 1 ч печати PLA", src: "bambu" },
    { brand: "Bambu Lab", model: "P1P", type: "Открытый CoreXY", idle: "5–5,6", pla: 110, petg: null, abs: 170, pc: 160, max: 1000, rel: "off", note: "Короткий тест ~16 мин вместе с нагревом", src: "bambu" },
    { brand: "Bambu Lab", model: "P1S", type: "Закрытый CoreXY", idle: "5–6", pla: 105, petg: null, abs: 140, pc: 135, max: 1000, rel: "off", note: "Короткий тест ~16 мин вместе с нагревом", src: "bambu" },
    { brand: "Bambu Lab", model: "P2S", type: "Закрытый CoreXY", idle: "7–8", pla: 200, petg: null, abs: null, pc: null, max: 1200, rel: "off", note: "Мощность во время печати, после нагрева", src: "bambu" },
    { brand: "Bambu Lab", model: "X1C", type: "Закрытый CoreXY", idle: "8,5–10", pla: 105, petg: null, abs: 150, pc: 135, max: 1000, rel: "off", note: "Короткий тест 15–17 мин вместе с нагревом", src: "bambu" },
    { brand: "Bambu Lab", model: "X1E", type: "Закрытый, нагрев камеры", idle: "15–16", pla: 185, petg: null, abs: 260, pc: 230, max: 1350, rel: "off", note: "ABS и PC — с нагревом камеры", src: "bambu" },
    { brand: "Bambu Lab", model: "X2D", type: "Закрытый, нагрев камеры, 2 сопла", idle: "7–8", pla: 250, petg: null, abs: null, pc: 550, max: 1600, rel: "off", note: "Во время печати при 25 °C в комнате; в режиме низкой мощности пик ~750 Вт", src: "bambu" },
    { brand: "Bambu Lab", model: "H2S", type: "Закрытый, нагрев камеры", idle: "26–26,5", pla: 200, petg: 180, abs: null, pc: 330, max: 1800, rel: "off", note: "В режиме низкой мощности пик ~860 Вт", src: "bambu" },
    { brand: "Bambu Lab", model: "H2D", type: "Закрытый, нагрев камеры, 2 сопла", idle: "25–27", pla: 197, petg: 150, abs: null, pc: 395, max: 1800, rel: "off", note: "В режиме низкой мощности пик ~860 Вт", src: "bambu" },
    { brand: "Bambu Lab", model: "H2C", type: "Закрытый, нагрев камеры, смена сопел", idle: "26–28,6", pla: 200, petg: 193, abs: null, pc: 294, max: 1800, rel: "off", note: "В режиме низкой мощности пик ~860 Вт", src: "bambu" },
    { brand: "Bambu Lab", model: "H3C", type: "Закрытый, нагрев камеры", idle: "12–12,7", pla: 240, petg: null, abs: null, pc: 540, max: 2250, rel: "off", note: "Во время печати при 25 °C в комнате; в режиме низкой мощности пик 1050 Вт", src: "bambu" },
    { brand: "Prusa", model: "MK4S", type: "Открытый, стол двигается", idle: null, pla: 80, petg: null, abs: 120, pc: null, max: 240, rel: "off", note: "Среднее по MK-серии при 26 °C в комнате", src: "prusa" },
    { brand: "Prusa", model: "CORE One / CORE One+", type: "Закрытый CoreXY", idle: null, pla: 90, petg: null, abs: 110, pc: null, max: 240, rel: "est", note: "Цифры Prusa, но найдены только у продавцов", src: "core1" },
    { brand: "Creality", model: "Ender-3 (классический)", type: "Открытый, стол двигается", idle: null, pla: 125, petg: null, abs: null, pc: null, max: 350, rel: "rev", note: "Пик при нагреве 277 Вт; из 125 Вт около 80 Вт уходит на стол", src: "ender3" },
    { brand: "Creality", model: "K1C", type: "Закрытый CoreXY", idle: null, pla: 144, petg: null, abs: null, pc: null, max: 350, rel: "rev", note: "Среднее за 50-минутную печать вместе с нагревом", src: "k1c" },
    { brand: "Creality", model: "K1 Max", type: "Закрытый CoreXY", idle: null, pla: 175, petg: null, abs: null, pc: null, max: 1000, rel: "rev", note: "Один замер из сторонней сводки", src: "k1max" },
    { brand: "Creality", model: "K2 Plus Combo", type: "Закрытый, нагрев камеры", idle: null, pla: null, petg: null, abs: null, pc: null, max: 1200, rel: "est", note: "Замеров не нашли — только паспорт", src: "k2" },
    { brand: "Elegoo", model: "Centauri Carbon", type: "Закрытый CoreXY", idle: "43–45", pla: 160, petg: null, abs: null, pc: null, max: 1100, rel: "rev", note: "Пик при нагреве 1030 Вт; ожидание — замер одного владельца", src: "cc" },
    { brand: "Anycubic", model: "Kobra 3", type: "Открытый, стол двигается", idle: null, pla: 205, petg: null, abs: null, pc: null, max: 400, rel: "rev", note: "Печать PLA, замер Igor'sLAB", src: "kobra3" },
    { brand: "QIDI", model: "Plus4", type: "Закрытый, нагрев камеры", idle: null, pla: null, petg: null, abs: 375, pc: null, max: 850, rel: "est", note: "ABS с нагревом камеры: 300–450 Вт по оценке QIDI (взята середина); без нагрева 160–280 Вт", src: "qidi" },
    { brand: "Flashforge", model: "Adventurer 5M Pro", type: "Закрытый CoreXY", idle: null, pla: 105, petg: null, abs: null, pc: null, max: 350, rel: "est", note: "Общая оценка Flashforge для PLA 90–120 Вт (взята середина)", src: "ff" },
  ],
  sources: {
    bambu: { title: "Bambu Lab Wiki — мощность принтеров и AMS (официально)", url: "https://wiki.bambulab.com/en/general/power-consumption" },
    prusa: { title: "Prusa — FAQ: потребление MK-серии (официально)", url: "https://help.prusa3d.com/article/faq-frequently-asked-questions_1932" },
    core1: { title: "Техпараметры Prusa CORE One у продавца", url: "https://www.printedsolid.com/pages/prusa-core-one-technical-parameters" },
    ender3: { title: "3DPrinterly — замер Ender 3", url: "https://3dprinterly.com/how-much-electric-power-does-a-3d-printer-use/" },
    k1c: { title: "Обзор Creality K1C (The Phonograph)", url: "https://www.thephonograph.net/electronics-tech-reviews/creality-k1c-review/" },
    k1max: { title: "3D Calculators — потребление по моделям", url: "https://3dcalculators.com/blog/3d-printer-power-consumption-by-model" },
    k2: { title: "Creality K2 Plus Combo — характеристики", url: "https://www.creality.com/products/creality-k2-plus-cfs-combo" },
    cc: { title: "Igor'sLAB — обзор Elegoo Centauri Carbon (с замером)", url: "https://www.igorslab.de/en/elegoo-centauri-carbon-3d-drucker-im-test/6/" },
    kobra3: { title: "Igor'sLAB — сравнение с Anycubic Kobra 3", url: "https://www.igorslab.de/en/elegoo-centauri-carbon-3d-drucker-im-test/6/" },
    qidi: { title: "QIDI — сколько электричества берёт 3D-принтер", url: "https://qidi3d.com/blogs/news/3d-printer-electricity-cost-per-hour" },
    ff: { title: "Flashforge — много ли электричества берёт 3D-принтер", url: "https://www.flashforge.com/blogs/news/do-3d-printers-use-a-lot-of-electricity" },
  },
};
