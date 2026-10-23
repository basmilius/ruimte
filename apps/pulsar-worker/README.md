# Pulsar address book

The Cloudflare Worker behind `https://pulsar.ruimte.app`. It knows which machines belong to an account
and signs access statements a daemon believes because the public half of the statement key is pinned
in `packages/pulsar/src/statement-key.ts`. The wire shapes live in `packages/pulsar`.

- Worker `ruimte-pulsar`, account `5e565cf9fa55b0eae1f8131903da2ca9`, also on `https://ruimte-pulsar.bas.workers.dev`
- D1 database `ruimte-pulsar`, migrations in `migrations/`
- A cron at 04:17 UTC drops expired logins, codes, rate limit windows and dead sessions. Each run checks in with
  Observatory as the monitor `pulsar-nightly` (`src/check-in.ts`, `OBSERVATORY_CHECK_IN_URL`), so a run that is missed,
  takes over two minutes or fails opens an issue in the address book's app. A check-in that fails never fails the run
- Errors and log lines go to the same app through `@sentry/cloudflare` (`src/telemetry.ts`, `OBSERVATORY_DSN`, hence
  `nodejs_compat`), under the release `pulsar@<12 hex>` the deploy sets. An event keeps only the scrubber's allow-list
  of `@ruimte/telemetry`, so no request, address or body leaves, and a log line its first line and scalar attributes,
  scrubbed. An error the router answers with a 500 is handed to the SDK, since it never throws out of `fetch`
- A cron every three hours (`17 */3 * * *`) reads the model benchmarks of Artificial Analysis into D1

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

An account (`AccountSchema` in `packages/pulsar`) is shown as one of its identities: the oldest with a login,
else the oldest. Its `displayName` is that identity's name at the provider, else the first identity in the same
order that has one. GitHub hands the profile's public name to every sign-in, so a rename follows at the next
one. Apple sends the name only on the first authorization of an Apple ID for this app: the `user` field of the
web form post, or the native credential's `fullName`, which the iOS app asks for and passes on as
`displayName` to `/v1/apple/complete`. A sign-in without a name keeps the stored one. A name has its control
characters and runs of whitespace folded and is cut at 100 characters.

## Deleting an account

`DELETE /v1/account` takes `{ confirmation, appleAuthorizationCode? }` (`AccountDeletePayloadSchema`) and answers
204. `confirmation` must match `accountConfirmationName` in `packages/pulsar` (the `displayName`, else the
`login`, else the untranslated word `DELETE`), ignoring case and runs of whitespace; a mismatch is
`confirmation-mismatch` (400). It allows five tries a minute per account. One batch deletes every row bound to
the account, so a later sign-in with one of its identities opens a new account.

A machine leaves the account by its row going, and is not told. It keeps the account in its own `auth.json`, no
statement for that account can be signed any more, and it takes another account only once a person on it
leaves the first. The desktop app takes its own machine off right after a deletion, with the local secret.

Apple asks an app that deletes a Sign in with Apple account to revoke the user's tokens. This Worker drops
Apple's tokens at sign-in, so the iOS app asks for a fresh authorization right before deleting and sends its
code as `appleAuthorizationCode`. The Worker trades it at `/auth/token` as `APPLE_NATIVE_CLIENT_ID`, checks
that the id_token's subject is the account's Apple identity, and posts the refresh token to `/auth/revoke`.
Only once Apple answers 200 does the account go; otherwise the answer is `bad-request` or
`apple-revocation-failed` (502) and nothing is deleted. The desktop sends no code: a person deleting there ends
Sign in with Apple in the Apple ID settings.

## Statements and the one account of a machine

A statement (`POST /v1/statements`) carries `signature` over `accessStatementMessage` and `accountSignature`
over `accessStatementV2Message`, which adds the key the account lists the machine with and the account.
`POST /v1/machines` and a device link refuse a machine key another account lists with
`machine-on-other-account` (409). A peer statement (`POST /v1/peer-statements`) carries one `signature` over
`peerStatementMessage`, naming both machines, their keys, the account and the peer key. The request is signed twice
over `peerAccessRequestMessage`, by the peer key and by the key the account lists for the machine that works; a
machine of another account answers `not-found`. The log marks it `kind = 'peer'`. What a machine accepts is in
[`apps/server/README.md`](../server/README.md#one-account-per-machine).

## Usage statistics

`POST /v1/usage` takes `{ days: UsageDay[] }` (`UsageBatchSchema` in `packages/pulsar/src/usage.ts`) and answers 204
with no body. Nothing in it names a person, a machine or a project: no account, no machine key, no install id, no
names or paths. A day carries its UTC date, the version, the platform and arch, how the daemon runs (`service`,
`desktop`, `standalone`), whether the machine is on an account, `firstThisWeek` and `firstThisMonth` (the machine's
first active day of this ISO week or UTC calendar month, so a sum of either is the active machines in it), the ISO week
of the machine's first day (`cohortWeek`), the median desktop start until the first connection (`startupMs`, optional)
and `counts`, a fixed set of counters that are each optional and default to zero.

What the address book refuses with `bad-request` (400), always the whole batch, since the body itself is wrong:

- any key the schema does not name, at every level
- a count that is not a whole number from 0 to 100,000, or a `startupMs` outside 1 to 600,000
- no days, more than seven, or one date twice
- a cohort week after the day's week
- a body over 32 KB

The address book keeps no usage itself: a batch it takes goes on to Observatory (below), which skips a day dated after
today (UTC) or before the eighth day before it and still takes the others. A batch that is refused is wrong, so a machine drops those days rather than send them again. A `rate-limited` (429)
or any other failure keeps them for the next try. Each address may send three batches a minute (the
`USAGE_LIMIT` rate limiting binding) and twenty a day (a bucket in `rate_limit` named by a SHA-256 digest of the
day and the address, which the daily cleanup drops once the day is over). The address and the body are never logged.
A batch that was taken but whose answer got lost is counted twice when it is sent again; there is no id to tell.

### Observatory

Every batch the address book accepts goes, whole and after the answer (`ctx.waitUntil`), to Observatory's usage
ingest of the daemon app (`OBSERVATORY_USAGE_URL` in `wrangler.jsonc`, `usageRelay` in `src/usage.ts`), under the
names of the report a newer daemon sends (`usageReportOfV1`). The request carries the product's upload token (`OBSERVATORY_UPLOAD_TOKEN`), which
tells Observatory that the address book limits per address itself, so its own limit per address, which would see only
Cloudflare's, is skipped. The address is not passed on. A relay that fails is logged by its status only and never
changes the machine's answer. Without the URL or the token the route answers `not-configured`. From 0.22.0 on a daemon sends straight
to Observatory; `/v1/usage` stays for older ones and goes once 0.23.0 is out.

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

The APNs secrets (`APNS_SANDBOX_KEY`, `APNS_PRODUCTION_KEY` and their key ids) are in [`APNS.md`](APNS.md).

A GitHub OAuth app for local dev needs `http://localhost:8787/auth/github/callback` as its callback,
so use a second app rather than changing the production one.

Tests run the bundled Worker in workerd through Miniflare, on an in-memory D1 with GitHub and Apple mocked:

```sh
bun test                         # in apps/pulsar-worker
PULSAR_STATEMENT_PRIVATE_KEY=... bun test   # also checks a statement against the pinned key
```

## Deploying

A push to `main` that touches the Worker, its shared API package, deploy script or workflow runs
`.github/workflows/pulsar-worker.yml`: typecheck, tests, a wait until `ci.yml` passed on the same
commit, remote migrations, deploy, benchmark refresh, and a request to `/health`. It needs the
repository secret `CLOUDFLARE_API_TOKEN`, a Cloudflare API token with:

- Account, `Workers Scripts`, Edit
- Account, `D1`, Edit
- Account, `Account Settings`, Read
- Zone `ruimte.app`, `Workers Routes`, Edit
- Zone `ruimte.app`, `Zone`, Read
- Zone `ruimte.app`, `SSL and Certificates`, Edit

By hand, logged in with `wrangler login`:

```sh
cd apps/pulsar-worker
bun run deploy                   # remote migrations, deploy, then refresh the benchmarks
```

A migration is a new numbered file in `migrations/`, committed with the code that reads it. Migrations
run before the new Worker is live, so a migration must keep the Worker that is still running working: add
nullable columns and new tables, and leave old columns in place until no running Worker reads them.

A login may only come back to the redirects `isAppRedirectUri` in `packages/pulsar` allows: the app scheme, a
loopback listener, `https://station.ruimte.app/pulsar/callback` and the Vite dev origin. `ALLOWED_ORIGINS` in
`wrangler.jsonc` names the web client and the model comparison at `bench.ruimte.app`, so their pages may read
the answers of `/v1/*`.

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
| `MAP_TICKET_SECRET` | At least 32 random bytes in base64url (`openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='`) that sign map tickets; the maps service holds the same value to check them. A shorter or malformed value answers `not-configured` |
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

A provider whose secrets are missing answers `503` with `not-configured`, reads `false` in `/health` and stays
out of `/v1/providers`, so the Worker deploys safely before the secrets exist. The private statement key is also
kept in `~/.private/ruimte.secrets.env` as `PULSAR_STATEMENT_PRIVATE_KEY`.

## Map tickets

`POST /v1/maps/ticket` answers `{ ticket, expiresAt }` (`MapsTicketSchema` in `packages/pulsar`), good for one hour. A signed-in client sends its bearer token; a machine asks for none, since only a client draws the map. The ticket is `<subject>.<expiresAt>.<mac>`: the subject is an HMAC of the account id under a key derived from `MAP_TICKET_SECRET` for that purpose alone, so the maps service tells tickets apart without learning whose they are, and
the mac is HMAC-SHA256 over `mapsTicketBytes` with the secret's bytes. The maps service checks it with `verifyMapsTicket` and the same secret, and never calls this database. Without the secret the route answers
`503` with `not-configured`. An account may ask ten times a minute and an address thirty.

## Model catalogs

`GET /v1/models/catalog` is public and answers `@adecore/agents/providers/claude-models.json` and
`codex-models.json` as they are in this deploy, under `catalogs.claude` and `catalogs.codex`, cacheable
for five minutes. A daemon takes a catalog only when it passes `ModelCatalogDataSchema` and is not older
than the one it shipped with, so adding a model is an edit to those files (with a newer `updatedAt`), a row
in `src/benchmark-models.ts` and a push to main, which deploys this Worker. A change a daemon of today
could not read goes on a new route, never on this one.

## Model benchmarks

`GET /v1/models/benchmarks` is public and feeds the model comparison. Every three hours the Worker reads the
free Data API of Artificial Analysis (`GET /api/v2/language/models/free`, 200 models a page, at most ten pages),
so four pages cost 32 of the 100 requests a day. It keeps one snapshot in D1. Missing values stay absent and are
never inferred, and a failed, malformed, truncated or mixed-version fetch keeps the previous snapshot. Without
the key the route answers `503` with `not-configured`, and before the first refresh with `no-benchmarks`.

Which Artificial Analysis model stands for which Ruimte model and effort is `src/benchmark-models.ts`, so a new
model is a row there and a deploy of this Worker, not a release of the app. The labs the chart groups models
by (name, mark as one SVG path, a color per model and theme) are `BENCHMARK_LABS` beside them and go out with
every answer, so a new lab is a deploy too. A client draws only the models whose lab is in that list.

### Refresh after deployment

`bun run deploy` (`scripts/deploy-pulsar-worker.ts`) deploys the SHA-256 digest of a random bearer with a
15-minute expiry and then calls `POST /internal/benchmarks/refresh`; the bearer never leaves the deploy process.
The route consumes the token before it fetches, so a repeat cannot spend the Free quota twice, and a failed
refresh fails the job but keeps the previous snapshot and the deployed Worker.

## The GitHub OAuth app

GitHub, Settings, Developer settings, OAuth Apps, New OAuth App:

- Application name: `Ruimte`
- Homepage URL: `https://github.com/basmilius/ruimte`
- Authorization callback URL: `https://pulsar.ruimte.app/auth/github/callback`
- Enable Device Flow: off

Generate a client secret on the app's page and put both values in the secrets above. The Worker asks
for no scope: the numeric user id, the login and the public name come with any token, and the token is
dropped after one request to `/user`.

## Sign in with Apple

Apple Developer, Certificates, Identifiers & Profiles:

1. Identifiers, the App ID `app.ruimte.mobile` (the primary App ID; the desktop app is `app.ruimte.desktop`):
   tick Sign In with Apple under Capabilities, "Enable as a primary App ID", and save.
2. Identifiers, +, Services IDs: description `Ruimte`, identifier `app.ruimte.pulsar`. Open it, tick Sign In
   with Apple, Configure: primary App ID `app.ruimte.mobile`, domain `pulsar.ruimte.app`, return URL
   `https://pulsar.ruimte.app/auth/apple/callback`. Save, then Continue and Save on the Services ID.
3. Keys, +: name `Ruimte Pulsar`, tick Sign in with Apple, Configure with primary App ID `app.ruimte.mobile`,
   Register, and download the `.p8`. It downloads once; keep it in `~/.private`. The key id is on the
   key's page, the team id in the top right of the portal and under Membership.
4. Put the four secrets above with `wrangler secret put`, and check `/health` says `"apple": true`.

Only the `name` scope is asked, never `email`, so no email relay has to be configured. If the portal
asks to verify the domain, put the file it hands out in the `APPLE_DOMAIN_ASSOCIATION` secret: the Worker serves it at
`/.well-known/apple-developer-domain-association.txt`.

### Native iOS sign-in

The iOS app sends a PKCE challenge to `/v1/apple/start` and passes the returned nonce unchanged to
`ASAuthorizationAppleIDRequest`. `/v1/apple/complete` spends the attempt (ten minutes) atomically before it
verifies the identity token and exchanges the authorization code. Both identity tokens must carry Apple's
signature, the native audience, the same subject and the attempt's nonce. The native audience is
`APPLE_NATIVE_CLIENT_ID` (`app.ruimte.mobile`) in `packages/pulsar`, the web route keeps the Services ID, and
because the Services ID is grouped under that primary App ID both resolve to the same account. A completion
returns a login code valid for sixty seconds, which the app exchanges at `/v1/session` with its PKCE verifier,
the `ruimte://pulsar/callback` redirect value and its device key. The Worker never stores Apple's tokens.

Native login needs no secrets beyond `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`, with the key
authorized for the primary App ID `app.ruimte.mobile`. The iOS app needs the matching Sign in with Apple
capability and provisioning profile. Without the signing credentials, both native routes answer `503` with
`not-configured`.

A key stays valid until it is revoked; a new key means a new `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`.
Apple documents native code exchange in [Token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens).

## Rotating the statement key

A daemon believes a statement only when a key in `PULSAR_STATEMENT_PUBLIC_KEYS` signed it, so the new
public half has to ship before the Worker signs with the new private half.

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
