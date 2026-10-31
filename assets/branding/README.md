# App Icon

The single source glyph is Google's **Material Symbols Outlined / lyrics**, optical size 24, regular outlined style. The original SVG is vendored unchanged from:

- Repository: https://github.com/google/material-design-icons
- Commit: `6d7ca43bd6e6668531a00fcaca06d921b63dd716`
- Path: `symbols/web/lyrics/materialsymbolsoutlined/lyrics_24px.svg`
- License: Apache-2.0, full text in `LICENSE.material-symbols`.

The adaptations only apply the app's existing brand purple `#a78bfa`, adjust size/padding, and compose platform surfaces. The Material glyph path itself is unchanged. No icon font, CDN stylesheet, or runtime network request is needed.

## Generate and verify

```sh
npm run icons:generate
npm run icons:check
```

The generator uses the explicitly pinned Sharp development dependency. `npm run check` verifies that every generated asset exactly matches the checked-in source/config. Edit `app-icon.json` or the upstream source, then regenerate; do not hand-edit the PNG/ICO files or generated `src/lib/app-icon.ts`. When changing artwork later, bump the coordinated revision in the config, manifest and service worker; the integration tests enforce that those URLs agree.

## Asset roles

- `public/icon.svg`, `public/icon-16x16.png`, `public/icon-32x32.png`: transparent browser icons, no background tile.
- `src/app/favicon.ico`: transparent 16/32/48/64/128/256px frames for browser fallback.
- `public/icon-192x192.png`, `public/icon-512x512.png`: standard/desktop PWA icons, purple mark on a rounded dark surface.
- `public/icon-maskable-512x512.png`: full-bleed opaque Android/adaptive icon, with the entire colored foreground inside the circular 40%-radius safe zone.
- `public/apple-touch-icon.png`: opaque 180px square; Apple applies its own platform corner mask, so corners are not pre-rounded.
- `src/components/AppIcon.tsx`: the same path/color for the in-app brand mark. Functional music/playback icons and song-cover placeholders are not App Icon assets and are unchanged.

Browser metadata deliberately excludes PWA background images. PWA manifest icon URLs, browser icon URLs and the service-worker icon cache use a coordinated revision to invalidate old art without changing the application's manifest identity. Existing installed apps still refresh launcher artwork according to each platform's update schedule.
