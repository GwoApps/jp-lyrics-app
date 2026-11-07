#!/usr/bin/env python3
"""Build vendored EDRDG reading indexes with Python's standard library only.

Raw gzip sources and their provenance stay outside the repository. Never disable
TLS verification: the alternate JMdict URL is another official EDRDG host.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "kanjidic2": ["https://www.edrdg.org/kanjidic/kanjidic2.xml.gz"],
    "jmdict": [
        "https://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
        "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
    ],
}
# Includes compatibility ideographs, extension A and supplementary CJK blocks.
KANJI = re.compile("[\u3005\u3007\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
ATTRIBUTION = (
    "This package uses the KANJIDIC2 and JMdict dictionary files. These files "
    "are the property of the Electronic Dictionary Research and Development "
    "Group, and are used in conformance with the Group's licence. "
    "Copyright James William BREEN and the Electronic Dictionary Research "
    "and Development Group. Derived dictionary data: CC BY-SA 4.0."
)


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, value: object, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, sort_keys=True,
                      indent=2 if pretty else None,
                      separators=None if pretty else (",", ":")) + "\n"
    path.write_text(text, encoding="utf-8")


def acquire(name: str, cache: Path, refresh: bool, offline: bool) -> tuple[Path, dict]:
    path = cache / f"{name}.xml.gz"
    provenance = cache / f"{name}.source.json"
    if not refresh and path.exists() and provenance.exists():
        meta = json.loads(provenance.read_text(encoding="utf-8"))
        if sha256(path) != meta["sha256"]:
            raise ValueError(f"{path}: cached source SHA256 mismatch")
        return path, meta
    if offline:
        raise FileNotFoundError(f"Missing verified cache: {path} and {provenance}")
    errors = []
    for url in SOURCES[name]:
        temporary = None
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "jp-lyrics-app dictionary generator"})
            with urllib.request.urlopen(request, timeout=120) as response:
                with tempfile.NamedTemporaryFile(dir=cache, delete=False) as target:
                    temporary = Path(target.name)
                    shutil.copyfileobj(response, target)
                # Reject HTML error pages and incomplete/invalid gzip downloads.
                with gzip.open(temporary, "rb") as check:
                    while check.read(1024 * 1024):
                        pass
                meta = {
                    "url": url, "resolved_url": response.url,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "last_modified": response.headers.get("Last-Modified"),
                    "sha256": sha256(temporary), "bytes": temporary.stat().st_size,
                }
            temporary.replace(path)
            write_json(provenance, meta, pretty=True)
            return path, meta
        except Exception as exc:
            errors.append(f"{url}: {exc}")
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    raise RuntimeError("No source downloaded; refusing to fabricate data:\n" + "\n".join(errors))


def hiragana(text: str) -> str:
    converted = "".join(chr(ord(c) - 0x60) if "\u30a1" <= c <= "\u30f6" else c for c in text)
    for katakana, kana in zip("ヷヸヹヺ", ("わ\u3099", "ゐ\u3099", "ゑ\u3099", "を\u3099")):
        converted = converted.replace(katakana, kana)
    return unicodedata.normalize("NFC", converted)


def texts(element: ET.Element, tag: str) -> list[str]:
    return [child.text or "" for child in element.findall(tag)]


def build_kanji(path: Path) -> tuple[dict, dict, list, int, dict]:
    result = {}
    kun = {}
    annotations = []
    header = {}
    character_count = 0
    with gzip.open(path, "rb") as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag == "header":
                header = {child.tag: child.text for child in element}
                element.clear()
            elif element.tag == "character":
                character_count += 1
                literal = element.findtext("literal")
                readings = []
                kun_forms = []
                for reading in element.findall("reading_meaning/rmgroup/reading"):
                    if reading.get("r_type") not in ("ja_on", "ja_kun"):
                        continue
                    raw = reading.text or ""
                    if reading.get("r_type") == "ja_kun":
                        parts = hiragana(raw.strip("-")).split(".", 1)
                        pair = [parts[0], parts[1] if len(parts) > 1 else ""]
                        if pair[0] and pair not in kun_forms:
                            kun_forms.append(pair)
                    # A dot separates the kanji reading from kana okurigana.
                    value = hiragana(raw.split(".", 1)[0].strip("-"))
                    if value and value not in readings:
                        readings.append(value)
                    extra = {key: val for key, val in reading.attrib.items() if key != "r_type"}
                    if extra:
                        annotations.append({"kanji": literal, "reading": raw,
                                            "type": reading.get("r_type"), "attributes": extra})
                if readings:
                    result[literal] = readings
                if kun_forms:
                    kun[literal] = kun_forms
                element.clear()
    return result, header, annotations, character_count, kun


def priority(tags: list[str]) -> int:
    ranks = {"ichi1": 0, "news1": 0, "spec1": 0, "gai1": 0,
             "ichi2": 100, "news2": 100, "spec2": 100, "gai2": 100}
    return min((int(tag[2:]) if re.fullmatch(r"nf[0-9]{2}", tag)
                else ranks.get(tag, 1000) for tag in tags), default=1000)


CONJUGATABLE_POS = frozenset({
    "v1", "v1-s", "v5u", "v5k", "v5k-s", "v5g", "v5s", "v5t", "v5n",
    "v5b", "v5m", "v5r", "v5r-i", "vk", "vs", "vs-i", "vs-s", "adj-i", "adj-ix",
    "adj-na", "adv-to",
})


def conjugatable_pos_descriptions(path: Path) -> dict[str, str]:
    """Recover entity codes before ElementTree expands POS into descriptions."""
    header = []
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            header.append(line)
            if "<JMdict" in line:
                break
    declarations = re.findall(r'''<!ENTITY\s+([\w-]+)\s+(["'])(.*?)\2\s*>''',
                              "".join(header), re.DOTALL)
    return {ET.fromstring("<text>" + description + "</text>").text or "": code
            for code, _, description in declarations if code in CONJUGATABLE_POS}


def build_words(path: Path) -> tuple[dict, list, dict, dict]:
    ranked: dict[str, dict[str, tuple]] = {}
    lexical: dict[str, dict[str, set[str]]] = {}
    pos_codes = conjugatable_pos_descriptions(path)
    annotations = []
    stats = Counter()
    with gzip.open(path, "rb") as source:
        for _, entry in ET.iterparse(source, events=("end",)):
            if entry.tag != "entry":
                continue
            stats["entries"] += 1
            forms = [(k.findtext("keb") or "", k) for k in entry.findall("k_ele")]
            kanji_forms = [(word, k) for word, k in forms if KANJI.search(word)]
            if not kanji_forms:
                entry.clear()
                continue
            stats["entries_with_kanji"] += 1
            notes: dict = {"id": entry.findtext("ent_seq")}
            form_notes = []
            for word, k in forms:
                if texts(k, "ke_inf"):
                    form_notes.append({"text": word, "info": texts(k, "ke_inf")})
            if form_notes:
                notes["forms"] = form_notes
            # A missing POS inherits the last explicit POS within this entry,
            # even when that preceding sense was restricted to another form.
            senses = []
            inherited_pos: list[str] = []
            for sense in entry.findall("sense"):
                explicit_pos = texts(sense, "pos")
                if explicit_pos:
                    inherited_pos = explicit_pos
                codes = {pos_codes[pos] for pos in inherited_pos if pos in pos_codes}
                senses.append((set(texts(sense, "stagk")), set(texts(sense, "stagr")), codes))
            reading_notes = []
            for reading_index, r in enumerate(entry.findall("r_ele")):
                original = r.findtext("reb") or ""
                restrictions = texts(r, "re_restr")
                no_kanji = r.find("re_nokanji") is not None
                info = texts(r, "re_inf")
                if restrictions or no_kanji or info:
                    note = {"text": original}
                    if restrictions:
                        note["restricted_to"] = restrictions
                    if no_kanji:
                        note["no_kanji"] = True
                    if info:
                        note["info"] = info
                    reading_notes.append(note)
                if no_kanji:
                    stats["no_kanji_readings_not_paired"] += 1
                    continue
                value = hiragana(original)
                if not value:
                    continue
                for word, k in kanji_forms:
                    if restrictions and word not in restrictions:
                        stats["incompatible_pairs_not_added"] += 1
                        continue
                    rank = (priority(texts(r, "re_pri")), priority(texts(k, "ke_pri")),
                            stats["entries"], reading_index)
                    candidates = ranked.setdefault(word, {})
                    if value not in candidates or rank < candidates[value]:
                        candidates[value] = rank
                    for spellings, pronunciations, codes in senses:
                        if (spellings and word not in spellings) or (pronunciations and original not in pronunciations):
                            continue
                        for code in codes:
                            lexical.setdefault(word, {}).setdefault(code, set()).add(value)
            if reading_notes:
                notes["readings"] = reading_notes
            sense_notes = []
            for index, sense in enumerate(entry.findall("sense")):
                # Preserve lexical usage and sense restrictions, without glosses.
                note = {tag: texts(sense, tag) for tag in ("stagk", "stagr", "misc", "dial", "s_inf")
                        if texts(sense, tag)}
                if note:
                    sense_notes.append({"index": index, **note})
            if sense_notes:
                notes["senses"] = sense_notes
            if len(notes) > 1:
                notes["orthographies"] = [word for word, _ in forms]
                annotations.append(notes)
            entry.clear()
    words = {word: sorted(readings, key=lambda r: (readings[r], r)) for word, readings in ranked.items()}
    lexemes = {word: {code: [reading for reading in words[word] if reading in compatible]
                      for code, compatible in classes.items()}
               for word, classes in lexical.items()}
    return words, annotations, dict(stats), lexemes


def source_version(path: Path) -> str | None:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        # JMdict carries its release timestamp in a comment near the header.
        for index, line in enumerate(stream):
            if "JMdict created:" in line:
                return line.strip().removeprefix("<!--").removesuffix("-->").strip()
            if index > 1500:
                break
    return None


def verify(data: dict, cache_dir: Path) -> None:
    assert set(data) == {"kanji", "words", "kun", "lexemes"}
    assert ["おお", "きい"] in data["kun"]["大"]
    assert ["う", "まれる"] in data["kun"]["生"]
    for key in ("kanji", "words"):
        for word, readings in data[key].items():
            assert word and readings and len(readings) == len(set(readings))
            assert all(r and not any("ァ" <= c <= "ヶ" for c in r) for r in readings)
    assert len(data["kanji"]) > 10000 and len(data["words"]) > 100000
    for key, word, reading in (("kanji", "食", "た"), ("kanji", "思", "おも"),
                               ("kanji", "生", "せい"), ("kanji", "煌", "こう"),
                               ("kanji", "響", "ひび"), ("words", "明日", "あした"),
                               ("words", "一人", "ひとり"), ("words", "食べる", "たべる"),
                               ("words", "思い", "おもい")):
        assert reading in data[key][word], (key, word, reading)
    assert "おもう" not in data["kanji"]["思"]
    assert "たべる" not in data["kanji"]["食"]
    for word, classes in data["lexemes"].items():
        assert word in data["words"] and classes
        for code, readings in classes.items():
            assert code in CONJUGATABLE_POS and readings
            assert readings == [r for r in data["words"][word] if r in readings]
    for word, code, reading in (("届く", "v5k", "とどく"), ("溜まる", "v5r", "たまる"),
                                ("黒い", "adj-i", "くろい"), ("濁る", "v5r", "にごる"),
                                ("攫う", "v5u", "さらう"), ("過去る", "v5r", "すぎさる")):
        assert reading in data["lexemes"][word][code], (word, code, reading)
    assert data["lexemes"]["意外"] == {"adj-na": ["いがい"], "adv-to": ["いがい"]}
    assert "過去" not in data["lexemes"]
    # Independent synthetic parser tests exercise restriction and priority logic.
    fixture = '''<JMdict><entry><ent_seq>1</ent_seq>
    <k_ele><keb>食</keb></k_ele><k_ele><keb>思</keb></k_ele>
    <r_ele><reb>シ</reb><re_restr>思</re_restr><re_inf>rare reading</re_inf></r_ele>
    <r_ele><reb>ショク</reb><re_restr>食</re_restr><re_pri>ichi1</re_pri></r_ele>
    <r_ele><reb>カナ</reb><re_nokanji/></r_ele>
    </entry><entry><ent_seq>2</ent_seq><k_ele><keb>食</keb></k_ele>
    <r_ele><reb>ク</reb></r_ele></entry></JMdict>'''
    with tempfile.TemporaryDirectory(prefix="verify-", dir=cache_dir) as directory:
        path = Path(directory) / "fixture.gz"
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write(fixture)
        words, notes, _, lexemes = build_words(path)
        assert lexemes == {}
        # Artificial descriptions ensure codes come from this DTD, not a
        # hard-coded English description map. Test inheritance and its reset.
        lexical_fixture = '''<!DOCTYPE JMdict [
        <!ENTITY v1 "test ichidan"><!ENTITY v5r "test godan"><!ENTITY n "test noun">
        ]>
        <JMdict><entry><ent_seq>1</ent_seq>
        <k_ele><keb>試る</keb></k_ele><k_ele><keb>験る</keb></k_ele>
        <r_ele><reb>ためる</reb></r_ele>
        <r_ele><reb>しる</reb><re_restr>試る</re_restr></r_ele>
        <r_ele><reb>けんる</reb><re_restr>験る</re_restr></r_ele>
        <r_ele><reb>かな</reb><re_nokanji/></r_ele>
        <sense><stagk>試る</stagk><stagr>ためる</stagr><pos>&v1;</pos></sense>
        <sense><stagk>験る</stagk><stagr>けんる</stagr></sense>
        <sense><stagk>試る</stagk><stagr>しる</stagr><pos>&v5r;</pos></sense>
        <sense><stagr>かな</stagr></sense>
        <sense><stagk>試る</stagk><stagr>けんる</stagr></sense>
        <sense><pos>&n;</pos></sense>
        <sense><stagk>験る</stagk><stagr>ためる</stagr></sense>
        </entry></JMdict>'''
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write(lexical_fixture)
        _, _, _, lexemes = build_words(path)
        assert lexemes == {"試る": {"v1": ["ためる"], "v5r": ["しる"]},
                           "験る": {"v1": ["けんる"]}}, lexemes
    assert words == {"食": ["しょく", "く"], "思": ["し"]}, words
    assert notes[0]["readings"][0]["restricted_to"] == ["思"]
    assert notes[0]["readings"][2]["no_kanji"] is True
    assert hiragana("オモ") == "おも"


def main(args: argparse.Namespace) -> None:
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    sources = {name: acquire(name, args.cache_dir, args.refresh, args.offline) for name in SOURCES}
    kanji, header, kanji_notes, character_count, kun = build_kanji(sources["kanjidic2"][0])
    words, word_notes, stats, lexemes = build_words(sources["jmdict"][0])
    data = {"kanji": kanji, "words": words, "kun": kun, "lexemes": lexemes}
    verify(data, args.cache_dir)
    artifacts = {
        "japanese-readings.json": data,
        "japanese-readings-restrictions.json": {"kanji": kanji_notes, "entries": word_notes},
    }
    for filename, content in artifacts.items():
        write_json(args.output_dir / filename, content)
    metadata = {
        "schema_version": 3, "generator": "scripts/update-japanese-reading-dictionary.py",
        "generator_sha256": sha256(Path(__file__)),
        "attribution": ATTRIBUTION, "license": "CC-BY-SA-4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "upstream_license_url": "https://www.edrdg.org/edrdg/licence.html",
        "sources": {name: {**meta, "upstream_urls": SOURCES[name],
                            "version": header if name == "kanjidic2" else source_version(path)}
                    for name, (path, meta) in sources.items()},
        "counts": {"kanji": len(kanji), "kanji_readings": sum(map(len, kanji.values())),
                   "words": len(words), "word_readings": sum(map(len, words.values())),
                   "lexemes": len(lexemes),
                   "lexeme_classes": sum(map(len, lexemes.values())),
                   "lexeme_readings": sum(len(r) for classes in lexemes.values() for r in classes.values()),
                   "source_kanji_characters": character_count, "jmdict": stats,
                   "annotated_kanji_readings": len(kanji_notes), "annotated_word_entries": len(word_notes)},
        "artifacts": {filename: {"sha256": sha256(args.output_dir / filename),
                                  "bytes": (args.output_dir / filename).stat().st_size}
                      for filename in artifacts},
        "policy": {
            "kanji": "All ja_on/ja_kun; hiragana; strip affix hyphens and dotted okurigana; no nanori.",
            "kun": "Original kun stem/okurigana pairs retained for contextual compatibility checks.",
            "words": "All exact kanji-containing orthographies; obey re_restr/re_nokanji; unique readings ordered by commonness then source order.",
            "lexemes": "Inflection and adj-na/adv-to grammar POS codes recovered from source DTD entities; exact orthography -> POS -> compatible readings. Obey re_restr/re_nokanji, sense stagk/stagr and inherited POS; retain words reading order. No noun-only classes.",
            "usage": "No rare/obsolete forms or readings are dropped; source usage and sense restrictions are preserved in the restrictions sidecar. XML entity descriptions are expanded by the XML parser.",
            "reproducibility": "Cached retrieval timestamps are reused; no generation-time timestamp. Identical verified sources and generator yield byte-identical artifacts.",
        },
    }
    write_json(args.output_dir / "japanese-readings.meta.json", metadata, pretty=True)
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    for word in ("食", "思", "生", "煌", "響", "明日", "一人", "食べる", "思い"):
        key = "kanji" if len(word) == 1 else "words"
        print(f"{key}[{word}] = {json.dumps(data[key][word], ensure_ascii=False)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path("/root/jplrc-reading-work"))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "src/lib/dictionaries")
    parser.add_argument("--refresh", action="store_true", help="Download new daily snapshots, replacing the cache")
    parser.add_argument("--offline", action="store_true", help="Require cached sources and verify their SHA256")
    ARGS = parser.parse_args()
    if ARGS.refresh and ARGS.offline:
        parser.error("--refresh and --offline cannot be combined")
    try:
        main(ARGS)
    except Exception as error:
        print(f"Dictionary generation failed: {error}", file=sys.stderr)
        raise
