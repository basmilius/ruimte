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
push behavior passed 177 Bun tests (one optional statement-key test skipped). The Swift
package passed 41 tests and the signed iPhone build was installed.

The physical iPhone crash report `Ruimte-2026-09-16-094234.ips` identifies a UIKit assertion
while completing a notification response on the cooperative executor. The callback bridge
now finishes on the main thread, registers before launch completion and queues cold-start
responses until the account has loaded. A repeat tap on-device and visible automatic
start/update/end remain acceptance checks, not results established by the automated tests.

Migration `0010_pending_activity_updates.sql` retains the latest signed state while a
push-started activity is waiting for its update token, including an early end. The token
registration flushes that state. The corresponding Worker version
`560dab51-3ff1-4a14-88ea-e86a4497cdf8` was activated at 100% after the regression suite
passed. Both migrations are additive.

A physical-device smoke run used two temporary terminals on development machine
`YW9IZV86g20` (one running, one transitioning to attention, then both idle). The device
registered an ActivityKit update token with Pulsar. No new Ruimte crash report appeared
on the iPhone after the run. Bas confirmed: "Live Activity en openen werken allebei." The two temporary test
terminals were removed after that confirmation. The end state and more detailed count
transitions were not separately reported. Production-signed delivery remains untested.

## Read synchronization and activity design, September 16

Worker version `051bd343-c2fe-4c57-8a32-4ae81b711c85` is deployed at 100%. It accepts
signed, encrypted `background` envelopes and forwards them as silent APNs pushes with
priority 5. Read pushes have a separate collapse key from visible alerts, so they cannot
replace a pending notification for a newer turn. No database migration or secret change
was needed.

The daemon persists per-node notification timestamps and read watermarks in
`push-attention.json`. Desktop and web clients acknowledge the result actually visible
in a focused window through `push.read`; a new turn also acknowledges the previous
result. Only clients advertising `readSync` receive the background push. Connected
clients receive `push.attention` events, and iOS reconciles a snapshot when connecting.
A late acknowledgment cannot remove a newer notification. Signed payloads continue to
hide node IDs and read timestamps from Pulsar and APNs.

Apple schedules background pushes opportunistically; immediate removal is not guaranteed,
particularly after force-quitting the app or disabling Background App Refresh. Opening
Ruimte and connecting to the machine reconciles missed reads. A service extension cannot
reliably suppress an alert that arrives after its read receipt while the app is suspended;
the persisted watermark keeps its badge from becoming unread again, and foreground
reconciliation removes the delivered alert. See [Apple's background push guidance](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).

The Live Activity now has a dark surface, machine identity, separate working/attention
counts, orange attention states and a bounded timer. The Dynamic Island uses the same
hierarchy, with a compact count and an explicit stale state. It still represents one machine.

Validation: 186 Bun tests passed with one optional statement-key test skipped; 26 client
attention tests and 43 Swift package tests passed. Formatting, type checks and the signed
physical-iPhone build passed. The app was installed on the existing test iPhone. Current
physical read-removal and visual acceptance are recorded separately below. Production
0.0.17 clients/daemons require an update for read synchronization; existing alert delivery
remains compatible. No production daemon, broker or TURN process was restarted.

Bas confirmed two grouped notifications on the physical iPhone. A `push.read` request
for only the first result then removed one notification; Bas confirmed that exactly one
remained. The second result and both temporary terminals were subsequently cleaned up.
The Mac visibility rule is covered by the client test; this device check exercised the
same daemon request directly rather than clicking a canvas node.

The accompanying activity did not appear. A read-only D1 check found an eight-hour start
claim from the preceding test, no update token and a pending end. New runs were being
absorbed by that old claim. Version `3a217be9-9bdb-4a25-91f6-0e27194af22b` now expires
unconfirmed starts after the APNs delivery window, reclaims legacy long leases, and clears
obsolete pending state on a fresh start. All 24 push-routing tests passed, including
regressions for a lost start and an old end arriving during the next run. A three-minute
physical activity test follows; its visual result remains to be confirmed.

The activity appeared after the lease fix, but its initial count stayed at one. No update
token had reached Pulsar. Bas supplied a screenshot and rejected the large two-column
layout. The widget has been reduced to a status sentence, smaller machine caption and an
attention capsule only when needed. Zero-value metrics and the large brand heading are gone.

The app now starts its shared runtime from the application delegate, including launches
without a SwiftUI screen. Activity observers start immediately after local credential
restoration, before optional account/provider network refreshes. Known pinned machines
remain valid during restoration, token uploads hold background runtime and retry transient
failures. Worker version `941a67fd-6933-4e9c-a9d1-09f31babf941` is deployed at 100%; it gives
already-verified pending activity updates a fresh APNs delivery window while retaining
the original event timestamp, so late token registration can still end an old activity
without making older events override newer ones. The updated signed app is installed.

The final targeted backend run passed 189 tests, with one optional statement-key test
skipped. The latest native build passed. Physical count transitions and the compact layout
still need confirmation after this last installation.

Subsequent device reports still showed no activity. The recorded update token belonged
to an earlier round: an APNs success and an empty pending queue did not establish that
the current activity was visible. Invalid-token recovery alone was insufficient because
APNs could still accept that old token.

Migration `0011_activity_generations.sql` adds the work round's `startedAt` to both start
claims and update-token records. Worker `07fbe1c1-f0d7-4110-aa20-e19ea2676f29` is deployed
with existing variables preserved. A new machine round starts a new activity rather than
reusing the previous round's token. Token registration requires the matching claim, and
late registration, retirement or end messages from an older round cannot replace or remove
the current one. Legacy conversation subscriptions retain their previous protocol.

The matching iPhone build is installed. Its observers prefer the newest round, register
that round with the token and retain ended activities on the Lock Screen for the requested
dismissal interval. Validation passed: 194 backend tests, one optional test skipped, 43
Swift tests, repository formatting/type checks and the signed physical-device build.

A new ten-minute development test started at `1789550079768`. D1 confirmed the same value
for the start claim and update-token generation, with registration at `1789550081979` and
no queued update. This confirms a fresh registration rather than reuse of the old token.
Bas confirmed that this fresh round is visible on the iPhone. Count transitions and
acceptance of the compact design are being checked separately.


### Agent card layout

Bas confirmed the fresh activity and saw its attention icon/count update, but rejected the
compact sentence layout. The replacement follows the supplied 11:17 reference: a text-only
Ruimte header, machine caption, up to two agent rows and a footer. The compact Island says
`N running` or `Needs you`. There is no app icon. Attention rows show `Review`, which opens
the matching terminal or chat; it does not grant permission. Rows use the existing Lucide
icons and generic source labels rather than invented tool progress.

The daemon chooses active agents, prioritizes attention, and keeps total counts when more
than two agents are active. Agent titles, destinations and phases are part of the signed,
plaintext Live Activity content. Normal alerts and read receipts remain encrypted. Optional
rows preserve decoding of older machine summaries. Worker
`1151e4f2-9ae9-455e-a487-4cf31c77f698` is deployed with the expanded schema; no further
migration was required. The corresponding signed app is installed on the physical iPhone.

Validation: 113 targeted backend tests and 44 Swift tests passed, followed by a 31-test
Worker run that also checks delivery of agent rows and refusal of a changed session link.
The native build and repository checks passed. Visual acceptance and the physical Review
link are pending. Two disposable fixtures named `Refactor transport` and `Write tests`
exercise running and attention states without invoking an AI provider.


`devicectl device capture screenshot` exposed a blank Lock Screen card and clipped expanded
content. Constraining the linked rows to 40 points and bounding the footer width restored
both rows and the Review control in a physical screenshot. The Island header now occupies
its leading/trailing regions so the bottom region has room for the rows and footer. The
corresponding iPhone build is installed; final full-card and Review checks remain pending.

Repeated install tests also exposed a separate daemon lifecycle bug: session list changes
went only to connected clients, so the push observer could miss the last terminal being
killed and retain the old work-round start. `SessionManager` now sends list changes to its
observers too. A deterministic test over the real manager and fake PTY failed before this
fix (running instead of done), passes afterward, and proves a fresh start time for the next
terminal. All 45 session-manager/push-service tests pass. The production daemon was not
restarted. After the development reload, the physical iPhone registered generation
`1789551551395` with the same start and update-token generation and no pending update.


The first live retry still retained the previous registration after both fixtures stopped.
With no active development terminals or chats, the isolated development daemon was then
explicitly restarted on port 4211 with `RUIMTE_HOME=~/.ruimte-dev` to load the tested observer
change. Production remained running. The native rows were tightened again after a screenshot
showed the footer clipped by the Island's lower boundary.


The next `devicectl` screenshot verified the complete expanded layout: both named rows,
Review, the running/attention totals and the relative start time are visible without
clipping. The machine caption truncates within the Island's trailing header region. These
screenshots stay in `/tmp`; they include unrelated personal screen content and are not
repository assets. Lock Screen and Review-link checks follow separately.


Bas confirmed that Review opens the `Write tests` session. A second physical screenshot
verified the complete Lock Screen card, including both rows, the action and footer. Its
relative time could truncate after a few minutes, so the final build uses a fixed short
start time instead. The latest native build includes that final formatting change.

Both temporary agents and their test attention were cleared. After the explicit development
reload, a read-only D1 check now confirms zero development update-token records and zero
start claims after cleanup. There are no active development test terminals or chats. This
physically verifies the previously missing last-terminal-exit transition. The isolated
development daemon remains running; production was not restarted.


### Attention-only alerts (September 16, 2026)

The daemon now sends alert pushes only for attention and approval requests. Finishing a
turn no longer sends an alert or creates a notification-read entry. Live Activity updates
still include completion, for both terminal agents and AI chats. Existing read
synchronization stays in place for attention and approval notifications. Production
0.0.17 needs a daemon update to adopt this policy; the Worker needs no change.
