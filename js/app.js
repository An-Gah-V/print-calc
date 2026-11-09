// Интерфейс калькулятора: хранит состояние, рисует таблицы и итоги.
// Формулы — в calc.js, чтение файлов слайсера — в slicer.js.
"use strict";

(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const OZ = window.OZON_DATA || null;
  const KEY = "print-calc.v1";
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = Calc.n;

  // ---------- форматирование ----------
  const fmt0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const rub = (x) => (Math.abs(x) >= 100 ? fmt0 : fmt2).format(x) + " ₽";
  const grams = (g) => (g >= 1000 ? fmt2.format(g / 1000) + " кг" : fmt0.format(g) + " г");
  function hm(h) {
    if (!(h > 0)) return "0 мин";
    let total = Math.round(h * 60);
    const d = Math.floor(total / 1440); total -= d * 1440;
    const hh = Math.floor(total / 60), mm = total % 60;
    return [d ? d + " сут" : "", hh ? hh + " ч" : "", mm ? mm + " мин" : ""].filter(Boolean).join(" ") || "0 мин";
  }
  const ceilTo = (x, step) => Math.ceil(x / step - 1e-9) * step;

  // ---------- состояние по умолчанию ----------
  function defaults() {
    const printer = { id: uid(), name: "Мой принтер", powerW: 150, price: 60000, lifeH: 5000, maintPerH: 3 };
    const pla = { id: uid(), name: "PLA", spoolPrice: 1200, spoolG: 1000 };
    const petg = { id: uid(), name: "PETG", spoolPrice: 1300, spoolG: 1000 };
    return {
      settings: { tariff: 6, laborRate: 300, brakPct: 5, hoursPerDay: 16 },
      printers: [printer],
      materials: [pla, petg],
      product: newProduct(printer.id, pla.id),
      saved: [],
    };
  }
  function newProduct(printerId, materialId) {
    return {
      id: uid(), name: "",
      parts: [{ id: uid(), name: "Деталь 1", grams: "", hours: "", perPlate: 1, qty: 1, printerId, materialId }],
      laborMin: 10, packaging: 0, otherCost: 0,
      sale: {
        mode: "off", markupPct: 100, taxPct: 6, profitMode: "pct", profitPct: 20, profitRub: 300, checkPrice: "",
        ozon: { typeRef: null, typeLabel: "", scheme: "FBS", acqPct: 1.5, otherRub: 0, dims: ["", "", ""],
          origin: "Москва, МО и Дальние регионы", logiMode: "avg", logiManual: 0 },
        custom: { commPct: 20, logiRub: 0, acqPct: 0, otherRub: 0 },
      },
    };
  }

  // Загружаем сохранённое; если чего-то не хватает (старая версия) — добираем из умолчаний
  // Приводит любые данные (из браузера или из импортируемого файла) к рабочему виду:
  // выбрасывает мусор, пустые списки заменяет умолчаниями. Возвращает новое состояние.
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  function sanitize(s) {
    const d = defaults();
    if (!isObj(s)) return d;
    const withId = (list) => (Array.isArray(list) ? list.filter((x) => isObj(x) && x.id != null).map((x) => ({ ...x, id: String(x.id) })) : []);
    const out = {
      settings: { ...d.settings, ...(isObj(s.settings) ? s.settings : {}) },
      printers: withId(s.printers),
      materials: withId(s.materials),
    };
    if (!out.printers.length) out.printers = d.printers;
    if (!out.materials.length) out.materials = d.materials;
    out.saved = (Array.isArray(s.saved) ? s.saved : [])
      .filter((x) => isObj(x) && isObj(x.product))
      .map((x) => ({ ...x, product: fixProduct(x.product, out) }));
    out.product = fixProduct(isObj(s.product) ? s.product : {}, out);
    return out;
  }
  function load() {
    try { return sanitize(JSON.parse(localStorage.getItem(KEY) || "null")); }
    catch (e) { return defaults(); /* хранилище недоступно или испорчено — начинаем с умолчаний */ }
  }
  function fixProduct(p, st) {
    const base = newProduct(st.printers[0].id, st.materials[0].id);
    const out = { ...base, ...p, id: String(p.id || base.id) };
    out.sale = { ...base.sale, ...(isObj(p.sale) ? p.sale : {}) };
    out.sale.ozon = { ...base.sale.ozon, ...(isObj(p.sale?.ozon) ? p.sale.ozon : {}) };
    out.sale.custom = { ...base.sale.custom, ...(isObj(p.sale?.custom) ? p.sale.custom : {}) };
    if (!Array.isArray(out.sale.ozon.dims) || out.sale.ozon.dims.length !== 3) out.sale.ozon.dims = ["", "", ""];
    // категория хранится как [категория, подкатегория, название типа]; старый вид (номер) сбрасываем
    const ref = out.sale.ozon.typeRef;
    if (!Array.isArray(ref) || ref.length !== 3 || typeof ref[2] !== "string") { out.sale.ozon.typeRef = null; out.sale.ozon.typeLabel = ""; }
    if (!["off", "markup", "ozon", "custom"].includes(out.sale.mode)) out.sale.mode = "off";
    if (out.sale.mode === "ozon" && !OZ) out.sale.mode = "off"; // файл тарифов не загрузился
    const parts = (Array.isArray(p.parts) ? p.parts : []).filter(isObj).map((x) => ({ ...x, id: String(x.id || uid()) }));
    out.parts = parts.length ? parts : base.parts;
    return out;
  }

  let S = load();
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow();
    }, 250);
  }
  function saveNow() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* приватный режим — просто не сохраняем */ }
  }
  // вкладку закрывают сразу после ввода — сохраняем немедленно, не дожидаясь таймера
  addEventListener("pagehide", () => { clearTimeout(saveTimer); saveNow(); });
  function toast(text) {
    const t = $("#toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400);
  }

  // ---------- вкладки и тема ----------
  function showTab(name) {
    $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
    if (name === "saved") renderSaved();
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  try { const th = localStorage.getItem(KEY + ".theme"); if (th) document.documentElement.dataset.theme = th; } catch (e) {}
  $("#themeBtn").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY + ".theme", next); } catch (e) {}
  });

  // ---------- детали ----------
  function optionList(list, sel) {
    return list.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(x.name || "без названия")}</option>`).join("");
  }
  function renderParts() {
    const body = $("#partsBody");
    body.innerHTML = S.product.parts.map((p) => {
      // сначала округляем до минут, потом делим — иначе 59,7 мин превратились бы в «60 мин»
      const totalMin = Math.round(num(p.hours) * 60);
      const hh = totalMin ? Math.floor(totalMin / 60) : "";
      const mm = totalMin ? totalMin % 60 : "";
      return `<tr data-id="${esc(p.id)}">
        <td data-label="Деталь"><input data-f="name" value="${esc(p.name)}" aria-label="Название детали"></td>
        <td data-label="Граммы"><input type="number" min="0" step="0.1" data-f="grams" value="${esc(p.grams)}" aria-label="Граммы" inputmode="decimal"></td>
        <td data-label="Время"><div class="time"><input type="number" min="0" step="1" data-f="hh" value="${hh}" aria-label="Часы" inputmode="numeric"><span>ч</span>
          <input type="number" min="0" max="59" step="1" data-f="mm" value="${mm}" aria-label="Минуты" inputmode="numeric"><span>мин</span></div></td>
        <td data-label="Шт. на столе"><input type="number" min="1" step="1" data-f="perPlate" value="${esc(p.perPlate)}" aria-label="Штук на столе" inputmode="numeric"></td>
        <td data-label="Нужно шт."><input type="number" min="0" step="1" data-f="qty" value="${esc(p.qty)}" aria-label="Нужно штук на изделие" inputmode="numeric"></td>
        <td data-label="Материал / принтер"><div class="part-sel">
          <select data-f="materialId" aria-label="Материал">${optionList(S.materials, p.materialId)}</select>
          <select data-f="printerId" aria-label="Принтер">${optionList(S.printers, p.printerId)}</select></div></td>
        <td class="num" data-cost data-label="₽ за изделие"></td>
        <td><button class="icon-btn" data-del title="Удалить деталь" aria-label="Удалить деталь">×</button></td>
      </tr>`;
    }).join("");
  }
  $("#partsBody").addEventListener("input", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const p = S.product.parts.find((x) => x.id === tr.dataset.id); if (!p) return;
    const f = e.target.dataset.f;
    if (f === "hh" || f === "mm") {
      const hh = num($('[data-f="hh"]', tr).value), mm = num($('[data-f="mm"]', tr).value);
      p.hours = hh + mm / 60;
    } else p[f] = e.target.value;
    update();
  });
  $("#partsBody").addEventListener("change", (e) => { if (e.target.tagName === "SELECT") update(); });
  $("#partsBody").addEventListener("click", (e) => {
    if (!e.target.closest("[data-del]")) return;
    const id = e.target.closest("tr").dataset.id;
    S.product.parts = S.product.parts.filter((x) => x.id !== id);
    renderParts(); update();
  });
  $("#addPart").addEventListener("click", () => {
    const last = S.product.parts[S.product.parts.length - 1];
    S.product.parts.push({ id: uid(), name: "Деталь " + (S.product.parts.length + 1), grams: "", hours: "", perPlate: 1, qty: 1,
      printerId: last?.printerId || S.printers[0].id, materialId: last?.materialId || S.materials[0].id });
    renderParts(); update();
    $("#partsBody tr:last-child input").focus();
  });

  // ---------- загрузка файлов слайсера ----------
  const drop = $("#drop"), fileInput = $("#fileInput");
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); handleFiles(e.dataTransfer.files); });
  // сначала копируем список: очистка поля в Chrome опустошает его, пока файлы ещё читаются
  fileInput.addEventListener("change", () => { const list = [...fileInput.files]; fileInput.value = ""; handleFiles(list); });

  async function handleFiles(files) {
    const msg = $("#fileMsg");
    const added = [], errors = [];
    for (const file of files) {
      try {
        const plates = await Slicer.read(file);
        for (const pl of plates) added.push({ ...pl, file: file.name });
      } catch (err) { errors.push(`${file.name}: ${err.message}`); }
    }
    if (added.length) {
      // если в изделии одна пустая деталь — заменяем её
      const parts = S.product.parts;
      if (parts.length === 1 && !num(parts[0].grams) && !num(parts[0].hours)) S.product.parts = [];
      const last = parts[parts.length - 1];
      for (const pl of added) {
        S.product.parts.push({ id: uid(), name: pl.name, grams: pl.grams != null ? +pl.grams.toFixed(2) : "",
          hours: pl.hours != null ? pl.hours : "", perPlate: Math.max(pl.objects || 1, 1), qty: Math.max(pl.objects || 1, 1),
          printerId: last?.printerId || S.printers[0].id, materialId: last?.materialId || S.materials[0].id });
      }
      if (!S.product.name) S.product.name = added[0].file.replace(/\.(gcode\.)?(3mf|gcode|gco|g)$/i, "");
      renderAll();
    }
    const notes = added.filter((x) => x.note).map((x) => `${x.name}: ${x.note}`);
    msg.hidden = false;
    msg.className = "msg" + (errors.length && !added.length ? " err" : "");
    msg.innerHTML = [
      added.length ? `Добавлено столов: ${added.length}. Проверьте «Шт. на столе» и «Нужно шт.» — сколько деталей на столе и сколько их нужно на изделие.` : "",
      ...notes.map(esc), ...errors.map((x) => `<span class="err-line">${esc(x)}</span>`),
    ].filter(Boolean).join("<br>");
  }

  // ---------- поля изделия ----------
  const bindNum = (sel, get, set) => {
    const el = $(sel);
    el.addEventListener("input", () => { set(el.value); update(); });
    return () => { el.value = get() ?? ""; };
  };
  const fillers = [
    bindNum("#laborMin", () => S.product.laborMin, (v) => (S.product.laborMin = v)),
    bindNum("#packaging", () => S.product.packaging, (v) => (S.product.packaging = v)),
    bindNum("#otherCost", () => S.product.otherCost, (v) => (S.product.otherCost = v)),
    bindNum("#markupPct", () => S.product.sale.markupPct, (v) => (S.product.sale.markupPct = v)),
    bindNum("#taxPct", () => S.product.sale.taxPct, (v) => (S.product.sale.taxPct = v)),
    bindNum("#checkPrice", () => S.product.sale.checkPrice, (v) => (S.product.sale.checkPrice = v)),
    bindNum("#ozonAcq", () => S.product.sale.ozon.acqPct, (v) => (S.product.sale.ozon.acqPct = v)),
    bindNum("#ozonOther", () => S.product.sale.ozon.otherRub, (v) => (S.product.sale.ozon.otherRub = v)),
    bindNum("#logiManual", () => S.product.sale.ozon.logiManual, (v) => (S.product.sale.ozon.logiManual = v)),
    bindNum("#cComm", () => S.product.sale.custom.commPct, (v) => (S.product.sale.custom.commPct = v)),
    bindNum("#cLogi", () => S.product.sale.custom.logiRub, (v) => (S.product.sale.custom.logiRub = v)),
    bindNum("#cAcq", () => S.product.sale.custom.acqPct, (v) => (S.product.sale.custom.acqPct = v)),
    bindNum("#cOther", () => S.product.sale.custom.otherRub, (v) => (S.product.sale.custom.otherRub = v)),
    ...["dimL", "dimW", "dimH"].map((id, i) => bindNum("#" + id, () => S.product.sale.ozon.dims[i], (v) => (S.product.sale.ozon.dims[i] = v))),
  ];
  $("#productName").addEventListener("input", (e) => { S.product.name = e.target.value; persist(); });
  // прибыль: одно поле, единица — в выпадающем списке
  $("#profitVal").addEventListener("input", (e) => {
    if (S.product.sale.profitMode === "rub") S.product.sale.profitRub = e.target.value; else S.product.sale.profitPct = e.target.value;
    update();
  });
  $("#profitMode").addEventListener("change", (e) => {
    S.product.sale.profitMode = e.target.value;
    $("#profitVal").value = e.target.value === "rub" ? S.product.sale.profitRub : S.product.sale.profitPct;
    update();
  });
  $$("#saleMode button").forEach((b) => b.addEventListener("click", () => { S.product.sale.mode = b.dataset.mode; renderSaleMode(); update(); }));
  function renderSaleMode() {
    const m = S.product.sale.mode;
    $$("#saleMode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    $$("#saleBody [data-show]").forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(m)));
    $("[data-logi-manual]").hidden = S.product.sale.ozon.logiMode !== "manual" && S.product.sale.ozon.scheme !== "rFBS";
  }

  // ---------- Ozon: схема, кластер, поиск категории ----------
  if (OZ) {
    $("#ozonScheme").innerHTML = OZ.schemes.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#ozonOrigin").innerHTML = Object.keys(OZ.logistics.origins).map((o) => `<option>${esc(o)}</option>`).join("");
    $("#ozonDate").textContent = OZ.date;
    $("#ozonSrc").href = OZ.source;
    $("#ozonFoot").textContent = "Тарифы Ozon: " + OZ.date;
  } else {
    $("[data-mode='ozon']").disabled = true;
    $("[data-mode='ozon']").title = "Не загрузился файл data/ozon-data.js";
  }
  $("#ozonScheme").addEventListener("change", (e) => { S.product.sale.ozon.scheme = e.target.value; renderSaleMode(); update(); });
  $("#ozonOrigin").addEventListener("change", (e) => { S.product.sale.ozon.origin = e.target.value; update(); });
  $("#logiMode").addEventListener("change", (e) => { S.product.sale.ozon.logiMode = e.target.value; renderSaleMode(); update(); });

  let ozIndex = null;
  function buildIndex() {
    ozIndex = [];
    for (const [cat, subs] of Object.entries(OZ.commissions.tree)) {
      for (const [sub, list] of Object.entries(subs)) {
        list.forEach((item) => ozIndex.push({ type: item[0], path: `${cat} › ${sub}`, ref: [cat, sub, item[0]],
          lc: (item[0] + " " + sub + " " + cat).toLowerCase().replace(/ё/g, "е") }));
      }
    }
  }
  const search = $("#ozonSearch"), results = $("#ozonResults");
  let found = [], active = -1;
  search.addEventListener("input", () => {
    if (!OZ) return;
    if (!ozIndex) buildIndex();
    const words = search.value.toLowerCase().replace(/ё/g, "е").split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) { results.hidden = true; return; }
    // сначала те, где совпадает сам тип товара, потом — по категории
    found = ozIndex.filter((x) => words.every((w) => x.lc.includes(w)))
      .sort((a, b) => (b.type.toLowerCase().includes(words[0]) - a.type.toLowerCase().includes(words[0])) || a.type.length - b.type.length)
      .slice(0, 40);
    active = -1;
    results.innerHTML = found.length
      ? found.map((x, i) => `<button type="button" role="option" data-i="${i}">${esc(x.type)}<small>${esc(x.path)}</small></button>`).join("")
      : `<div class="note" style="padding:8px 12px">Ничего не нашлось — попробуйте другое слово</div>`;
    results.hidden = false;
  });
  search.addEventListener("keydown", (e) => {
    if (results.hidden || !found.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length;
      $$("button", results).forEach((b, i) => b.classList.toggle("active", i === active));
      $$("button", results)[active].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); pick(found[Math.max(active, 0)]); }
    else if (e.key === "Escape") results.hidden = true;
  });
  results.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick(found[+b.dataset.i]); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".ozon .wide")) results.hidden = true; });
  function pick(x) {
    if (!x) return;
    S.product.sale.ozon.typeRef = x.ref;
    S.product.sale.ozon.typeLabel = `${x.type} (${x.path})`;
    search.value = ""; results.hidden = true;
    update();
  }

  // ---------- справочники ----------
  function renderRefs() {
    $$("[data-set]").forEach((el) => (el.value = S.settings[el.dataset.set] ?? ""));
    $("#printersBody").innerHTML = S.printers.map((p) => `<tr data-id="${esc(p.id)}">
      <td><input data-f="name" value="${esc(p.name)}" aria-label="Название принтера"></td>
      <td><input type="number" min="0" step="10" data-f="powerW" value="${esc(p.powerW)}" aria-label="Мощность, Вт" inputmode="decimal"></td>
      <td><input type="number" min="0" step="1000" data-f="price" value="${esc(p.price)}" aria-label="Цена, ₽" inputmode="decimal"></td>
      <td><input type="number" min="1" step="100" data-f="lifeH" value="${esc(p.lifeH)}" aria-label="Ресурс, ч" inputmode="decimal"></td>
      <td><input type="number" min="0" step="0.5" data-f="maintPerH" value="${esc(p.maintPerH)}" aria-label="Обслуживание, ₽/ч" inputmode="decimal"></td>
      <td class="num" data-wear>${rub(Calc.wearPerHour(p))}</td>
      <td><button class="icon-btn" data-del title="Удалить принтер" aria-label="Удалить принтер">×</button></td></tr>`).join("");
    $("#materialsBody").innerHTML = S.materials.map((m) => `<tr data-id="${esc(m.id)}">
      <td><input data-f="name" value="${esc(m.name)}" aria-label="Название материала"></td>
      <td><input type="number" min="0" step="10" data-f="spoolPrice" value="${esc(m.spoolPrice)}" aria-label="Цена катушки, ₽" inputmode="decimal"></td>
      <td><input type="number" min="1" step="50" data-f="spoolG" value="${esc(m.spoolG)}" aria-label="Вес катушки, г" inputmode="decimal"></td>
      <td class="num" data-gram>${fmt2.format(num(m.spoolPrice) / (num(m.spoolG) || 1000))} ₽</td>
      <td><button class="icon-btn" data-del title="Удалить материал" aria-label="Удалить материал">×</button></td></tr>`).join("");
  }
  $$("[data-set]").forEach((el) => el.addEventListener("input", () => { S.settings[el.dataset.set] = el.value; update(); }));
  function refTable(bodySel, listName, afterInput) {
    $(bodySel).addEventListener("input", (e) => {
      const tr = e.target.closest("tr");
      const item = S[listName].find((x) => x.id === tr.dataset.id);
      item[e.target.dataset.f] = e.target.value;
      afterInput(tr, item);
      if (e.target.dataset.f === "name") renderParts();
      update();
    });
    $(bodySel).addEventListener("click", (e) => {
      if (!e.target.closest("[data-del]")) return;
      if (S[listName].length === 1) { toast("Нужен хотя бы один"); return; }
      const id = e.target.closest("tr").dataset.id;
      S[listName] = S[listName].filter((x) => x.id !== id);
      renderRefs(); renderParts(); update();
    });
  }
  refTable("#printersBody", "printers", (tr, p) => ($("[data-wear]", tr).textContent = rub(Calc.wearPerHour(p))));
  refTable("#materialsBody", "materials", (tr, m) => ($("[data-gram]", tr).textContent = fmt2.format(num(m.spoolPrice) / (num(m.spoolG) || 1000)) + " ₽"));
  $("#addPrinter").addEventListener("click", () => {
    S.printers.push({ id: uid(), name: "Принтер " + (S.printers.length + 1), powerW: 150, price: 50000, lifeH: 5000, maintPerH: 3 });
    renderRefs(); renderParts(); update();
  });
  $("#addMaterial").addEventListener("click", () => {
    S.materials.push({ id: uid(), name: "Материал " + (S.materials.length + 1), spoolPrice: 1200, spoolG: 1000 });
    renderRefs(); renderParts(); update();
  });

  // ---------- итог ----------
  const COLORS = [["material", "Пластик", "--c-material"], ["energy", "Электричество", "--c-energy"], ["wear", "Износ принтера", "--c-wear"],
    ["brakExtra", "Запас на брак", "--c-brak"], ["labor", "Работа", "--c-labor"], ["extras", "Упаковка и прочее", "--c-extras"]];

  function renderSummary(c) {
    const parts = COLORS.map(([k, label, color]) => ({ label, color, v: c[k] })).filter((x) => x.v > 0.0049);
    const tot = c.total || 1;
    $("#summary").innerHTML = `
      <div class="muted" style="font-size:13px">Себестоимость${S.product.name ? " · " + esc(S.product.name) : ""}</div>
      <div class="total-big">${rub(c.total)}</div>
      <div class="total-sub">за одно изделие</div>
      <div class="bar" aria-hidden="true">${parts.map((p) => `<span style="width:${(p.v / tot) * 100}%;background:var(${p.color})"></span>`).join("")}</div>
      <ul class="legend">${COLORS.map(([k, label, color]) => `<li><span class="dot" style="background:var(${color})"></span>
        <span class="lbl">${label}</span><span class="num">${rub(c[k])}</span><span class="pc">${c.total ? Math.round((c[k] / tot) * 100) : 0} %</span></li>`).join("")}</ul>
      <div class="facts">
        <div>Пластик<b>${grams(c.grams)}</b></div>
        <div>Время печати<b>${hm(c.hours)}</b></div>
        <div>С учётом брака<b>${hm(c.hoursWithBrak)}</b></div>
        <div>Изделий в месяц<b>${c.perMonth ? "≈ " + fmt0.format(Math.floor(c.perMonth)) : "—"}</b><span>на 1 принтере, ${fmt0.format(num(S.settings.hoursPerDay))} ч/сут</span></div>
      </div>`;
  }

  function breakdownTable(r, costTotal) {
    const line = (label, v, cls = "minus") => `<tr><td>${label}</td><td class="num ${cls}">${v}</td></tr>`;
    const margin = r.price ? Math.round((r.profit / r.price) * 100) : 0;
    return `<table class="breakdown">
      ${line("Цена продажи", rub(r.price), "")}
      ${r.comm ? line(`Комиссия площадки, ${fmt2.format(r.commPct)} %`, "− " + rub(r.comm)) : ""}
      ${r.logi ? line(`Логистика${r.logiNote ? ` <small class="muted">(${esc(r.logiNote)})</small>` : ""}`, "− " + rub(r.logi)) : ""}
      ${r.acq ? line("Эквайринг", "− " + rub(r.acq)) : ""}
      ${r.other ? line("Прочие расходы площадки", "− " + rub(r.other)) : ""}
      ${line("Налог", "− " + rub(r.tax))}
      ${line("Себестоимость", "− " + rub(costTotal))}
      <tr class="sum"><td>Ваша прибыль</td><td class="num" style="color:var(${r.profit >= 0 ? "--good" : "--bad"})">${rub(r.profit)} · ${margin} %</td></tr>
    </table>`;
  }

  function renderSale(c) {
    const sale = S.product.sale;
    const box = $("#saleResult"), chk = $("#checkResult");
    $("#ozonPicked").textContent = sale.ozon.typeLabel ? "Выбрано: " + sale.ozon.typeLabel : "Категория не выбрана";
    if (sale.mode === "off") { box.innerHTML = ""; chk.innerHTML = ""; return; }
    if (sale.mode === "ozon" && !sale.ozon.typeRef) {
      box.innerHTML = `<div class="warnbox">Выберите категорию товара — от неё зависит комиссия Ozon.</div>`;
      chk.innerHTML = ""; return;
    }
    if (sale.mode === "ozon" && Calc.ozonRate(OZ, sale.ozon.typeRef, sale.ozon.scheme, 1000) == null) {
      box.innerHTML = `<div class="warnbox">Категория «${esc(sale.ozon.typeLabel)}» не найдена в текущих тарифах Ozon — выберите её заново.</div>`;
      chk.innerHTML = ""; return;
    }
    const cost = c.total;
    let rec, be;
    if (sale.mode === "markup") {
      const tax = num(sale.taxPct) / 100;
      if (tax >= 1) { box.innerHTML = `<div class="warnbox">Налог не может быть 100 % и больше.</div>`; chk.innerHTML = ""; return; }
      rec = Calc.saleAt(ceilTo(cost * (1 + num(sale.markupPct) / 100) / (1 - tax), 10), cost, sale, OZ);
      be = Calc.saleAt(cost / (1 - tax), cost, sale, OZ);
    } else {
      const raw = Calc.priceFor(cost, sale, OZ);
      const raw0 = Calc.priceFor(cost, sale, OZ, true);
      rec = raw && Calc.saleAt(ceilTo(raw.price, 10), cost, sale, OZ);
      be = raw0 && Calc.saleAt(ceilTo(raw0.price, 1), cost, sale, OZ);
    }
    if (!rec || !be) {
      box.innerHTML = `<div class="warnbox">Цена не находится: комиссия, эквайринг, налог и желаемая прибыль вместе съедают 100 % цены. Уменьшите желаемую прибыль.</div>`;
    } else {
      const ozNote = sale.mode === "ozon"
        ? `<p class="note">Для Ozon это <b>предельная цена</b> в личном кабинете: из неё Ozon удерживает ставку ${fmt2.format(rec.commPct)} % и сам оплачивает скидки покупателю.</p>` : "";
      box.innerHTML = `<div class="price-cards">
          <div class="price-card main"><div class="k">Рекомендуемая цена</div><div class="v">${rub(rec.price)}</div>
            <div class="s">${sale.mode === "markup" ? `наценка ${fmt0.format(num(sale.markupPct))} %` : sale.profitMode === "rub" ? `прибыль от ${rub(num(sale.profitRub))}` : `прибыль от ${fmt0.format(num(sale.profitPct))} % цены`}, округлено до 10 ₽</div></div>
          <div class="price-card"><div class="k">Безубыточность</div><div class="v">${rub(be.price)}</div><div class="s">ниже — каждая продажа в минус</div></div>
        </div>
        ${breakdownTable(rec, cost)}${ozNote}
        ${sale.mode === "ozon" && rec.price <= 300 ? `<div class="warnbox">Цена до 300 ₽ — действует пониженная ставка и тариф логистики для дешёвых товаров.</div>` : ""}`;
    }
    const cp = num(sale.checkPrice);
    if (cp > 0) {
      const r = Calc.saleAt(cp, cost, sale, OZ);
      chk.innerHTML = r ? `<div class="verdict ${r.profit >= 0 ? "ok" : "bad"}">При цене ${rub(cp)} вы ${r.profit >= 0 ? "заработаете" : "потеряете"} <b>${rub(Math.abs(r.profit))}</b> с изделия (${Math.round((r.profit / cp) * 100)} % цены).</div>` : "";
    } else chk.innerHTML = "";
  }

  // ---------- общий пересчёт ----------
  function update() {
    const c = Calc.cost(S.product, S.printers, S.materials, S.settings);
    // стоимость каждой детали в таблице
    for (const r of c.rows) {
      const td = $(`#partsBody tr[data-id="${CSS.escape(r.id)}"] [data-cost]`);
      if (td) td.innerHTML = `${rub(r.totalWithBrak)}<span class="per-piece">${r.qty > 1 ? rub(r.perPiece) + " / шт" : ""}</span>`;
    }
    renderSummary(c);
    renderSale(c);
    persist();
    return c;
  }

  function fillInputs() {
    $("#productName").value = S.product.name || "";
    fillers.forEach((f) => f());
    const sale = S.product.sale;
    $("#profitMode").value = sale.profitMode;
    $("#profitVal").value = sale.profitMode === "rub" ? sale.profitRub : sale.profitPct;
    $("#ozonScheme").value = sale.ozon.scheme;
    $("#ozonOrigin").value = sale.ozon.origin;
    $("#logiMode").value = sale.ozon.logiMode;
  }
  function renderAll() { fillInputs(); renderParts(); renderRefs(); renderSaleMode(); update(); }

  // ---------- мои изделия ----------
  $("#saveProduct").addEventListener("click", () => {
    if (!S.product.name) { S.product.name = "Изделие " + (S.saved.length + 1); $("#productName").value = S.product.name; }
    const c = update();
    const copy = JSON.parse(JSON.stringify(S.product));
    const i = S.saved.findIndex((x) => x.product.id === copy.id);
    const item = { product: copy, updated: new Date().toISOString(), total: c.total, grams: c.grams, hours: c.hours };
    if (i >= 0) S.saved[i] = item; else S.saved.unshift(item);
    persist(); toast("Сохранено: " + copy.name);
  });
  $("#newProduct").addEventListener("click", () => {
    S.product = newProduct(S.printers[0].id, S.materials[0].id);
    $("#fileMsg").hidden = true;
    renderAll(); toast("Новое изделие");
  });
  function renderSaved() {
    const box = $("#savedList");
    if (!S.saved.length) { box.innerHTML = `<p class="muted">Пока пусто. На вкладке «Расчёт» нажмите «Сохранить».</p>`; return; }
    box.innerHTML = S.saved.map((x, i) => {
      // суммы пересчитываем по текущим справочникам — так они всегда верные, даже если файл импорта битый
      const c = Calc.cost(x.product, S.printers, S.materials, S.settings);
      const dt = new Date(x.updated);
      return `<div class="saved-item">
      <div class="nm">${esc(x.product.name || "Без названия")}<small>${grams(c.grams)} · ${hm(c.hours)}${isNaN(dt) ? "" : " · сохранено " + dt.toLocaleDateString("ru-RU")}</small></div>
      <div class="num"><b>${rub(c.total)}</b></div>
      <button class="btn small" data-open="${i}" type="button">Открыть</button>
      <button class="btn ghost small" data-copy="${i}" type="button">Копия</button>
      <button class="icon-btn" data-remove="${i}" title="Удалить" aria-label="Удалить ${esc(x.product.name)}">×</button></div>`;
    }).join("");
  }
  $("#savedList").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.open != null || b.dataset.copy != null) {
      const x = S.saved[+(b.dataset.open ?? b.dataset.copy)];
      S.product = fixProduct(JSON.parse(JSON.stringify(x.product)), S);
      if (b.dataset.copy != null) { S.product.id = uid(); S.product.name += " (копия)"; S.product.parts.forEach((p) => (p.id = uid())); }
      renderAll(); showTab("calc");
    } else if (b.dataset.remove != null) {
      const x = S.saved[+b.dataset.remove];
      if (!confirm(`Удалить «${x.product.name}» из списка?`)) return;
      S.saved.splice(+b.dataset.remove, 1); persist(); renderSaved();
    }
  });

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $("#exportJson").addEventListener("click", () => {
    download(`print-calc-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "print-calc", version: 1, ...S }, null, 2), "application/json");
  });
  $("#importJson").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "print-calc" || !Array.isArray(d.printers) || !Array.isArray(d.materials)) throw new Error("это не файл калькулятора");
      if (!confirm("Заменить текущие справочники и список изделий данными из файла?")) return;
      // собираем во временную переменную; если отрисовка упадёт — возвращаем прежнее состояние
      const prev = S;
      try { S = sanitize(d); renderAll(); renderSaved(); }
      catch (err) { S = prev; renderAll(); throw new Error("файл повреждён"); }
      toast("Данные загружены");
    } catch (err) { toast("Не получилось: " + err.message); }
  });
  $("#exportCsv").addEventListener("click", () => {
    // точка с запятой и BOM — чтобы русский Excel открыл файл без «кракозябр» и по столбцам
    const rows = [["Изделие", "Граммы", "Часы", "Пластик, ₽", "Электричество, ₽", "Износ, ₽", "Брак, ₽", "Работа, ₽", "Упаковка и прочее, ₽", "Себестоимость, ₽"]];
    const list = S.saved.length ? S.saved.map((x) => x.product) : [S.product];
    for (const p of list) {
      const c = Calc.cost(p, S.printers, S.materials, S.settings);
      rows.push([p.name || "Без названия", c.grams, c.hours, c.material, c.energy, c.wear, c.brakExtra, c.labor, c.extras, c.total]
        // текст, начинающийся с = + - @, Excel принял бы за формулу — ставим перед ним апостроф
        .map((v) => (typeof v === "number" ? v.toFixed(2).replace(".", ",") : `"${String(v).replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`)));
    }
    download("print-calc.csv", "﻿" + rows.map((r) => r.join(";")).join("\r\n"), "text/csv");
  });

  renderAll();
})();
