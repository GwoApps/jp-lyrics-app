# Japanese dictionary data: attribution and licence copies

This package uses the KANJIDIC2 and JMdict dictionary files. These files are the property of the Electronic Dictionary Research and Development Group, and are used in conformance with the Group's licence. Copyright James William BREEN and the Electronic Dictionary Research and Development Group.

The derived `src/lib/data/japanese-readings*.json` dictionary data and annotations are licensed under **CC BY-SA 4.0 International**, not the MIT licence applying to application source code. Normalization, extraction, deduplication, compatibility filtering and ordering are adaptations made by this project. No endorsement by the original authors is implied. See [`../../japanese-reading-dictionary.md`](../../japanese-reading-dictionary.md) for processing details and integration attribution obligations.

## Included upstream licence texts

- `EDRDG-LICENCE.html`: unmodified bytes from <https://www.edrdg.org/edrdg/licence.html>. SHA256: `52f60ea9ca68170a2f0663d7dba381ebf1bd57c17a3347dfe21153865c156692`.
- `CC-BY-SA-4.0.txt`: full CC BY-SA 4.0 legal text from the SPDX licence-list project's plain-text mirror, <https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-SA-4.0.txt>. SHA256: `cde7883b9050a1104f4ac19a1572aafd6e5d7323b68351aaf51fbf4beba54966`. The canonical text endpoint returned HTTP 403 during retrieval; the licence itself remains <https://creativecommons.org/licenses/by-sa/4.0/legalcode>, with deed <https://creativecommons.org/licenses/by-sa/4.0/>.

Source dictionary release dates, actual retrieval timestamps, source SHA256 values, artifact hashes, exact counts and URLs are recorded in `src/lib/data/japanese-readings.meta.json`. Original compressed XML and source provenance are retained outside the repository at `/root/jplrc-reading-work`, never in public assets.
