# Odd Dice meter-dice Easter egg

This is enabled only for **Odd Dice / millsage**, with the 248,828 ms full-version recording (duration tolerance 1,000 ms). Game cuts, covers, extended edits and unknown durations do not inherit this map. The header die uses the same interpolated playback ref as the lyrics, including silent preview, rather than a second BPM timer.

## Data provenance and limits

- Community transcription: [【数拍子】Odd Dice (Full Ver.)](https://www.bilibili.com/video/BV1YhJq6LE4Q/) by 鹤翔万里. The author states that game-version portions use the game's bar lines and full-version additions were transcribed by ear. **This is not an official score.**
- Extracted the video's current-bar numerals and meter displays, then aligned those changes with the die's actual beat flashes. Result: **138 source-numbered bars, 733 observed beats, no interpolated beat timestamps**. Each bar has exactly its numerator's number of beats.
- The 30 fps source quantizes timestamps to approximately **33.3 ms**. This is measurement resolution relative to the video, not proof of sample-accurate musical transcription or Spotify device synchronization.
- Waveform correlation against the downloaded game-version audio supports **zero offset at the beginning**: the first three five-second windows have lag 0, correlation 0.394 / 0.684 / 0.729. Correlation drops after 15 s because the game recording is a cut. We do not assume the entire game/full tracks share a timeline.
- The source uses 4/4, 5/4, 6/4 and 3/4. The different 6/8 notation reported for a piano arrangement is not substituted into this transcription. Likewise, a commercial bass score's 155-bar count is not conflated with this video's 138-bar count.
- The first numbered bar starts at **2,933.333 ms**. The source's intro/count-in is left without a fabricated lit face. **219,200–230,933.333 ms** is free time followed by a re-entry count-in, not a repeating six-beat bar; the die clears there. The last 3/4 bar retains the final chord until the source's musical ending at **248,800 ms**, then clears.
- Accelerando and ritardando use the observed **individual beat timestamps**. A sampled screen BPM must never be used as a constant BPM for that whole bar.

## Reproduction

Original public-source downloads, extraction scripts and audits are retained under `/root/public-files/odd-dice-full/` on the development host, separately from application code. No song audio/video is committed or added to the app bundle.

Extraction order (requires Python with OpenCV, NumPy, SciPy, Pillow; FFmpeg and Tesseract; and the `bilibili-cli` Python environment for the public fetch):

1. `fetch_video.py`: public video/audio API download. Expiring signed URLs are not persisted.
2. Decode the video to a 30 fps, 852×480 AVI at `/root/.hermes/cache/scratch/odd-dice-full-video.avi`.
3. `ocr_bars.py`: sample source bar numerals.
4. `extract_beat_flashes.py`: measure and identify actual beat flashes.
5. `refine_bars.py`: chronological numeral/template changes, source meters and observed beat grid produce `refined_meter_map.json`. The source-number morphs at bars 13 and 43 need beat-grid alignment rather than a naive numeral-cut timestamp.
6. `verify_audio_offset.py`: decode and cross-correlate opening waveforms.
7. `extract_bpm_readouts.py`: read the source's integer BPM display at bar boundaries and every 200 ms during ramps/ritardando, retaining only reliable readable integers. Hold the last reliable reading through numeral morphs; do not derive BPM from quantized beat gaps. This produces `bpm_readouts.json` with 63 tempo changes.
8. Import into the application, failing closed on gaps inside a bar, invalid/missing beats or interpolation:

   ```sh
   node scripts/import-odd-dice-map.mjs /root/public-files/odd-dice-full/refined_meter_map.json /root/public-files/odd-dice-full/bpm_readouts.json
   npm run check
   npm run build
   ```

The importer records the input SHA-256 in `src/lib/meter-maps/odd-dice.full.json`. Tests exercise all **733 exact beat boundaries**, signature changes, free-time gaps and song end, plus song/version gating. Component tests cover pause, forward/backward seek, tab visibility, mismatched tracks, reduced motion and hydration-safe SSR. They do not claim a real Spotify-device listening test.

## Presentation

The 48 px die sits at the right end of the song information header, with a **current BPM** caption below (not a redundant time-signature label). The caption reads the source tempo timeline from the same playback clock and may change within a beat without rebuilding or rotating the face. Standard 1–6 die faces light cumulatively through a bar and reset on its next downbeat. A continuous signature change rotates the face for 200 ms with WAAPI `transform` only; seeks snap directly, and reduced-motion disables the rotation. No React per-frame state or whole-page render is added. A stable localized image label is supplied in zh-CN, zh-TW, ja and en; beat changes are not a screen-reader live region.
