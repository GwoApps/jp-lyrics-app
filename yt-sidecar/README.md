# yt-sidecar — YouTube Music lyrics provider plugin

A production-grade reference implementation of the
**jplrc-lyrics-provider v1** protocol
([spec](../examples/provider-plugin/README.md)) backed by
[ytmusicapi](https://github.com/sigma67/ytmusicapi). It runs as a sidecar
container next to jplrc (see `docker-compose.yml`) and is registered as a
normal HTTP plugin row (`ytmusic-sidecar`) in the admin 系统 → 歌词源 panel —
there is no app-side special case for it.

A plugin only **retrieves candidates**. Scoring, LRC validation, low-confidence
review and persistence are owned by jplrc (see `provider_core.py`'s docstring
for the split of responsibility and the upstream API notes).

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/manifest.json` | `GET` | capability negotiation |
| `/v1/search` | `POST` | lyric candidates for one structured track |
| `/health` | `GET` | liveness probe |

```bash
# capability document
curl http://localhost:8910/manifest.json

# candidate search (the exact body jplrc sends)
curl -X POST http://localhost:8910/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"protocol_version":1,"request_id":"demo","track":{"title":"夜に駆ける","artists":["YOASOBI"],"duration_ms":261000},"accept":["synced","plain"],"max_candidates":20}'
```

No match is a normal `200` with `"candidates": []`. Upstream failures map to
`503 {"error":{"code":"temporary_unavailable", …}}`; a wrong `protocol_version`
maps to `400 invalid_request`. Each candidate carries the **real matched
identity** from the YouTube Music search result (title/artists/album/duration)
plus a `https://music.youtube.com/watch?v=…` source link — never the request's
identity echoed back.

## Wiring into jplrc

The seed migration (`drizzle/0021_convert_ytmusic_builtin_to_plugin.sql`)
creates the plugin row with base URL `http://yt-sidecar:8910`. Because that is
plaintext HTTP on the compose network, the jplrc container needs the
deployment-level policy switches (env-only, see DEPLOYMENT.md):

```yaml
LYRICS_PROVIDER_ALLOW_HTTP: "true"
LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK: "true"
```

Custom deployments with a different sidecar URL update the `ytmusic-sidecar`
row's base URL in the admin panel.

## Run / test

```bash
pip install -r requirements.txt
python server.py                 # YT_MUSIC_PORT=8910, YT_MUSIC_OAUTH=<oauth.json>
python3 -m unittest discover -s yt-sidecar   # protocol + mapping tests, no deps
```

## Public HTTPS deployment (e.g. for Cloudflare Workers hosts)

For deployments where jplrc cannot reach the sidecar over a private network,
expose it over public HTTPS and enable bearer auth:

1. Run the container behind a TLS reverse proxy. Traefik labels (same pattern
   as jplrc's own compose service):

   ```yaml
   services:
     yt-sidecar:
       build: ./yt-sidecar
       env_file: .env                # PROVIDER_TOKEN=<random secret>
       networks: [traefik-net]
       labels:
         - "traefik.enable=true"
         - "traefik.http.services.yt-sidecar.loadbalancer.server.port=8910"
         - "traefik.http.routers.yt-sidecar.rule=Host(`lyrics-sidecar.example.com`)"
         - "traefik.http.routers.yt-sidecar.entrypoints=${TRAEFIK_ENTRYPOINT}"
         - "traefik.http.routers.yt-sidecar.tls.certresolver=${TRAEFIK_CERTRESOLVER}"
   ```

2. Set `PROVIDER_TOKEN` to a long random secret. `/manifest.json` and
   `/v1/search` then require `Authorization: Bearer <token>` (401
   `auth_failed` otherwise); `/health` stays open for probes.

3. Register it in the admin 系统 → 歌词源 panel: base URL
   `https://lyrics-sidecar.example.com`, auth type `bearer`, secret = the same
   token. The default network policy (HTTPS + public only) accepts this without
   any `LYRICS_PROVIDER_ALLOW_*` change.

jplrc never sends session / Spotify credentials to plugins; the bearer token is
stored AES-GCM encrypted at rest (requires `LYRICS_PROVIDER_SECRET_KEY`, see
DEPLOYMENT.md).
