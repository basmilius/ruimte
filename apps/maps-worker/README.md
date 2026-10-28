# Map service

`ruimte-maps` at `maps.ruimte.app` puts TomTom's Orbis map display behind a ticket from the address book. It holds the TomTom key, stores nothing and has no database. `observability` is off in `wrangler.jsonc`, since Workers Logs would record which area was viewed. Observatory (`src/telemetry.ts`, app Maps) gets only `internal` errors and TomTom failures, by kind and by style or asset, never a request, path, tile or ticket.

## Routes

Every route but `/health` needs `Authorization: Bearer <ticket>`, from `POST /v1/maps/ticket` on the address book (`apps/pulsar-worker`). The ticket never rides in the URL, so it stays out of logs and cache keys.

| Route | What |
| --- | --- |
| `GET /health` | `{ ok: true }`, without a ticket |
| `GET /v1/style?theme=light\|dark` | The monochrome Orbis style, every address pointed at this service and the key removed |
| `GET /v1/m/<grant>/<tail>` | A tile, sprite, glyph range or TileJSON the style named, and only that |

Errors are `{ error: { code, message } }` with `maps-unconfigured` (503), `bad-ticket` (401), `rate-limited` (429, with `retry-after`), `not-found` (404), `bad-request` (400) or `upstream` (502). TomTom's error body is never passed on, since it may echo the key.

## What it serves

Only the style and what the style names. The rewrite turns each TomTom address in `sprite`, `glyphs` and a source's `tiles` and `url` into `/v1/m/<grant>/<tail>`. The grant is TomTom's address with its placeholders, signed by `signMapsPath` with a key derived from `MAP_TICKET_SECRET`. A TomTom address anywhere else in a body is blanked.

The tail fills the placeholders: three numbers for a tile, a font stack and range for glyphs (`Noto%20Sans%20Regular%2CNoto%20Sans%20Italic/0-255.pbf`), or `sprite[@2x].json|png`. It is matched as sent, never decoded. Before a request leaves, the upstream path must be map display or assets, unchanged by the URL parser, with `%` only for a space or comma. A client's query is never forwarded.

An upstream body must be JSON (rewritten, then searched for the key) or a known binary type (vector tile, protobuf, png, webp, jpeg, gif). Any other type is refused.

## What stays out

- The worker adds the key upstream. A JSON body that still holds the key after the rewrite is not sent.
- Upstream requests carry only `user-agent: ruimte-maps`, `accept` and the key. No client address, cookie, referer or `x-forwarded-for`. A `key` parameter in a client's query is dropped.
- A ticket's subject is a keyed digest of the account. The rate limit (`TICKET_LIMIT`, 600 a minute per subject) counts by it.

## Cache

`caches.default` keeps a successful response no longer than TomTom's `Cache-Control` allows (`s-maxage` before `max-age`, minus `Age`). Nothing is cached under `no-store`, `no-cache`, `private` or without the header. The key is the upstream path and sorted query without the key. The client gets `private, max-age=<remaining>`. Whether TomTom's terms allow a shared cache is unverified; to turn it off, replace `deps.cache` with one that never hits.

## Who calls it

The client fetches a ticket with its session (`AddressBookClient.mapsTicket`), renews it five minutes before it ends, and sends it only to this origin (`apps/client/src/chat/map-source.ts`). The page's policy already allows `https:` fetches and `blob:` workers, which MapLibre needs (`packages/csp`).

## Secrets

| Secret | What |
| --- | --- |
| `TOMTOM_API_KEY` | A TomTom key with Map Display and Assets (Orbis) rights; Search is not used |
| `MAP_TICKET_SECRET` | The same value as the address book's, at least 32 bytes in base64url |

```sh
cd apps/maps-worker
bunx wrangler@4.136.3 secret put TOMTOM_API_KEY
bunx wrangler@4.136.3 secret put MAP_TICKET_SECRET
```

Until both exist, every route but `/health` answers `maps-unconfigured`. A push to `main` that touches this folder or `packages/pulsar` deploys it (`.github/workflows/maps-worker.yml`, repository secret `CLOUDFLARE_API_TOKEN`). The first deploy creates the custom domain when the zone is on the same account.

## The style version

The style path (`maps/orbis/assets/styles/0.6.*/style`) pins the minor version, because TomTom answers 403 for `0.*` and 200 for `0.6.*`. Patch updates come along. An address with a placeholder other than a tile's (`{z}/{x}/{y}`) or glyphs' (`{fontstack}/{range}`), such as `{ratio}`, is blanked from the style.

## Development

`bun test` runs the handlers against a fake upstream and cache. `bun run dev` serves them locally with secrets from `.dev.vars` (ignored by git).
