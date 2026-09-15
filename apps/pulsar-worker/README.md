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
| `GET /auth/github/start`           | Opened by the app in the system browser                                 |
| `GET /auth/github/callback`        | Where GitHub sends the browser back                                     |
| `POST /v1/session`                 | The one-time code, the PKCE verifier and the key the session is bound to |
| `POST /v1/session/refresh`         | A new access and refresh token, signed with the session key             |
| `DELETE /v1/session`               | Sign out                                                                |
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
PUBLIC_ORIGIN=http://localhost:8787
```

A GitHub OAuth app for local dev needs `http://localhost:8787/auth/github/callback` as its callback,
so use a second app rather than changing the production one.

Tests run the bundled Worker in workerd through Miniflare, on an in-memory D1 with GitHub mocked:

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

A login may only come back to the redirects `isAppRedirectUri` in `packages/pulsar` allows: the app scheme, a
loopback listener, `https://station.ruimte.app/pulsar/callback` and the Vite dev origin. `ALLOWED_ORIGINS` in
`wrangler.jsonc` names the web client, so its page may read the answers of `/v1/*`.

## Secrets

| Secret                  | What                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `STATEMENT_PRIVATE_KEY` | The private half of the statement key, pkcs8 DER in base64url    |
| `GITHUB_CLIENT_ID`      | From the GitHub OAuth app                                        |
| `GITHUB_CLIENT_SECRET`  | From the GitHub OAuth app                                        |

```sh
cd apps/pulsar-worker
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
```

Without the GitHub pair, `/auth/github/start` answers `503` with `not-configured` and `/health` says
`"github": false`. The private statement key is also kept in `~/.private/ruimte.secrets.env` as
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
