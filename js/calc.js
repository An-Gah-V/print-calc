// Все формулы калькулятора в одном месте — отдельно от интерфейса,
// чтобы их было легко проверить и прочитать.
"use strict";

const Calc = (() => {
  const n = (x) => (typeof x === "number" && isFinite(x) ? x : parseFloat(String(x ?? "").replace(",", ".")) || 0);

  // Износ принтера за час: цена ÷ ресурс в часах + обслуживание (сопла, лист, смазка) в час
  function wearPerHour(pr) {
    const life = n(pr.lifeH);
    return (life > 0 ? n(pr.price) / life : 0) + n(pr.maintPerH);
  }

  // Себестоимость изделия. Возвращает разбивку и строки по деталям.
  function cost(product, printers, materials, settings) {
    const byId = (list, id) => list.find((x) => x.id === id) || list[0] || {};
    const brak = Math.min(Math.max(n(settings.brakPct) / 100, 0), 0.95);
    const rows = [];
    let material = 0, energy = 0, wear = 0, grams = 0, hours = 0;
    for (const p of product.parts) {
      const pr = byId(printers, p.printerId);
      const mt = byId(materials, p.materialId);
      const perPlate = Math.max(n(p.perPlate) || 1, 1);
      const qty = Math.max(n(p.qty), 0);
      const g = n(p.grams) / perPlate;          // граммы на одну штуку
      const h = n(p.hours) / perPlate;          // часы на одну штуку
      const spoolG = n(mt.spoolG) || 1000;
      const r = {
        id: p.id,
        g, h, qty,
        material: qty * g * n(mt.spoolPrice) / spoolG,
        energy: qty * h * n(pr.powerW) / 1000 * n(settings.tariff),
        wear: qty * h * wearPerHour(pr),
      };
      r.total = r.material + r.energy + r.wear;
      r.totalWithBrak = r.total / (1 - brak);   // то, что показывается в таблице деталей
      r.perPiece = qty ? r.totalWithBrak / qty : 0;
      rows.push(r);
      material += r.material; energy += r.energy; wear += r.wear;
      grams += qty * g; hours += qty * h;
    }
    const print = material + energy + wear;
    // Брак: если из 10 печатей одна неудачная, на 9 удачных уходит пластик и время 10 печатей,
    // поэтому делим на (1 − брак), а не умножаем на (1 + брак)
    const brakExtra = brak < 1 ? print * brak / (1 - brak) : 0;
    const labor = n(product.laborMin) / 60 * n(settings.laborRate);
    const extras = n(product.packaging) + n(product.otherCost);
    const total = print + brakExtra + labor + extras;
    const hoursWithBrak = brak < 1 ? hours / (1 - brak) : hours;
    const perMonth = hoursWithBrak > 0 ? n(settings.hoursPerDay) * 30 / hoursWithBrak : 0;
    return { rows, material, energy, wear, brakExtra, labor, extras, total, grams, hours, hoursWithBrak, perMonth };
  }

  // ---------- Ozon ----------
  function ozonRate(data, typeRef, scheme, price) {
    // typeRef = [категория, подкатегория, название типа]. Ищем по названию, а не по номеру строки:
    // после обновления таблиц Ozon номера сдвигаются, а название остаётся.
    if (!data || !Array.isArray(typeRef)) return null;
    const list = data.commissions.tree[typeRef[0]]?.[typeRef[1]];
    const item = list && list.find((x) => x[0] === typeRef[2]);
    if (!item) return null;
    const pat = data.commissions.patterns[item[1]];
    const s = data.schemes.indexOf(scheme);
    if (s === 4) return pat[12];                       // rFBS — одна ставка для любой цены
    const k = price <= 100 ? 0 : price <= 300 ? 1 : 2;  // ценовые диапазоны Ozon
    return pat[s * 3 + k];
  }

  function volumeL(dims) {
    const [a, b, c] = (dims || []).map(n);
    return a > 0 && b > 0 && c > 0 ? (a * b * c) / 1000 : 0; // см³ -> литры
  }

  function ozonLogistics(data, oz, price) {
    // Возвращает {rub, note}. rFBS — доставляет сам продавец, тариф Ozon не применяется.
    if (oz.logiMode === "manual" || oz.scheme === "rFBS") return { rub: n(oz.logiManual), note: "вручную" };
    const L = data.logistics;
    const vol = volumeL(oz.dims);
    if (!vol) return { rub: 0, note: "укажите размеры упаковки" };
    let bi = L.bands.findIndex((mx) => mx == null || vol <= mx + 1e-9);
    if (bi < 0) bi = L.bands.length - 1;
    const hi = price > 300;
    const row = L.origins[oz.origin];
    if (!row) return { rub: L.universal[bi][hi ? 1 : 0], note: `универсальный тариф, ${L.bandLabels[bi]}` };
    const col = { local: 0, avg: 1, max: 2 }[oz.logiMode] ?? 1;
    return { rub: row[bi][col + (hi ? 3 : 0)], note: `${L.bandLabels[bi]}, объём ${vol.toFixed(2).replace(".", ",")} л` };
  }

  // Разбор продажи по заданной цене: сколько удержит площадка, налог и сколько останется.
  function saleAt(price, costTotal, sale, data) {
    const P = n(price);
    const tax = P * n(sale.taxPct) / 100;
    if (sale.mode === "markup") {
      return { price: P, commPct: 0, comm: 0, logi: 0, acq: 0, other: 0, tax, profit: P - tax - costTotal, logiNote: "" };
    }
    let commPct, logi, logiNote = "", acqPct, other;
    if (sale.mode === "ozon") {
      if (!data) return null; // файл тарифов Ozon не загрузился

      commPct = ozonRate(data, sale.ozon.typeRef, sale.ozon.scheme, P);
      const lg = ozonLogistics(data, sale.ozon, P);
      logi = lg.rub; logiNote = lg.note;
      acqPct = n(sale.ozon.acqPct); other = n(sale.ozon.otherRub);
    } else {
      commPct = n(sale.custom.commPct); logi = n(sale.custom.logiRub);
      acqPct = n(sale.custom.acqPct); other = n(sale.custom.otherRub);
    }
    if (commPct == null) return null;
    const comm = P * commPct / 100;
    const acq = P * acqPct / 100;
    const profit = P - comm - logi - acq - other - tax - costTotal;
    return { price: P, commPct, comm, logi, acq, other, tax, profit, logiNote };
  }

  const targetOk = (r, sale, zero) => {
    if (!r) return false;
    const want = zero ? 0 : sale.profitMode === "rub" ? n(sale.profitRub) : r.price * n(sale.profitPct) / 100;
    return r.profit >= want - 0.005;
  };

  // Минимальная цена, при которой прибыль не меньше желаемой (zero=true — безубыточность).
  // Ставки зависят от цены (диапазоны Ozon), поэтому проверяем несколько кандидатов.
  function priceFor(costTotal, sale, data, zero = false) {
    const fixedProfit = zero ? 0 : sale.profitMode === "rub" ? n(sale.profitRub) : 0;
    const pctProfit = zero ? 0 : sale.profitMode === "rub" ? 0 : n(sale.profitPct) / 100;
    const cands = new Set([101, 301]);
    for (const probe of [50, 200, 1000]) {
      const r = saleAt(probe, costTotal, sale, data);
      if (!r) return null;
      const den = 1 - r.commPct / 100 - (r.acq / probe) - n(sale.taxPct) / 100 - pctProfit;
      if (den > 0) cands.add((costTotal + r.logi + r.other + fixedProfit) / den);
    }
    // логистика зависит от того, дороже ли товар 300 ₽ — пересчитаем кандидатов с их собственной логистикой
    for (const c of [...cands]) {
      const r = saleAt(c, costTotal, sale, data);
      if (!r) continue;
      const den = 1 - r.commPct / 100 - (r.acq / c) - n(sale.taxPct) / 100 - pctProfit;
      if (den > 0) cands.add((costTotal + r.logi + r.other + fixedProfit) / den);
    }
    const ok = [...cands].filter((c) => c > 0).sort((a, b) => a - b)
      .map((c) => saleAt(c, costTotal, sale, data)).find((r) => targetOk(r, sale, zero));
    return ok || null;
  }

  return { cost, saleAt, priceFor, ozonRate, ozonLogistics, volumeL, wearPerHour, n };
})();
