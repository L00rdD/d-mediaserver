"""What Ohara reads in names: the series and the tomes of a release title, the
number of a volume file, the language of a release. Pure functions, no I/O."""

import re
import unicodedata
from pathlib import Path

FRENCH = re.compile(r"(?i)\b(fr|vf|vff|french|fran[cç]ais|truefrench)\b")
ENGLISH = re.compile(r"(?i)\b(eng|english|scanlated|digital|viz|yen press)\b")
JAPANESE = re.compile(r"(?i)\b(jp|jap|raw)\b|[぀-ヿ]|巻")
FRENCH_TRACKERS = ("YggReborn", "Torrent9", "World-torrent")
LANG_ORDER = {"FR": 0, "EN": 1, "?": 2, "JP": 3}

# "T05", "Tome 5", "v05", "Vol. 5", "Volume 5"; not the t of "Scantrad"
_TOME = r"(?<![a-z])(?:tomes?|t|vol(?:ume)?s?\.?|v)[\s._-]*0*"
VOLUME = re.compile(r"(?i)" + _TOME + r"(\d+(?:\.\d+)?)")
TOME_RANGE = re.compile(r"(?i)" + _TOME + r"(\d{1,4})(?:\s*(?:à|-|–|to|&|et)\s*(?:(?:tomes?|t|vol\.?|v)[\s._-]*)?0*(\d{1,4}))?(?!\d)")
SERIES_END = re.compile(r"(?i)[\s._-]*(\b(tomes?|t\d+|vol(ume)?s?|v\d+|int[ée]grale|cbz|cbr|pdf|epub|ebook|complete|chapitres?)\b|\d+\s*(à|-|to)\s*\d+).*$")


def natural(text):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", text)]


def norm(name):
    """A name to compare series by: no accents, case, spaces or punctuation."""
    flat = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", flat.lower())


def guess_series(title):
    """The series name in a release title: "Naruto - T01 à T72 [CBZ] Fr" → "Naruto"."""
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}", " ", title)
    t = re.sub(r"[._]+", " ", t)
    t = SERIES_END.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" -–+:,")
    return t or title.strip()


def safe_name(name):
    """A series name usable as a folder name."""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:120] or "Sans titre"


def volume_number(filename):
    """5.0 for "Naruto T05.cbz", None when the name gives no number."""
    m = VOLUME.search(Path(filename).stem)
    return float(m.group(1)) if m else None


def volume_label(filename):
    n = volume_number(filename)
    if n is None:
        return Path(filename).stem
    return f"Tome {n:g}"


def tome_range(title):
    """(1, 72) for "Naruto - T01 à T72", (98, 98) for "Tome 98", None when the
    title gives no tome."""
    m = TOME_RANGE.search(title)
    if not m:
        return None
    lo = int(m.group(1))
    hi = int(m.group(2)) if m.group(2) else lo
    return (lo, hi) if hi >= lo else (lo, lo)


def language(title, indexer=""):
    """FR, EN, JP or ?; a French tracker's release is French unless it says otherwise."""
    if FRENCH.search(title):
        return "FR"
    if ENGLISH.search(title):
        return "EN"
    if JAPANESE.search(title):
        return "JP"
    return "FR" if indexer in FRENCH_TRACKERS else "?"


def speed(seeders):
    """How fast a release will come, in words."""
    if seeders >= 10:
        return "rapide"
    if seeders >= 3:
        return "correct"
    return "lent" if seeders else "bloqué"
