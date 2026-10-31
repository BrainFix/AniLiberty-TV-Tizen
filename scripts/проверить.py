#!/usr/bin/env python3
"""Проверяет содержимое WGT, версию, идентификаторы и соответствие исходникам."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import re

root = Path(__file__).resolve().parent.parent
xml = ET.parse(root / "config.xml").getroot()
version = xml.attrib["version"]
wgt = root / f"AniLiberty-TV-{version}.wgt"
sources = {
    "config.xml", "index.html", "app.js", "style.css",
    "card-layout.css", "card-layout.js",
    "icon.png", "poster.png", "title-placeholder.png", "episode-placeholder.png"
}
if version != "1.0.1":
    raise SystemExit("Неверная версия: ожидается 1.0.1")
if xml.attrib.get("id") != "http://local.example/aniliberty7r4m9w":
    raise SystemExit("Неверный Widget ID")
app = xml.find("{http://tizen.org/ns/widgets}application")
if app is None or app.get("required_version") != "6.0":
    raise SystemExit("Неверная минимальная версия Tizen")
if app.get("id") != "anil7r4m9w.AniLibertyTV" or app.get("package") != "anil7r4m9w":
    raise SystemExit("Неверный Application ID или Package ID")
with ZipFile(wgt) as archive:
    if archive.testzip() is not None or set(archive.namelist()) != sources:
        raise SystemExit("Неверный состав или повреждение WGT")
    for name in sources:
        if archive.read(name) != (root / name).read_bytes():
            raise SystemExit(f"Несовпадение исходников и WGT: {name}")
    html = archive.read("index.html")
    for s in (b"card-layout.css", b"card-layout.js"):
        if s not in html:
            raise SystemExit(f"Отсутствует подключение {s!r}")
    if any(name.startswith(("author-signature", "signature")) for name in archive.namelist()):
        raise SystemExit("Неожиданная подпись в неподписанном WGT")
print("Проверка пройдена.")
