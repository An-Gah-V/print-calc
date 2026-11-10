// Чтение файлов слайсера: граммы и время печати из .3mf (Bambu Studio / OrcaSlicer)
// и из .gcode (Bambu, Orca, PrusaSlicer, Cura). Ничего никуда не отправляет —
// файл читается прямо в браузере.
"use strict";

const Slicer = (() => {
  // ---------- минимальный чтец zip-архива (.3mf — это zip) ----------
  // Ищем «оглавление» архива (central directory) в конце файла,
  // по нему находим нужный файл и распаковываем встроенным DecompressionStream.
  async function zipEntries(file) {
    const tailSize = Math.min(file.size, 65557 + 22);
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Файл не похож на .3mf (не zip-архив)");
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOffset = tail.getUint32(eocd + 16, true);
    // ZIP64 (архивы больше 4 ГБ или с огромным числом файлов) этот простой чтец не понимает
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error("Архив слишком большой или нестандартный (ZIP64) — сохраните проект заново или загрузите .gcode");
    }
    const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const compSize = cd.getUint32(p + 20, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      const localOffset = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      entries.push({ name, method, compSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function zipRead(file, entry, maxBytes) {
    const head = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error("Повреждённый архив");
    const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const blob = file.slice(start, start + entry.compSize);
    let stream;
    if (entry.method === 0) stream = blob.stream();
    else if (entry.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("Браузер слишком старый: обновите его, чтобы читать .3mf");
      stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } else throw new Error("Неизвестный способ сжатия в архиве");
    // читаем по кускам; для больших G-code хватает начала файла (там заголовок)
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (maxBytes && total >= maxBytes) { reader.cancel(); break; }
    }
    const all = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return new TextDecoder().decode(all);
  }

  // ---------- разбор времени ----------
  // «1d 2h 3m 4s», «2h 15m», «45m 10s» -> часы
  function parseDuration(s) {
    let h = 0, any = false;
    const re = /(\d+(?:[.,]\d+)?)\s*([dhms])/gi;
    let m;
    while ((m = re.exec(s))) {
      const v = parseFloat(m[1].replace(",", "."));
      any = true;
      h += { d: 24, h: 1, m: 1 / 60, s: 1 / 3600 }[m[2].toLowerCase()] * v;
    }
    return any ? h : null;
  }

  // ---------- G-code: ищем в заголовке/хвосте комментарии слайсера ----------
  function parseGcodeText(text) {
    let grams = null, hours = null;
    const num = (re) => { const m = text.match(re); return m ? parseFloat(m[1].replace(",", ".")) : null; };
    // граммы: Bambu «; total filament weight [g] : 12.3», Prusa/Orca «; filament used [g] = 12.3»
    grams = num(/;\s*total filament weight \[g\]\s*[:=]\s*([\d.,]+)/i);
    if (grams == null) {
      const m = text.match(/;\s*(?:total )?filament used \[g\]\s*[:=]\s*([\d.,\s]+)/i);
      if (m) grams = m[1].split(",").map((x) => parseFloat(x)).filter((x) => !isNaN(x)).reduce((a, b) => a + b, 0) || null;
    }
    // время: Bambu «total estimated time: 1h 2m», Prusa «estimated printing time (normal mode) = 1h 2m», Cura «;TIME:3723»
    let m = text.match(/total estimated time\s*[:=]\s*([^;\n]+)/i)
      || text.match(/estimated printing time(?: \(normal mode\))?\s*[:=]\s*([^;\n]+)/i)
      || text.match(/model printing time\s*[:=]\s*([^;\n]+)/i);
    if (m) hours = parseDuration(m[1]);
    if (hours == null) { const t = num(/;\s*TIME\s*:\s*(\d+)/); if (t != null) hours = t / 3600; }
    // Cura пишет длину нити в метрах — переведём в граммы для 1,75 мм и PLA-подобной плотности
    let note = "";
    if (grams == null) {
      const meters = num(/;\s*Filament used\s*:\s*([\d.]+)\s*m/i);
      if (meters != null) {
        grams = meters * 1000 * Math.PI * Math.pow(1.75 / 2, 2) / 1000 * 1.24;
        note = "граммы пересчитаны из метров нити (Ø1,75 мм, плотность 1,24) — проверьте";
      }
    }
    return { grams, hours, note };
  }

  async function readGcode(file) {
    // заголовок у Bambu/Orca в начале, у PrusaSlicer — в конце: читаем оба края
    const part = 256 * 1024;
    const head = await file.slice(0, part).text();
    const tail = file.size > part ? await file.slice(Math.max(part, file.size - part)).text() : "";
    const r = parseGcodeText(head + "\n" + tail);
    if (r.grams == null && r.hours == null) throw new Error("В G-code не нашлось граммов и времени — слайсер не записал их в комментарии");
    return [{ name: file.name.replace(/\.(gcode|gco|g)$/i, ""), grams: r.grams, hours: r.hours, note: r.note }];
  }

  // ---------- .3mf ----------
  function attr(el, key) {
    const m = [...el.querySelectorAll(":scope > metadata")].find((x) => x.getAttribute("key") === key);
    return m ? m.getAttribute("value") : null;
  }

  async function read3mf(file) {
    const entries = await zipEntries(file);
    const info = entries.find((e) => /(^|\/)Metadata\/slice_info\.config$/i.test(e.name));
    const plates = [];
    if (info) {
      // лимит 4 МБ: обычный slice_info весит килобайты, а «zip-бомба» иначе повесила бы вкладку
      const xml = new DOMParser().parseFromString(await zipRead(file, info, 4 * 1024 * 1024), "application/xml");
      for (const pl of xml.querySelectorAll("plate")) {
        const idx = attr(pl, "index");
        const pred = parseFloat(attr(pl, "prediction"));
        let grams = parseFloat(attr(pl, "weight"));
        if (isNaN(grams)) {
          grams = [...pl.querySelectorAll("filament")].reduce((s, f) => s + (parseFloat(f.getAttribute("used_g")) || 0), 0) || NaN;
        }
        // предметы на столе (граммы и время слайсер дал на все сразу)
        const objects = [...pl.querySelectorAll("object")].map((o) => o.getAttribute("name")).filter(Boolean);
        if (isNaN(pred) && isNaN(grams)) continue;
        // название детали — имена моделей на столе (без .stl), иначе «Стол N»
        const uniq = [...new Set(objects.map((o) => o.replace(/\.(stl|step|stp|obj|3mf)$/i, "")))];
        plates.push({
          name: uniq.length ? `${uniq.slice(0, 3).join(", ")}${uniq.length > 3 ? "…" : ""} (стол ${idx})` : `Стол ${idx}`,
          grams: isNaN(grams) ? null : grams,
          hours: isNaN(pred) ? null : pred / 3600,
          objects: objects.length,
          // копии одной модели в слайсере носят одно имя (24 × Ring43.stl) — тогда стол делим
          // на штуки; если модели разные (стакан + крышка, левая + правая боковина),
          // делить нельзя: строка — это весь стол, то есть один комплект
          copies: uniq.length === 1 ? objects.length : 1,
          kinds: uniq,
          note: "",
        });
      }
    }
    // запасной путь: внутри «.gcode.3mf» лежат готовые G-code столов
    if (!plates.length) {
      for (const e of entries.filter((x) => /Metadata\/plate_\d+\.gcode$/i.test(x.name))) {
        const r = parseGcodeText(await zipRead(file, e, 512 * 1024));
        const idx = e.name.match(/plate_(\d+)/)[1];
        if (r.grams != null || r.hours != null) plates.push({ name: `Стол ${idx}`, ...r });
      }
    }
    if (!plates.length) {
      throw new Error("В файле нет данных нарезки. Откройте проект в Bambu Studio / OrcaSlicer, нажмите «Нарезать» и сохраните проект ещё раз.");
    }
    return plates;
  }

  async function read(file) {
    if (/\.3mf$/i.test(file.name)) return read3mf(file);
    if (/\.(gcode|gco|g)$/i.test(file.name)) return readGcode(file);
    throw new Error("Поддерживаются файлы .3mf и .gcode");
  }

  return { read, parseGcodeText, parseDuration };
})();
