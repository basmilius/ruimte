# Pulsar address book

The Cloudflare Worker behind `https://pulsar.ruimte.app`. It knows which machines belong to an account and signs access statements, which a daemon believes because the public statement key is pinned in `packages/pulsar/src/statement-key.ts`. Wire shapes live in `packages/pulsar`.

- Worker `ruimte-pulsar`, account `5e565cf9fa55b0eae1f8131903da2ca9`, also on `https://ruimte-pulsar.bas.workers.dev`
- D1 database `ruimte-pulsar`, migrations in `migrations/`
- A cron at 04:17 UTC drops expired logins, codes, rate limit windows and dead sessions. It checks in with Observatory as monitor `pulsar-nightly` (`src/check-in.ts`, `OBSERVATORY_CHECK_IN_URL`), which opens an issue for a run that is missed, takes over two minutes or fails. A failed check-in never fails the run.
- Errors and log lines go to Observatory through `@sentry/cloudflare` (`src/telemetry.ts`, `OBSERVATORY_DSN`, hence `nodejs_compat`), release `pulsar@<12 hex>`. Events keep only the allow-list of `@ruimte/telemetry`, and log lines their first line and scalar attributes, scrubbed. No request, address or body leaves. A 500 from the router is handed to the SDK explicitly.
- A cron every three hours (`17 */3 * * *`) reads Artificial Analysis's model benchmarks into D1.

## Routes

| Route | What |
| --- | --- |
| `GET /health` | The public statement key the Worker signs with and which providers work |
| `GET /.well-known/apple-developer-domain-association.txt` | The file in `APPLE_DOMAIN_ASSOCIATION`, while that secret is set |
| `GET /auth/<provider>/start` | Opened by the app in the system browser; `link` adds the provider to the signed-in account |
| `GET /auth/github/callback` | Where GitHub sends the browser back |
| `POST /auth/apple/callback` | Where Apple posts the browser back (`response_mode=form_post`) |
| `POST /v1/apple/start` | Native Apple sign-in attempt and nonce, bound to the app's PKCE challenge |
| `POST /v1/apple/complete` | Apple credentials become a one-time code for the standard session exchange |
| `POST /v1/session` | The one-time code, the PKCE verifier and the key the session is bound to |
| `POST /v1/session/refresh` | A new access and refresh token, signed with the session key |
| `DELETE /v1/session` | Sign out |
| `GET /v1/providers` | The providers that are configured, so a client only offers those |
| `GET /v1/models/benchmarks` | Model indices, costs and output speed per effort, for the model comparison |
| `GET /v1/models/catalog` | The shipped model catalogs per agent kind, for a machine to pick up a new model |
| `GET /v1/account` | The account and its identities |
| `DELETE /v1/account` | Delete the account and everything bound to it, with the typed name and an Apple code |
| `POST /v1/account/link` | A single-use link token for the start URL, bound to this session |
| `POST /v1/account/identities` | The code of a link login with its verifier, from the same session |
| `DELETE /v1/account/identities/<provider>` | Remove an identity; the last one is refused |
| `GET /v1/machines` | The machines on this account, and the ids a person removed from it |
| `POST /v1/machines` | Register a machine with the daemon's signature; `automatic` skips a removed one |
| `DELETE /v1/machines/<id>` | Take a machine off the list and remember that it was removed |
| `POST /v1/statements` | A signed statement for one machine and one client key, two minutes |
| `POST /v1/peer-statements` | A signed statement that one machine of the account may work in another under a peer key, ten minutes |
| `POST /v1/maps/ticket` | A map ticket for the account, one hour, for a bearer session; `not-configured` without `MAP_TICKET_SECRET` |
| `POST /v1/device/start`, `poll`, `complete`, `cancel` | The machine's side of a device link (`ruimte login`) |
| `POST /v1/device/lookup`, `approve`, `deny` | The person's side, from the link page (`DEVICE_LINK_PAGE_URL`) |
| `POST /v1/push/devices` | Register a device's APNs token for this session |
| `DELETE /v1/push/devices/<handle>` | Remove that device |
| `PUT /v1/push/devices/<handle>/activities` | Its Live Activity update tokens |
| `PUT /v1/push/devices/<handle>/start-activity` | Its Live Activity push-to-start token |
| `POST /v1/push` | A signed, encrypted push from a machine, relayed to APNs (`APNS.md`) |
| `POST /v1/usage` | Finished days of anonymous usage counts from a machine, without a token (see below) |
| `POST /internal/benchmarks/refresh` | The benchmark refresh after a deploy, with a one-time bearer |

## The account

An account (`AccountSchema`) shows as its oldest identity with a login, else its oldest. GitHub sends the public name at every sign-in. Apple sends it only on the first authorization, so the iOS app passes `fullName` as `displayName` to `/v1/apple/complete`. A sign-in without a name keeps the stored one. Names are cut at 100 characters.

## Deleting an account

`DELETE /v1/account` takes `{ confirmation, appleAuthorizationCode? }` (`AccountDeletePayloadSchema`) and answers 204. `confirmation` must match `accountConfirmationName` in `packages/pulsar` (the `displayName`, else the `login`, else the untranslated word `DELETE`), ignoring case and whitespace runs, or the answer is `confirmation-mismatch` (400). Five tries a minute per account. One batch deletes every row bound to the account, so a later sign-in opens a new account.

A machine on a deleted account is not told. It keeps the account in its `auth.json`, no statement for it can be signed any more, and it takes another account only after a person on it leaves the first. The desktop app takes its own machine off right after a deletion, with the local secret.

Apple requires revoking Sign in with Apple tokens on deletion. The Worker drops Apple's tokens at sign-in, so the iOS app gets a fresh authorization right before deleting and sends its code as `appleAuthorizationCode`. The Worker trades it at `/auth/token` as `APPLE_NATIVE_CLIENT_ID`, checks that the id_token's subject is the account's Apple identity, and posts the refresh token to `/auth/revoke`. Only on Apple's 200 does the account go; otherwise the answer is `bad-request` or `apple-revocation-failed` (502) and nothing is deleted. The desktop sends no code; a person there ends Sign in with Apple in the Apple ID settings.

## Statements and the one account of a machine

A statement (`POST /v1/statements`) carries `signature` over `accessStatementMessage` and `accountSignature` over `accessStatementV2Message`, which adds the machine's listed key and the account. `POST /v1/machines` and a device link refuse a machine key another account lists with `machine-on-other-account` (409).

A peer statement (`POST /v1/peer-statements`) carries one `signature` over `peerStatementMessage`, naming both machines, their keys, the account and the peer key. The request is signed twice over `peerAccessRequestMessage`, by the peer key and by the listed key of the machine that works. A machine of another account answers `not-found`. The log marks it `kind = 'peer'`. What a machine accepts is in [`apps/server/README.md`](../server/README.md#one-account-per-machine).

## Usage statistics

From 0.22.0 a daemon sends usage straight to Observatory. `/v1/usage` stays for older daemons and goes once 0.23.0 is out.

`POST /v1/usage` takes `{ days: UsageDay[] }` (`UsageBatchSchema` in `packages/pulsar/src/usage.ts`) and answers 204. Nothing in it names a person, machine or project. The whole batch is refused with `bad-request` (400) for:

- any key the schema does not name, at every level
- a count that is not a whole number from 0 to 100,000, or a `startupMs` outside 1 to 600,000
- no days, more than seven, or one date twice
- a cohort week after the day's week
- a body over 32 KB

A machine drops refused days and keeps them on `rate-limited` (429) or any other failure. Each address may send three batches a minute (`USAGE_LIMIT`) and twenty a day (a `rate_limit` bucket named by a SHA-256 of day and address). Address and body are never logged.

The address book stores no usage. After answering (`ctx.waitUntil`) it relays each accepted batch to Observatory (`OBSERVATORY_USAGE_URL` in `wrangler.jsonc`, `usageRelay` in `src/usage.ts`) with `OBSERVATORY_UPLOAD_TOKEN`, without the address. A failed relay is logged by status only. Without the URL or token the route answers `not-configured`.

## Local dev

```sh
bun install                      # at the repository root
cd apps/pulsar-worker
bun run migrate:local            # applies migrations/ to the local D1 in .wrangler
bun run dev                      # wrangler dev on http://localhost:8787
```

Secrets for `wrangler dev` go in `apps/pulsar-worker/.dev.vars` (ignored by git):

```sh
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
STATEMENT_PRIVATE_KEY=...
# Optional. Apple accepts only https return URLs on a registered domain, so Sign in with Apple does not work against localhost.
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_CLIENT_ID=...
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
# Optional. Without it `/v1/models/benchmarks` answers 503 `not-configured`.
ARTIFICIAL_ANALYSIS_API_KEY=...
# Optional. Served at /.well-known/apple-developer-domain-association.txt when set.
APPLE_DOMAIN_ASSOCIATION=...
# Optional. The page a person approves a machine's code on; defaults to https://station.ruimte.app/link.
DEVICE_LINK_PAGE_URL=http://localhost:4212/link
PUBLIC_ORIGIN=http://localhost:8787
```

The APNs secrets are in [`APNS.md`](APNS.md). Use a second GitHub OAuth app for local dev, with callback `http://localhost:8787/auth/github/callback`.

Tests run the bundled Worker in workerd through Miniflare, on an in-memory D1 with GitHub and Apple mocked:

```sh
bun test                         # in apps/pulsar-worker
PULSAR_STATEMENT_PRIVATE_KEY=... bun test   # also checks a statement against the pinned key
```

## Deploying

A push to `main` that touches the Worker, its shared API package, deploy script or workflow runs `.github/workflows/pulsar-worker.yml`: typecheck, tests, a wait for `ci.yml` on the same commit, remote migrations, deploy, benchmark refresh and a `/health` request. It needs the repository secret `CLOUDFLARE_API_TOKEN` with:

- Account, `Workers Scripts`, Edit
- Account, `D1`, Edit
- Account, `Account Settings`, Read
- Zone `ruimte.app`, `Workers Routes`, Edit
- Zone `ruimte.app`, `Zone`, Read
- Zone `ruimte.app`, `SSL and Certificates`, Edit

By hand, after `wrangler login`:

```sh
cd apps/pulsar-worker
bun run deploy                   # remote migrations, deploy, then refresh the benchmarks
```

A migration is a new numbered file in `migrations/`, committed with the code that reads it. Migrations run before the new Worker is live, so they must keep the running Worker working: add nullable columns and new tables, and leave old columns until no running Worker reads them.

A login may only return to redirects `isAppRedirectUri` in `packages/pulsar` allows: the app scheme, a loopback listener, `https://station.ruimte.app/pulsar/callback` and the Vite dev origin. `ALLOWED_ORIGINS` in `wrangler.jsonc` names the web client and `bench.ruimte.app`, so their pages may read `/v1/*`.

## Secrets

| Secret | What |
| --- | --- |
| `STATEMENT_PRIVATE_KEY` | The private half of the statement key, pkcs8 DER in base64url |
| `GITHUB_CLIENT_ID` | From the GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | From the GitHub OAuth app |
| `APPLE_TEAM_ID` | The team id of the Apple Developer account, ten characters |
| `APPLE_KEY_ID` | The id of the Sign in with Apple key, ten characters |
| `APPLE_PRIVATE_KEY` | The whole `.p8` file of that key, armor lines included |
| `APPLE_CLIENT_ID` | The Services ID, `app.ruimte.pulsar` |
| `ARTIFICIAL_ANALYSIS_API_KEY` | The key of the free Data API of Artificial Analysis |
| `MAP_TICKET_SECRET` | At least 32 random bytes in base64url (`openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='`) that sign map tickets; the maps service holds the same value. A shorter or malformed value answers `not-configured` |
| `OBSERVATORY_UPLOAD_TOKEN` | Optional, an upload token of Ruimte's product in Observatory; without it no usage is relayed |
| `APPLE_DOMAIN_ASSOCIATION` | Optional, the domain verification file Apple hands out |
| `DEVICE_LINK_PAGE_URL` | Optional, the device link page when it is not the station's |
| `APNS_*` | The APNs keys per environment, see [`APNS.md`](APNS.md) |

```sh
cd apps/pulsar-worker
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put APPLE_TEAM_ID
bunx wrangler secret put APPLE_KEY_ID
bunx wrangler secret put APPLE_CLIENT_ID
bunx wrangler secret put APPLE_PRIVATE_KEY < ~/.private/AuthKey_XXXXXXXXXX.p8
bunx wrangler secret put ARTIFICIAL_ANALYSIS_API_KEY
bunx wrangler secret put MAP_TICKET_SECRET
bunx wrangler secret put OBSERVATORY_UPLOAD_TOKEN
```

A provider without its secrets answers `503` with `not-configured`, reads `false` in `/health` and stays out of `/v1/providers`, so the Worker deploys safely first. The private statement key is also in `~/.private/ruimte.secrets.env` as `PULSAR_STATEMENT_PRIVATE_KEY`.

## Map tickets

`POST /v1/maps/ticket` answers `{ ticket, expiresAt }` (`MapsTicketSchema`), good for one hour, to a client's bearer session. Machines get none. The ticket is `<subject>.<expiresAt>.<mac>`. The subject is an HMAC of the account id under a key derived from `MAP_TICKET_SECRET` for that purpose alone, so the maps service tells tickets apart without learning whose they are. The mac is HMAC-SHA256 over `mapsTicketBytes`. The maps service checks it with `verifyMapsTicket` and never calls this database. Without the secret the route answers `503` `not-configured`. Limits are ten a minute per account and thirty per address.

## Model catalogs

`GET /v1/models/catalog` and `GET /v2/models/catalog` are public and answer `{ catalogs }` by agent kind, cacheable for five minutes. v1 answers `claude` and `codex`; v2 adds `grok`, `copilot` and `antigravity`. v1 never carries an ACP kind, since a daemon reading it would replace the models the agent reported itself.

Catalogs live in D1 (`migrations/0019_model_catalogs.sql`): `model_catalogs` per kind, `model_catalog_profiles` per profile and `model_catalog_models` per model, ordered by `position`. A person edits them with SQL, without a deploy; the `model-catalog` skill (`.claude/skills/model-catalog`) has the steps. Triggers set the kind's `updated_at`, so machines take a change within fifteen minutes.

The route answers D1 when the route's frozen schema (`src/catalog-schemas.ts`) accepts it. Otherwise, or without D1, it answers the manifest bundled into this deploy (`@adecore/agents/providers/<kind>-models.json`) and logs why. No HTTP route writes a catalog. A catalog that needs a schema released daemons cannot read goes on a new route.

Seed a kind into D1 once, from its manifest in `../adecore` or a file:

```sh
CLOUDFLARE_API_TOKEN=... bun scripts/seed-model-catalog.ts <kind> [file] [--force]
```

It refuses a kind D1 already holds unless `--force` overwrites it, deleting the kind's models and their benchmark rows first. Keep the ADE CORE manifests in line with D1 at each release, or a daemon with a newer manifest keeps its own.

## Model benchmarks

`GET /v1/models/benchmarks` is public and feeds the model comparison. Every three hours the Worker reads Artificial Analysis's free Data API (`GET /api/v2/language/models/free`, 200 models a page, at most ten pages; four pages a run is 32 of the 100 requests a day). It replaces `benchmark_measurements` (every listed model) and `benchmark_refreshes` (time and index version) in one batch. Missing values stay absent. A failed, malformed, truncated or mixed-version fetch keeps the previous snapshot. Without the key the route answers `503` `not-configured`, and before the first refresh `no-benchmarks`.

`model_catalog_benchmarks` maps each effort of a Ruimte model to Artificial Analysis's `source_id` and `source_name`, edited with SQL as in the `model-catalog` skill. The lab follows from the kind (`LAB_OF_KIND` in `src/benchmark-labs.ts`). `BENCHMARK_LABS` beside it holds each lab's name, mark and colors, so a new lab is a deploy.

### Refresh after deployment

`bun run deploy` (`scripts/deploy-pulsar-worker.ts`) deploys the SHA-256 of a random bearer with a 15-minute expiry and then calls `POST /internal/benchmarks/refresh`. The bearer never leaves the deploy process, and the route consumes it before fetching, so a repeat cannot spend the quota twice. A failed refresh fails the job but keeps the previous snapshot and the deployed Worker.

## The GitHub OAuth app

GitHub, Settings, Developer settings, OAuth Apps, New OAuth App:

- Application name: `Ruimte`
- Homepage URL: `https://github.com/basmilius/ruimte`
- Authorization callback URL: `https://pulsar.ruimte.app/auth/github/callback`
- Enable Device Flow: off

Generate a client secret and put both values in the secrets above. The Worker asks for no scope and drops the token after one request to `/user`.

## Sign in with Apple

Apple Developer, Certificates, Identifiers & Profiles:

1. Identifiers, the App ID `app.ruimte.mobile` (the primary App ID; the desktop app is `app.ruimte.desktop`): tick Sign In with Apple under Capabilities, "Enable as a primary App ID", and save.
2. Identifiers, +, Services IDs: description `Ruimte`, identifier `app.ruimte.pulsar`. Open it, tick Sign In with Apple, Configure: primary App ID `app.ruimte.mobile`, domain `pulsar.ruimte.app`, return URL `https://pulsar.ruimte.app/auth/apple/callback`. Save, then Continue and Save on the Services ID.
3. Keys, +: name `Ruimte Pulsar`, tick Sign in with Apple, Configure with primary App ID `app.ruimte.mobile`, Register, and download the `.p8`. It downloads once; keep it in `~/.private`. The key id is on the key's page, the team id in the top right of the portal and under Membership.
4. Put the four secrets above with `wrangler secret put`, and check `/health` says `"apple": true`.

Only the `name` scope is asked, never `email`. If the portal asks to verify the domain, put its file in the `APPLE_DOMAIN_ASSOCIATION` secret.

### Native iOS sign-in

The iOS app sends a PKCE challenge to `/v1/apple/start` and passes the returned nonce unchanged to `ASAuthorizationAppleIDRequest`. `/v1/apple/complete` spends the attempt (ten minutes) atomically before it verifies the identity token and exchanges the code. Both identity tokens must carry Apple's signature, the native audience, the same subject and the attempt's nonce. The native audience is `APPLE_NATIVE_CLIENT_ID` (`app.ruimte.mobile`); the web route keeps the Services ID, and both resolve to the same account through the primary App ID. A completion returns a login code valid for sixty seconds, which the app exchanges at `/v1/session` with its PKCE verifier, the `ruimte://pulsar/callback` redirect value and its device key. The Worker never stores Apple's tokens.

Native login needs only `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`, with the key authorized for `app.ruimte.mobile`, and the iOS app needs the matching capability and provisioning profile. Without the credentials both native routes answer `503` `not-configured`. A new key means a new `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`. See Apple's [Token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens).

## Rotating the statement key

A daemon believes a statement only when a key in `PULSAR_STATEMENT_PUBLIC_KEYS` signed it, so the new public half ships before the Worker signs with the new private half.

1. Generate a pair; this appends the private half to the secrets file and prints only the public half:

    ```sh
    bun -e '
    const { generateKeyPairSync } = require("node:crypto");
    const pair = generateKeyPairSync("ed25519");
    const secret = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
    require("node:fs").appendFileSync(process.env.HOME + "/.private/ruimte.secrets.env", `\nPULSAR_STATEMENT_PRIVATE_KEY_NEXT=${secret}\n`);
    console.log(pair.publicKey.export({ format: "jwk" }).x);
    '
    ```

2. Put the public half at the front of `PULSAR_STATEMENT_PUBLIC_KEYS` and release Ruimte.
3. Once that release is out, upload the private half and check `/health` names the new public key:

    ```sh
    grep '^PULSAR_STATEMENT_PRIVATE_KEY_NEXT=' ~/.private/ruimte.secrets.env | cut -d= -f2- | tr -d '\n' | bunx wrangler secret put STATEMENT_PRIVATE_KEY
    curl https://pulsar.ruimte.app/health
    ```

4. Drop the old public key from the list in a later release, and rename the entries in the secrets file.
