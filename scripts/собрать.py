#!/usr/bin/env python3
"""Собирает воспроизводимый неподписанный WGT из исходников приложения."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import re

ROOT = Path(__file__).resolve().parent.parent
SOURCES = (
    "config.xml", "index.html", "app.js", "style.css",
    "card-layout.css", "card-layout.js",
    "icon.png", "poster.png", "title-placeholder.png", "episode-placeholder.png",
)
xml = ET.parse(ROOT / "config.xml").getroot()
version = xml.attrib["version"]
app = xml.find("{http://tizen.org/ns/widgets}application")
if app is None:
    raise SystemExit("Нет tizen:application")
package_id = app.attrib.get("package", "")
if not re.fullmatch(r"[A-Za-z0-9]{10}", package_id):
    raise SystemExit("Package ID должен содержать ровно 10 букв/цифр")
if not re.fullmatch(re.escape(package_id) + r"\.[A-Za-z0-9]{1,52}", app.attrib.get("id", "")):
    raise SystemExit("Некорректный Application ID")
if app.attrib["id"] != "anil7r4m9w.AniLibertyTV" or package_id != "anil7r4m9w":
    raise SystemExit("Несовпадение с публичным идентификатором")
out = ROOT / f"AniLiberty-TV-{version}.wgt"
with ZipFile(out, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name in SOURCES:
        source = ROOT / name
        if not source.is_file():
            raise SystemExit(f"Отсутствует файл: {name}")
        info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
print(f"Готово: {out}")
