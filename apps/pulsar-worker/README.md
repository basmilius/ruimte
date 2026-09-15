# Pulsar address book

The Cloudflare Worker behind `https://pulsar.ruimte.app`. It knows which machines belong to an account
and signs access statements a daemon believes because the public half of the statement key is pinned
in `packages/pulsar/src/statement-key.ts`. The wire shapes live in `packages/pulsar`; the decisions
are under "The address book" in `docs/DECISIONS.md`.

- Worker `ruimte-pulsar`, account `5e565cf9fa55b0eae1f8131903da2ca9`, also on `https://ruimte-pulsar.bas.workers.dev`
- D1 database `ruimte-pulsar`, migrations in `migrations/`
- A cron at 04:17 UTC drops expired logins, codes, rate limit windows and dead sessions

## Routes

| Route                              | What                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `GET /health`                      | The public statement key the Worker signs with and which providers work |
| `GET /auth/<provider>/start`       | Opened by the app in the system browser; `link` adds the provider to the signed-in account |
| `GET /auth/github/callback`        | Where GitHub sends the browser back                                     |
| `POST /auth/apple/callback`        | Where Apple posts the browser back (`response_mode=form_post`)          |
| `POST /v1/session`                 | The one-time code, the PKCE verifier and the key the session is bound to |
| `POST /v1/session/refresh`         | A new access and refresh token, signed with the session key             |
| `DELETE /v1/session`               | Sign out                                                                |
| `GET /v1/providers`                | The providers that are configured, so a client only offers those       |
| `GET /v1/account`                  | The account and its identities                                          |
| `POST /v1/account/link`            | A single-use link token for the start URL, bound to this session        |
| `POST /v1/account/identities`      | The code of a link login with its verifier, from the same session        |
| `DELETE /v1/account/identities/<provider>` | Remove an identity; the last one is refused                     |
| `GET /v1/machines`                 | The machines on this account, and the ids a person removed from it      |
| `POST /v1/machines`                | Register a machine with the daemon's signature; `automatic` skips a removed one |
| `DELETE /v1/machines/<id>`         | Take a machine off the list and remember that it was removed            |
| `POST /v1/statements`              | A signed statement for one machine and one client key, two minutes      |

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

A push to `main` that touches `apps/pulsar-worker/**` or `packages/pulsar/**` runs
`.github/workflows/pulsar-worker.yml`: typecheck, tests, remote migrations, deploy, and a request to
`/health`. It needs the repository secret `CLOUDFLARE_API_TOKEN`, a Cloudflare API token with:

- Account, `Workers Scripts`, Edit
- Account, `D1`, Edit
- Account, `Account Settings`, Read
- Zone `ruimte.app`, `Workers Routes`, Edit
- Zone `ruimte.app`, `Zone`, Read
- Zone `ruimte.app`, `SSL and Certificates`, Edit

By hand, logged in with `wrangler login`:

```sh
cd apps/pulsar-worker
bun run deploy                   # migrations on the remote database, then wrangler deploy
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

| Secret                  | What                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `STATEMENT_PRIVATE_KEY` | The private half of the statement key, pkcs8 DER in base64url    |
| `GITHUB_CLIENT_ID`      | From the GitHub OAuth app                                        |
| `GITHUB_CLIENT_SECRET`  | From the GitHub OAuth app                                        |
| `APPLE_TEAM_ID`         | The team id of the Apple Developer account, ten characters       |
| `APPLE_KEY_ID`          | The id of the Sign in with Apple key, ten characters             |
| `APPLE_PRIVATE_KEY`     | The whole `.p8` file of that key, armor lines included           |
| `APPLE_CLIENT_ID`       | The Services ID, `app.ruimte.pulsar`                             |

```sh
cd apps/pulsar-worker
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put APPLE_TEAM_ID
bunx wrangler secret put APPLE_KEY_ID
bunx wrangler secret put APPLE_CLIENT_ID
bunx wrangler secret put APPLE_PRIVATE_KEY < ~/.private/AuthKey_XXXXXXXXXX.p8
```

Without the GitHub pair, `/auth/github/start` answers `503` with `not-configured` and `/health` says
`"github": false`. Apple is the same with any of its four missing: `/health` says `"apple": false`,
`/v1/providers` leaves it out, and the clients draw no Apple button, so the Worker deploys safely before the
secrets exist. The private statement key is also kept in `~/.private/ruimte.secrets.env` as
`PULSAR_STATEMENT_PRIVATE_KEY`.

## The GitHub OAuth app

GitHub, Settings, Developer settings, OAuth Apps, New OAuth App:

- Application name: `Ruimte`
- Homepage URL: `https://github.com/basmilius/ruimte`
- Authorization callback URL: `https://pulsar.ruimte.app/auth/github/callback`
- Enable Device Flow: off

Generate a client secret on the app's page and put both values in the secrets above. The Worker asks
for no scope: the numeric user id and the login come with any token, and the token is dropped after
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

No scope is asked, so no email relay has to be configured. If the portal asks to verify the domain, put
the file it hands out in the `APPLE_DOMAIN_ASSOCIATION` secret: the Worker serves it at
`/.well-known/apple-developer-domain-association.txt`.

The iOS app will sign in natively later, and its `id_token` carries `app.ruimte.mobile` as the audience
rather than the Services ID; `verifyAppleIdToken` takes a list of audiences for that. A key stays valid
until it is revoked; a new key means a new `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`.

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
