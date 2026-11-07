# Vendored Japanese reading dictionary

The application can resolve reading candidates locally from actual **EDRDG KANJIDIC2 and JMdict** snapshots. The generated indexes are not an exhaustive grammar, a Japanese name dictionary, or a runtime web-service cache. No Jisho or other external dictionary request is needed to use this data.

## Attribution and licence

> This package uses the KANJIDIC2 and JMdict dictionary files. These files are the property of the Electronic Dictionary Research and Development Group, and are used in conformance with the Group's licence. Copyright James William BREEN and the Electronic Dictionary Research and Development Group.

The generated dictionary data and its usage-restriction annotations are adaptations distributed under **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**, **not the application's MIT licence**. The application source code and the generator remain covered by the application's MIT licence; using these separately licensed data files does not relicense the application. The modifications are extraction of Japanese readings, katakana-to-hiragana conversion, stripping dotted okurigana from isolated-kanji readings, deduplication, compatibility filtering and commonness-based ordering. No endorsement by EDRDG or the original contributors is implied.

- [EDRDG general dictionary licence and required attribution](https://www.edrdg.org/edrdg/licence.html), vendored at [`licenses/japanese-reading-dictionary/EDRDG-LICENCE.html`](licenses/japanese-reading-dictionary/EDRDG-LICENCE.html).
- [CC BY-SA 4.0 licence deed](https://creativecommons.org/licenses/by-sa/4.0/), [full legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode), vendored at [`licenses/japanese-reading-dictionary/CC-BY-SA-4.0.txt`](licenses/japanese-reading-dictionary/CC-BY-SA-4.0.txt).
- [KANJIDIC documentation](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project).
- [JMdict project and documentation](https://www.edrdg.org/jmdict/j_jmdict.html), [JMdict/EDICT project](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project).

Redistributions must retain this attribution, identify adaptations and retain the licence links/copies. For a web dictionary function or an on-screen display of words from these files, the EDRDG licence additionally requires acknowledgement on each dictionary display, for example a footer linking to EDRDG and the licence. Where material from the files is mixed with other sources, EDRDG permits a general source acknowledgement. **UI integrators must include the applicable visible acknowledgement; a source-code comment alone is not sufficient.** The editor displays a visible `KANJIDIC2 / JMdict · EDRDG · CC BY-SA 4.0` acknowledgement with a link to the EDRDG licence beneath Japanese candidate choices.

## Files and exact schemas

### `src/lib/dictionaries/japanese-readings.json`

Compact UTF-8 JSON with exactly these top-level fields:

```ts
{
  kanji: Record<string, string[]>;
  words: Record<string, string[]>;
  kun: Record<string, Array<[kanjiReading: string, okurigana: string]>>;
  lexemes: Record<string, Record<string, string[]>>;
}
```

- `kanji`: every KANJIDIC2 character with at least one Japanese `ja_on` or `ja_kun` reading. All such readings are retained and converted to hiragana, deduplicated in upstream order. `nanori` personal-name readings are not included. Characters without Japanese on/kun readings are not given fabricated empty or guessed entries.
- `kun` retains each original normalized `[stem, okurigana]` pair so contextual lookups can reject readings that would duplicate existing kana (e.g. 生まれる must not use うま).
- Kun readings are split at the first dot: `おも.う` becomes `おも`, **not** `おもう`; `た.べる` becomes `た`, **not** `たべる`. Affix hyphens at either end are stripped. Keeping the whole inflected reading on an isolated kanji would cause incorrect candidates.
- `words`: exact, unnormalized JMdict `keb` orthographies containing a CJK ideograph (including extension/compatibility blocks), `々` or `〇`, mapped to compatible normalized `reb` readings. Punctuation, kana and okurigana in the orthography are preserved exactly. Kana-only entries are not indexed here.
- Each reading's `re_restr` allowlist is respected. `re_nokanji` readings are never paired with kanji orthographies. Different JMdict entries with the same orthography contribute to a union of unique readings.
- `lexemes` (schema version 3) maps exact orthography → supported JMdict grammar POS code → compatible readings, in the same reading order as `words`. Older snapshots may omit this additive field; consumers should treat absence as an empty index. It is lexical evidence for class-validated inflection/deinflection and adjectival/adverbial suffixes, not a precomputed list of inflected forms.
- Its supported POS codes are exactly `v1`, `v1-s`, `v5u`, `v5k`, `v5k-s`, `v5g`, `v5s`, `v5t`, `v5n`, `v5b`, `v5m`, `v5r`, `v5r-i`, `vk`, `vs`, `vs-i`, `vs-s`, `adj-i`, `adj-ix`, `adj-na`, `adv-to`. Noun-only senses and unsupported conjugation classes do not create entries. `vs` explicitly licenses suru attachment; it does not make the bare noun an ichidan verb. `adj-na` and `adv-to` license class-checked な/に/と contexts without falling back blindly to isolated noun readings: `lexemes['意外']` contains `{'adj-na': ['いがい'], 'adv-to': ['いがい']}`.
- POS descriptions expanded by ElementTree are mapped back to codes using the entity declarations in that exact source's DTD, not a guessed English-description table. Missing POS inherits the preceding explicit POS within the same entry; an explicit noun POS resets that inheritance. Each spelling/reading/POS triple must satisfy `re_restr`, `re_nokanji`, sense `stagk` and sense `stagr`. Sense restrictions narrow `lexemes`, never the general `words` index. Restrictions are checked against original source spellings/readings before hiragana normalization.
- Examples: `lexemes['届く'].v5k = ['とどく']`, `lexemes['溜まる'].v5r = ['たまる']`, `lexemes['黒い']['adj-i'] = ['くろい']`, `lexemes['濁る'].v5r = ['にごる']`, `lexemes['攫う'].v5u = ['さらう']`. Bare `過去` has no `lexemes` entry, while the distinct spelling `過去る` is a real `v5r` verb read `すぎさる`. A runtime must not derive `過去 → 過去る → すぎさ` by stripping ichidan `る` without verifying the class.
- Reading priority is applied before orthography priority. `ichi1/news1/spec1/gai1` rank first, then numeric `nf01`…`nf48`, then `ichi2/news2/spec2/gai2`, then untagged readings. Ties preserve entry/reading source order. This is a stable dictionary ordering, not a contextual or statistical prediction of the user's intended reading.
- No explicitly rare, obsolete, irregular, dialectal or otherwise annotated form/reading is discarded: such flags do not universally mean that a lyric candidate is invalid. Usage annotations are retained separately instead of destructively guessing which flags to remove.
- An isolated-character lookup should prefer `kanji[character]`, not its independent JMdict word entry. Exact words have complete readings: `words['食べる']` is `['たべる']`; subsequent kanji/kana alignment belongs to the application, not this index.

Initial real snapshot coverage: **12,356 kanji / 35,559 distinct per-kanji readings; 227,154 exact word orthographies / 244,708 distinct per-orthography readings**. KANJIDIC2 contains 13,108 characters total, some without Japanese on/kun readings. JMdict has 219,036 entries, of which 175,869 have a qualifying kanji orthography. These are full-source results, not a hand-selected coverage subset. Consult metadata after an update rather than assuming these initial counts remain constant.

### `src/lib/dictionaries/japanese-readings-restrictions.json`

An audit/usage sidecar; **do not import it into the runtime unless needed**. Entity references in the XML are expanded to their upstream descriptive text by the XML parser.

```ts
{
  kanji: Array<{
    kanji: string;
    reading: string; // original, unnormalized source reading
    type: string; // ja_on or ja_kun
    attributes: Record<string, string>; // extra reading attributes, if present
  }>;
  entries: Array<{
    id: string; // original JMdict ent_seq
    orthographies: string[]; // all original keb forms for this entry
    forms?: Array<{ text: string; info: string[] }>; // ke_inf
    readings?: Array<{
      text: string; // original reb
      restricted_to?: string[]; // re_restr
      no_kanji?: true; // re_nokanji; excluded from word pairings
      info?: string[]; // re_inf
    }>;
    senses?: Array<{
      index: number; // zero-based original sense index
      stagk?: string[];
      stagr?: string[];
      misc?: string[];
      dial?: string[];
      s_inf?: string[];
    }>;
  }>;
}
```

Only entries/fields with annotations appear. `stagk`/`stagr` restrict meanings/senses, not the general `reb`/`keb` compatibility relation; they are preserved, not incorrectly used to delete valid readings. The sidecar is not a full dictionary: glosses, definitions and ordinary grammatical POS labels are intentionally omitted. Raw upstream snapshots remain authoritative for full lexical interpretation.

### `src/lib/dictionaries/japanese-readings.meta.json`

Records `schema_version`, generator path and SHA256, attribution/licence, source URLs/resolved URLs, UTC retrieval timestamps, HTTP last-modified values, compressed-source SHA256 and byte sizes, upstream versions, actual coverage/annotation counts, transformation policy, and generated data artifact SHA256/byte sizes. The metadata file is not self-hashed. No generation-time timestamp is inserted, so offline regeneration preserves all bytes.

## Update and reproduce

Python 3.11+ standard library only; no Node/Python dependency installation is required.

```sh
# Download once if missing; otherwise use a verified existing cache.
python3 scripts/update-japanese-reading-dictionary.py

# Explicitly fetch the latest upstream daily snapshots.
python3 scripts/update-japanese-reading-dictionary.py --refresh

# Reproduce without network access; reject missing or modified cache files.
python3 scripts/update-japanese-reading-dictionary.py --offline
```

Default raw cache: **`/root/jplrc-reading-work`**, outside the repository and all public assets. The vendored index uses `src/lib/dictionaries/`, outside the broad Git/Docker/deployment `data/` excludes; application databases under `data/` remain excluded.

Each dictionary has `<name>.xml.gz` and `<name>.source.json`; the latter records retrieval provenance and its SHA256. An offline reproduction requires both original raw files and their matching provenance files. `--cache-dir PATH` and `--output-dir PATH` support alternate nonpublic caches and isolated verification output. The source metadata in a release lets maintainers verify an archived source snapshot; the moving daily URL alone cannot reproduce an older snapshot.

The generator verifies gzip integrity on download, SHA256 integrity on cache reuse, real minimum coverage, required example readings, hiragana normalization and deduplication. Synthetic XML checks exercise `re_restr`, `re_nokanji`, rare-reading preservation, common-priority ordering, DTD-derived POS codes, `stagk`/`stagr`, inherited POS and explicit noun resets. Schema version 3 metadata adds `lexemes`, `lexeme_classes` and `lexeme_readings` counts and its extraction policy. Errors abort instead of generating fabricated fallback data. Re-running against the same verified sources and generator produces byte-identical data, annotations and metadata; adding `lexemes` preserves the existing `kanji`, `kun`, `words` contents and restrictions sidecar.

Canonical sources:

1. `https://www.edrdg.org/kanjidic/kanjidic2.xml.gz`
2. `https://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz`

The FTP-named JMdict HTTPS host presented a certificate hostname mismatch during the initial fetch. TLS verification was **not** bypassed. The successful fallback was **`https://www.edrdg.org/pub/Nihongo/JMdict_e.gz`**, another official EDRDG host serving the original compressed XML, not a third-party converted data set. Both candidate URLs and the successful URL are recorded in metadata. No third-party mirror was needed.

Initial snapshot: KANJIDIC2 file version `4`, database `2026-311`, created `2026-11-07`; JMdict comment `JMdict created: 2026-11-07`. Retrieval timestamps and full source/artifact hashes are in the metadata file.

## Reading examples (initial snapshot)

| Index | Orthography | Readings |
| --- | --- | --- |
| kanji | 食 | しょく, じき, く, た, は |
| kanji | 思 | し, おも, おもえら, おぼ |
| kanji | 生 | せい, しょう, い, う, うま, うまれ, お, は, き, なま, な, む |
| kanji | 煌 | こう, きらめ, きら, かがや |
| kanji | 響 | きょう, ひび |
| words | 明日 | あした, あす, みょうにち |
| words | 一人 | ひとり, いちにん |
| words | 食べる | たべる |
| words | 思い | おもい |
