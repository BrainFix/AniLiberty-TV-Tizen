#!/usr/bin/env python3
"""Проверяет целостность исходников и архива приложения."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree
import re

корень = Path(__file__).resolve().parent.parent
пакет = корень / "AniLiberty-TV-1.0.0.wgt"
состав = {
    "config.xml", "index.html", "app.js", "style.css", "icon.png",
    "poster.png", "title-placeholder.png", "episode-placeholder.png",
}
with ZipFile(пакет) as архив:
    if set(архив.namelist()) != состав:
        raise SystemExit("Неверный состав пакета")
    for имя in состав:
        if архив.read(имя) != (корень / имя).read_bytes():
            raise SystemExit(f"Содержимое не совпадает: {имя}")
    xml = ElementTree.fromstring(архив.read("config.xml"))
    if xml.attrib.get("version") != "1.0.0":
        raise SystemExit("Неверная версия приложения")
    if xml.attrib.get("id") != "http://local.example/aniliberty7r4m9w":
        raise SystemExit("Неверный идентификатор виджета")
    приложение = xml.find("{http://tizen.org/ns/widgets}application")
    if приложение is None or приложение.attrib.get("required_version") != "6.0":
        raise SystemExit("Неверная минимальная версия Tizen")
    идентификатор_пакета = приложение.attrib.get("package", "")
    if not re.fullmatch(r"[A-Za-z0-9]{10}", идентификатор_пакета):
        raise SystemExit("Tizen требует Package ID ровно из 10 латинских букв или цифр")
    if not re.fullmatch(re.escape(идентификатор_пакета) + r"\.[A-Za-z0-9]{1,52}", приложение.attrib.get("id", "")):
        raise SystemExit("Application ID должен начинаться с Package ID")
    if приложение.attrib.get("id") != "anil7r4m9w.AniLibertyTV" or приложение.attrib.get("package") != "anil7r4m9w":
        raise SystemExit("Неверные идентификаторы приложения")
print("Проверка пройдена: пакет соответствует исходникам.")
