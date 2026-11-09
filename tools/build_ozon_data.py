# -*- coding: utf-8 -*-
"""Превращает официальные таблицы Ozon (xlsx) в файл данных для калькулятора.

Источник: https://seller-edu.ozon.ru/docs/commissions-tariffs/legal-information/full-actual-commissions.html
  - «Таблица категорий и типов для расчёта вознаграждения» -> ставки комиссии;
  - «Таблица с предельными тарифами» логистики FBO/FBS -> логистика по объёму.

Запуск из папки проекта (xlsx предварительно скачать в data/ozon-raw/):
    py tools\\build_ozon_data.py data\\ozon-raw\\<комиссии>.xlsx data\\ozon-raw\\<логистика>.xlsx <дата тарифов>
Результат: data/ozon-data.js (подключается страницей как обычный скрипт —
так он работает и при открытии index.html двойным щелчком, без сервера).
"""
import json
import os
import re
import sys

from openpyxl import load_workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "ozon-data.js")
SCHEMES = ["FBO", "FBO ПВЗ", "FBO Fresh", "FBS", "rFBS"]


def clean_rows(ws):
    """Строки листа без пустых ячеек по краям (у Ozon таблицы сдвинуты вправо)."""
    for row in ws.iter_rows(values_only=True):
        cells = [c for c in row]
        while cells and cells[-1] is None:
            cells.pop()
        while cells and cells[0] is None:
            cells.pop(0)
        if cells:
            yield cells


def pct(x):
    # ставки в xlsx — доли (0.52); храним проценты с точностью до сотых
    return round(float(x) * 100, 2)


def build_commissions(path):
    ws = load_workbook(path, read_only=True, data_only=True).worksheets[0]
    rows = list(clean_rows(ws))
    head = rows[1]
    assert head[0] == "Основная категория" and head[2] == "Тип товара", head
    patterns, pat_index = [], {}
    tree = {}
    count = 0
    for r in rows[2:]:
        if len(r) < 16 or not isinstance(r[3], (int, float)):
            continue
        cat, sub, typ = (str(x).strip() for x in r[:3])
        # [FBO ≤100, 100–300, >300], [FBO ПВЗ ...], [FBO Fresh ...], [FBS ...], rFBS (одна ставка)
        rates = [pct(x) for x in r[3:15]] + [pct(r[15])]
        key = tuple(rates)
        if key not in pat_index:
            pat_index[key] = len(patterns)
            patterns.append(rates)
        tree.setdefault(cat, {}).setdefault(sub, []).append([typ, pat_index[key]])
        count += 1
    return {"patterns": patterns, "tree": tree, "count": count}


def band_max(label):
    """'0,201-0,4 л' -> 0.4; 'От 800,001 л' -> None (без верхней границы)."""
    nums = re.findall(r"[\d]+(?:,\d+)?", label)
    if label.strip().lower().startswith("от"):
        return None
    return float(nums[-1].replace(",", "."))


def build_logistics(path):
    wb = load_workbook(path, read_only=True, data_only=True)
    rows = [r for r in clean_rows(wb["Логистика РФ"]) if len(r) == 5 and isinstance(r[3], (int, float))]
    bands = list(dict.fromkeys(r[0] for r in rows))
    band_i = {b: i for i, b in enumerate(bands)}
    origins = {}
    for vol, org, dst, lo, hi in rows:
        o = origins.setdefault(org, [[] for _ in bands])
        o[band_i[vol]].append((dst == org, lo, hi))
    out = {}
    no_local = set()  # кластеры, где нет маршрута «в свой же кластер» — берём самый дешёвый
    for org, per_band in origins.items():
        lst = []
        for items in per_band:
            local = [x for x in items if x[0]]
            los = [x[1] for x in items]
            his = [x[2] for x in items]
            if not local:
                no_local.add(org)
            loc = local[0] if local else (False, min(los), min(his))
            # [местная ≤300, средняя ≤300, макс ≤300, местная >300, средняя >300, макс >300]
            lst.append([loc[1], round(sum(los) / len(los)), max(los),
                        loc[2], round(sum(his) / len(his)), max(his)])
        out[org] = lst
    if no_local:
        print("ВНИМАНИЕ: нет маршрута внутри кластера, вместо него самый дешёвый:", ", ".join(sorted(no_local)))
    default = [r for r in clean_rows(wb["Тарифы по умолчанию"]) if len(r) == 3 and isinstance(r[1], (int, float))]
    assert [r[0] for r in default] == bands, "полосы объёма в листах не совпадают"
    return {
        "bands": [band_max(b) for b in bands],
        "bandLabels": bands,
        "origins": dict(sorted(out.items())),
        "universal": [[r[1], r[2]] for r in default],
    }


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    com_path, log_path, date = sys.argv[1:]
    data = {
        "date": date,
        "source": "https://seller-edu.ozon.ru/docs/commissions-tariffs/legal-information/full-actual-commissions.html",
        "schemes": SCHEMES,
        "commissions": build_commissions(com_path),
        "logistics": build_logistics(log_path),
    }
    js = ("// Сгенерировано tools/build_ozon_data.py из официальных таблиц Ozon. Не править руками.\n"
          "window.OZON_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    c = data["commissions"]
    print(f"Типов товаров: {c['count']}, наборов ставок: {len(c['patterns'])}, "
          f"кластеров отправки: {len(data['logistics']['origins'])}, размер: {len(js) // 1024} КБ")


if __name__ == "__main__":
    main()
