#!/usr/bin/env python3
"""Создаёт пакет Tizen Web Widget из исходных файлов приложения."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree
import re

КОРЕНЬ = Path(__file__).resolve().parent.parent
ФАЙЛЫ = (
    "config.xml", "index.html", "app.js", "style.css",
    "icon.png", "poster.png", "title-placeholder.png", "episode-placeholder.png",
)
ПАКЕТ = КОРЕНЬ / "AniLiberty-TV-1.0.0.wgt"

конфигурация = ElementTree.parse(КОРЕНЬ / "config.xml").getroot()
приложение = конфигурация.find("{http://tizen.org/ns/widgets}application")
if приложение is None:
    raise SystemExit("Не задан идентификатор приложения в config.xml")
идентификатор_пакета = приложение.get("package", "")
if not re.fullmatch(r"[A-Za-z0-9]{10}", идентификатор_пакета):
    raise SystemExit("Неверный Package ID: требуется ровно 10 латинских букв или цифр")
if not re.fullmatch(re.escape(идентификатор_пакета) + r"\.[A-Za-z0-9]{1,52}", приложение.get("id", "")):
    raise SystemExit("Application ID должен иметь вид PackageID.AppName")

with ZipFile(ПАКЕТ, "w", compression=ZIP_DEFLATED, compresslevel=9) as архив:
    for имя in ФАЙЛЫ:
        путь = КОРЕНЬ / имя
        if not путь.is_file():
            raise SystemExit(f"Не найден файл: {имя}")
        архив.write(путь, arcname=имя)
print(f"Готово: {ПАКЕТ}")
