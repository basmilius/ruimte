# APNs on the shared Pulsar Worker

Development and production devices use the same Worker and database. The registered
APNs environment selects both the Apple endpoint and the credential pair. It does not
select a different broker, TURN server, Worker hostname or Apple team.

| Device environment | Private-key secret | Key-ID secret | Current key ID |
| --- | --- | --- | --- |
| `sandbox` | `APNS_SANDBOX_KEY` | `APNS_SANDBOX_KEY_ID` | `Q39B5735J7` |
| `production` | `APNS_PRODUCTION_KEY` | `APNS_PRODUCTION_KEY_ID` | `9X8N3H3LXC` |

`APNS_TEAM_ID=7RGV9KKX87` and `APNS_TOPIC=app.ruimte.mobile` are shared configuration
in `wrangler.jsonc`. Normal notifications and Live Activities use the same selected
key. Live Activity requests append `.push-type.liveactivity` to the topic.

Each environment has its own JWT cache. Missing credentials reject registration and
delivery for that environment with HTTP 503; the Worker never substitutes the other
key. Device records are unique per account session and environment, so registering a
production device does not overwrite its sandbox counterpart.

## Local custody

The original files are stored on Bas's Mac in `~/.private/ruimte/apns/`:

- `AuthKey_Q39B5735J7.p8`
- `AuthKey_9X8N3H3LXC.p8`

The directory has mode 700 and files have mode 600. Both files were validated as
P-256 private keys and compared before the Downloads copies were removed. Key IDs
identify the files supplied by Bas; local parsing cannot prove their Apple-side APNs
permissions or environment scope. No new off-machine backup was created.

Never commit key contents or include them in command arguments, logs or reports.
Cloudflare receives them as Worker secrets, separately from the nonsecret team/topic
configuration. Other provider secrets on the shared Worker must be preserved.

## Activation status, September 16

Bas approved uploading both private keys to Cloudflare. Code and all four APNs secrets
were uploaded together as inactive version `4644bc8d-2565-44df-a27b-d4449b4a68ec`.
The temporary upload file was removed. Existing Apple, GitHub and statement-signing
secrets were verified present in the uploaded version. Other shared Worker variables
were preserved with `--keep-vars`.

Remote migrations `0006_push.sql` and `0008_activity_target.sql` both succeeded.
A D1 Time Travel bookmark was captured before migration in
`/tmp/ruimte-apns-d1-before.json`. Both migrations are additive.

Bas explicitly approved the full release, including Pulsar. Version
`4644bc8d-2565-44df-a27b-d4449b4a68ec` was activated, then the successful GitHub
Address book workflow deployed the same code as version
`d4dfa111-8bde-492a-be30-69c2149e2c70`. This is the deployment verified during the
release; later `main` pushes may produce new version IDs. Both APNs pairs and the existing login/signing
secrets were verified present after that deployment. The prior pre-push-support version
is `30be96f9-baf9-4112-a02b-03c4f2c70882`. Additive migrations can remain if rolling
back the Worker. See
[Cloudflare's version documentation](https://developers.cloudflare.com/workers/versions-and-deployments/).

Remote smoke checks passed: `/health` reports both providers healthy, unauthenticated
`POST /v1/push/devices` returns 401, and an invalid `POST /v1/push` returns 400.
These checks establish route availability and input rejection, not Apple delivery.

The installed daemon on port 4210 now runs 0.0.17. It has not been restarted during
the notification fixes. Development runs separately on port 4211 with `~/.ruimte-dev`;
`RUIMTE_DEV_HOME` selects an alternate development profile. Inheriting `RUIMTE_HOME`
from a terminal inside production must not make development reuse its identity.

105 Worker/server push tests pass, one optional statement-key test is skipped.
The suite includes real local Worker runtime tests, environment-specific JWT signatures,
rotation, missing credentials and independent device registrations. It uses fixture
keys, not the real APNs keys. Logs are in `/tmp/ruimte-apns-full-tests.log`.

Pulsar health remained healthy after migration with both Apple and GitHub providers
enabled and the same public statement key. Real APNs delivery and Live Activity
behavior remain unverified. Enable Notifications on the iPhone and connect an updated development daemon, then
check foreground suppression, background turn completion, attention, approval actions
and automatic Live Activity start/update/end across multiple agents. Production delivery additionally needs a production-signed app/device
token; a sandbox test does not establish production delivery.

## Automatic machine activities, September 16

Migration `0009_machine_activities.sql` adds an optional device activity scope. Version
`58dbf509-d16a-4c84-bab5-af903287f02c` was deployed at 100%, preserving credentials
and existing routes. The recovery bookmark is in
`/tmp/ruimte-machine-activities-d1-before.json`. Pulsar health passed after deployment.

New iOS clients register `scope: machines` once. New daemons combine terminal and chat
states into one signed overview per machine. Legacy clients retain conversation-scoped
routing; new clients still send a known-session follow list for 0.0.17 daemons that do not
understand `followAll`. Automatic overviews require the updated daemon, currently in the
development checkout. Counts, account isolation, opt-out, ordered transitions and existing
push behavior passed 176 Bun tests (one optional statement-key test skipped). The Swift
package passed 41 tests and the signed iPhone build was installed.

The physical iPhone crash report `Ruimte-2026-09-16-094234.ips` identifies a UIKit assertion
while completing a notification response on the cooperative executor. The callback bridge
now finishes on the main thread, registers before launch completion and queues cold-start
responses until the account has loaded. A repeat tap on-device and visible automatic
start/update/end remain acceptance checks, not results established by the automated tests.
