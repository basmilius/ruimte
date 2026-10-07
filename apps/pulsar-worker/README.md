# Pulsar address book

The Cloudflare Worker behind `https://pulsar.ruimte.app`. It knows which machines belong to an account
and signs access statements a daemon believes because the public half of the statement key is pinned
in `packages/pulsar/src/statement-key.ts`. The wire shapes live in `packages/pulsar`.

- Worker `ruimte-pulsar`, account `5e565cf9fa55b0eae1f8131903da2ca9`, also on `https://ruimte-pulsar.bas.workers.dev`
- D1 database `ruimte-pulsar`, migrations in `migrations/`
- A cron at 04:17 UTC drops expired logins, codes, rate limit windows and dead sessions
- A cron every three hours (`17 */3 * * *`) reads the model benchmarks of Artificial Analysis into D1

## Routes

| Route                                      | What                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /health`                              | The public statement key the Worker signs with and which providers work                    |
| `GET /auth/<provider>/start`               | Opened by the app in the system browser; `link` adds the provider to the signed-in account |
| `GET /auth/github/callback`                | Where GitHub sends the browser back                                                        |
| `POST /auth/apple/callback`                | Where Apple posts the browser back (`response_mode=form_post`)                             |
| `POST /v1/apple/start`                     | Native Apple sign-in attempt and nonce, bound to the app's PKCE challenge                  |
| `POST /v1/apple/complete`                  | Apple credentials become a one-time code for the standard session exchange                 |
| `POST /v1/session`                         | The one-time code, the PKCE verifier and the key the session is bound to                   |
| `POST /v1/session/refresh`                 | A new access and refresh token, signed with the session key                                |
| `DELETE /v1/session`                       | Sign out                                                                                   |
| `GET /v1/providers`                        | The providers that are configured, so a client only offers those                           |
| `GET /v1/models/benchmarks`                | Model indices, costs and output speed per effort, for the model comparison        |
| `GET /v1/models/catalog`                   | The shipped model catalogs per agent kind, for a machine to pick up a new model            |
| `GET /v1/account`                          | The account and its identities                                                             |
| `DELETE /v1/account`                       | Delete the account and everything bound to it, with the typed name and an Apple code       |
| `POST /v1/account/link`                    | A single-use link token for the start URL, bound to this session                           |
| `POST /v1/account/identities`              | The code of a link login with its verifier, from the same session                          |
| `DELETE /v1/account/identities/<provider>` | Remove an identity; the last one is refused                                                |
| `GET /v1/machines`                         | The machines on this account, and the ids a person removed from it                         |
| `POST /v1/machines`                        | Register a machine with the daemon's signature; `automatic` skips a removed one            |
| `DELETE /v1/machines/<id>`                 | Take a machine off the list and remember that it was removed                               |
| `POST /v1/statements`                      | A signed statement for one machine and one client key, two minutes                         |

## The account

An account (`AccountSchema` in `packages/pulsar`) is its `id`, the `provider` and `login` of the identity it
is shown as (the oldest with a login, else the oldest), and a `displayName`. Each identity carries its own
`displayName` too: the person's name at the provider, or `null`. The account's `displayName` is that of the
identity it is shown as, and when that one has none, of the first identity in the same order that has one.
A client from before names ignores the field, and one reading an older Worker finds it missing.

GitHub hands the public name of the profile to every sign-in and link, so a rename on GitHub follows at the
next one. Apple sends the name only on the first authorization of an Apple ID for this app: on the web as
the `user` field of its form post, native as the credential's `fullName`, which the app may pass on as
`displayName` to `/v1/apple/complete` (the iOS app asks for no scope and sends none yet). Neither is signed, but each arrives with the id_token that proves the
identity it names. A sign-in without a name keeps the stored one; to have Apple send it again, stop using
Sign in with Apple for Ruimte in the Apple ID settings and sign in once more. A name has its control
characters and runs of whitespace folded and is cut at 100 characters. Migration `0013_display_name.sql`
adds the nullable columns, so the Worker still running while it applies keeps working.

## Deleting an account

`DELETE /v1/account` takes `AccountDeletePayloadSchema` (`{ confirmation, appleAuthorizationCode? }`) with a live
access token and answers 204. `confirmation` is what the person typed: the name `accountConfirmationName` in
`packages/pulsar` gives (the account's `displayName`, else its `login`, else the fixed word `DELETE`, never
translated), compared ignoring case and runs of whitespace. A mismatch is `confirmation-mismatch` (400) and deletes
nothing. It is limited to five tries a minute per account, and shares the per-address window of the session routes.

One batch deletes every row bound to the account: its sessions on every device, its identities (so a later
sign-in with one of them opens a new account), its machines and the removals it remembered, the devices and the
statement log, push devices with their activities, receipts and pending starts, and whatever a sign-in, a link
or a device link left half done. The rate limit windows keyed on it go with the daily cleanup.

A machine leaves the account by its row going, so another account may list its key afterwards. The machine
itself is not told: it keeps the account it signed for in its own `auth.json`, no statement for that account can
be signed any more, and it takes another account only once a person on it leaves the first
(`apps/server/README.md`, "One account per machine"). A client a statement already let in stays paired with the
machine until then. The desktop app takes its own machine off right after a deletion, with the local secret.

### Revoking Sign in with Apple

Apple asks an app that deletes an account made with Sign in with Apple to revoke the user's tokens. This Worker
drops Apple's tokens at sign-in, so the iOS app brings a fresh one:

1. Right before deleting, the app runs `ASAuthorizationAppleIDProvider` for the Apple ID on the account (no
   scope, no nonce needed) and takes the credential's `authorizationCode`.
2. It sends that as `appleAuthorizationCode` beside `confirmation` within the five minutes the code lives.
3. The Worker trades it at `/auth/token` as `APPLE_NATIVE_CLIENT_ID` without a `redirect_uri`, checks the
   id_token's signature, issuer, audience and expiry, and that its subject is the account's Apple identity. It
   then posts the refresh token to `/auth/revoke` (`token_type_hint=refresh_token`), with the same client secret
   it signs logins with. No new secret is needed.

Only once Apple answers 200 does the account go. A code for another Apple ID, or one sent for an account without
an Apple identity, is `bad-request`; Apple refusing the code or the revocation is `apple-revocation-failed` (502).
Either way nothing is deleted, so the app asks for a new code and tries again. The desktop sends no code: a
person deleting there ends Sign in with Apple in the Apple ID settings themselves.

## Statements and the one account of a machine

A statement (`POST /v1/statements`) carries two signatures with the statement key. `signature` is over
`accessStatementMessage`: the machine id, the client key, the nonce and the times, which is all a daemon
from before v2 reads. `accountSignature` is over `accessStatementV2Message`, which adds the key this
account's row lists the machine with (`machinePublicKey`) and the account (`accountId`). A machine id is
no secret, so a second account can list the same id under a key of its own; the v2 statement it gets
names that key, and the machine refuses a statement that does not name its own key. A daemon from 0.13
refuses one without the v2 fields, and a machine bound to an account one for another account
(`apps/server/README.md`).

A machine is on one account at a time and only moves itself, so `POST /v1/machines` and a device link
refuse a machine key that another account lists with `machine-on-other-account` (409). A row an account
already holds for that key keeps updating, so two accounts that listed one machine before this rule keep
it; nothing is thrown away. A person removes the machine from the other account first.

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
PUBLIC_ORIGIN=http://localhost:8787
```

A GitHub OAuth app for local dev needs `http://localhost:8787/auth/github/callback` as its callback,
so use a second app rather than changing the production one.

Tests run the bundled Worker in workerd through Miniflare, on an in-memory D1 with GitHub and Apple mocked
(Apple's token endpoint and keys answer from the test, with a throwaway .p8 and signing key):

```sh
bun test                         # in apps/pulsar-worker
PULSAR_STATEMENT_PRIVATE_KEY=... bun test   # also checks a statement against the pinned key
```

## Deploying

A push to `main` that touches the Worker, its shared API package, deploy script or workflow runs
`.github/workflows/pulsar-worker.yml`: typecheck, tests, remote migrations, deploy, benchmark refresh,
and a request to `/health`. It needs the repository secret `CLOUDFLARE_API_TOKEN`, a Cloudflare API token with:

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
run before the new Worker is live, so a migration must keep the Worker that is still running working;
`0002_machine_broker.sql` adds `broker_url` as a nullable column for that reason, and `0003_session_key.sql`
adds `session_key` the same way: the new Worker refuses to refresh a session without a key, so every session
from before the binding signs in again.

Migration `0005_identity.sql` copies every account's provider and subject into the new `identity` table and
leaves the columns on `account` for the Worker still running while it applies. A GitHub account made by that
Worker in the seconds before the deploy gets its identity on its next sign-in.

A login may only come back to the redirects `isAppRedirectUri` in `packages/pulsar` allows: the app scheme, a
loopback listener, `https://station.ruimte.app/pulsar/callback` and the Vite dev origin. `ALLOWED_ORIGINS` in
`wrangler.jsonc` names the web client, so its page may read the answers of `/v1/*`.

## Secrets

| Secret                        | What                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `STATEMENT_PRIVATE_KEY`       | The private half of the statement key, pkcs8 DER in base64url |
| `GITHUB_CLIENT_ID`            | From the GitHub OAuth app                                     |
| `GITHUB_CLIENT_SECRET`        | From the GitHub OAuth app                                     |
| `APPLE_TEAM_ID`               | The team id of the Apple Developer account, ten characters    |
| `APPLE_KEY_ID`                | The id of the Sign in with Apple key, ten characters          |
| `APPLE_PRIVATE_KEY`           | The whole `.p8` file of that key, armor lines included        |
| `APPLE_CLIENT_ID`             | The Services ID, `app.ruimte.pulsar`                          |
| `ARTIFICIAL_ANALYSIS_API_KEY` | The key of the free Data API of Artificial Analysis           |

```sh
cd apps/pulsar-worker
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put APPLE_TEAM_ID
bunx wrangler secret put APPLE_KEY_ID
bunx wrangler secret put APPLE_CLIENT_ID
bunx wrangler secret put APPLE_PRIVATE_KEY < ~/.private/AuthKey_XXXXXXXXXX.p8
bunx wrangler secret put ARTIFICIAL_ANALYSIS_API_KEY
```

Without the GitHub pair, `/auth/github/start` answers `503` with `not-configured` and `/health` says
`"github": false`. Apple is the same with any of its four missing: `/health` says `"apple": false`,
`/v1/providers` leaves it out, and the clients draw no Apple button, so the Worker deploys safely before the
secrets exist. The private statement key is also kept in `~/.private/ruimte.secrets.env` as
`PULSAR_STATEMENT_PRIVATE_KEY`.

## Model catalogs

`GET /v1/models/catalog` is public and answers `@adecore/agents/providers/claude-models.json` and
`codex-models.json` as they are in this deploy, under `catalogs.claude` and `catalogs.codex`, cacheable
for five minutes. A daemon takes a catalog only when it passes `ModelCatalogDataSchema` and is not older
than the one it shipped with, so adding a model is an edit to those files (with a newer `updatedAt`), a row
in `src/benchmark-models.ts` and a push to main, which deploys this Worker. A change a daemon of today
could not read goes on a new route, never on this one.

## Model benchmarks

`GET /v1/models/benchmarks` is public and feeds the model comparison in the app. The Worker reads the free
Data API of Artificial Analysis (`GET /api/v2/language/models/free`, the key in `x-api-key`, 200 models
a page, `page` from 1 while `has_more`, at most ten pages) every three hours, so four pages cost 32 of the
100 requests a day. It keeps one snapshot in D1 with model metadata, Intelligence, Coding and Agentic
indices, cost per task, total benchmark cost and median output tokens per second. Missing values stay
absent; a model with a score but no cost still appears in the index charts. Token counts and time per
benchmark task are not available on Free and are not inferred from output speed.

The optional `measurements` and `intelligenceIndexVersion` fields extend the response. `models.points`
still contains complete Intelligence/cost pairs for older clients, and a cache created before migration
`0015_benchmark_measurements.sql` remains readable. Apply the migration before deploying this Worker;
the deploy refresh fills the new fields. A failed, malformed, truncated or mixed-version fetch
keeps the previous snapshot. Unrelated source fields are neither stored nor returned. Without the key
the route answers `503` with `not-configured`; before the first successful refresh it answers `503` with
`no-benchmarks`.

Which model of Artificial Analysis stands for which model and effort of Ruimte is `src/benchmark-models.ts`,
looked up by id. A new model is a row there and a deploy of this Worker, not a release of the app. `X-RateLimit-Remaining` and `X-RateLimit-Reset`
on an answer say how much of the day is left.

### Refresh after deployment

`bun run deploy` uses `scripts/deploy-pulsar-worker.ts`. After applying migrations, it generates a
random bearer token, deploys only its SHA-256 digest and a 15-minute expiry as Worker bindings, then
calls `POST /internal/benchmarks/refresh`. The bearer stays in the deploy process and is never passed
to Wrangler or printed. No additional GitHub secret is needed; the Artificial Analysis key stays in
the Worker. While the deployment reaches Cloudflare's edges, the script waits up to 55 seconds for
an old version's `404` or `401` to clear. Those requests never reach Artificial Analysis. Other errors
are not retried because the refresh may already have consumed quota.

The route validates the token and atomically consumes it before fetching, including when the upstream
request fails. Repeated or concurrent calls cannot spend the Free quota again. The response confirms
the new snapshot only after D1 has stored it. A failed refresh fails the deployment job while retaining
the previous snapshot; it does not undo the deployed Worker. The three-hour schedule continues, and
each deploy uses one additional paginated fetch from the daily Free allowance. The existing daily
rate-limit cleanup removes expired deployment claims.

## The GitHub OAuth app

GitHub, Settings, Developer settings, OAuth Apps, New OAuth App:

- Application name: `Ruimte`
- Homepage URL: `https://github.com/basmilius/ruimte`
- Authorization callback URL: `https://pulsar.ruimte.app/auth/github/callback`
- Enable Device Flow: off

Generate a client secret on the app's page and put both values in the secrets above. The Worker asks
for no scope: the numeric user id, the login and the public name come with any token, and the token is dropped after
one request to `/user`.

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

Only the `name` scope is asked, never `email`, so no email relay has to be configured. If the portal asks to verify the domain, put
the file it hands out in the `APPLE_DOMAIN_ASSOCIATION` secret: the Worker serves it at
`/.well-known/apple-developer-domain-association.txt`.

### Native iOS sign-in

The iOS app uses Apple's system authorization sheet. It sends a PKCE challenge to `/v1/apple/start`,
then passes the returned nonce unchanged to `ASAuthorizationAppleIDRequest`. The attempt expires after
ten minutes. `/v1/apple/complete` spends it atomically before verifying the identity token and exchanging
the authorization code with Apple. Both identity tokens must have Apple's signature, the native audience,
the same subject and the attempt's nonce. Expired tokens and attempts are refused.

The native audience and client-secret subject are fixed to `app.ruimte.mobile` through
`APPLE_NATIVE_CLIENT_ID` in `packages/pulsar`. The native token request has no `redirect_uri`.
The web route keeps `APPLE_CLIENT_ID`, the Services ID. Because that Services ID is grouped under the
same primary App ID, native and web Apple identities resolve to the same Ruimte account.

A successful completion returns a login code valid for sixty seconds. The app exchanges it at
`/v1/session` with its original PKCE verifier, the existing `ruimte://pulsar/callback` redirect value and
a signature from its device session key. This redirect value binds the exchange; native login opens no
browser or callback URL. Both native routes share the existing login IP rate limit. They never store
Apple identity, access or refresh tokens.

Apply migration `0007_native_apple.sql` before deploying this Worker. It only adds the attempt table and
its expiry index, so the previous Worker can keep serving requests during migration. The daily cleanup
removes unused expired attempts. Existing Apple configuration needs no new secrets: native login uses
`APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`, with the key authorized for the primary App ID
`app.ruimte.mobile`. The iOS app needs the matching Sign in with Apple capability and provisioning profile.
Until this Worker is deployed, the two native routes return `404` from the previous version. With missing
Apple signing credentials, the new Worker returns `503` with `not-configured`.

The tests mock Apple's public keys and token endpoint with throwaway signing keys and run the routes
against real D1 through Miniflare. They cover native and web account consistency, one-time consumption,
wrong signatures, audiences and nonces, mismatched subjects, expiry, rate limits and the final signed
session exchange. Provisioned-device authorization against Apple still requires a configured deployment.

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
