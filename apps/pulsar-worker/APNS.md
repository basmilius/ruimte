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

The directory has mode 700 and files have mode 600. Both were validated as P-256
private keys before the Downloads copies were removed. Local parsing cannot prove a
key's Apple-side permissions or environment scope. There is no off-machine backup.

Never commit key contents or include them in command arguments, logs or reports.
Cloudflare receives them as Worker secrets, separately from the nonsecret team and
topic configuration. Deploying with `--keep-vars` preserves the other provider
secrets on the shared Worker.

## The migrations this took

All of them are additive, so the Worker can roll back while they stay.

- `0006_push.sql`: devices and subscriptions.
- `0008_activity_target.sql`: the target a Live Activity belongs to.
- `0009_machine_activities.sql`: an optional device activity scope, so a client
  registers `scope: machines` once instead of following conversations.
- `0010_pending_activity_updates.sql`: the latest signed state while a push-started
  activity waits for its update token, an early end included. Registering the token
  flushes that state.
- `0011_activity_generations.sql`: the work round's `startedAt` on both start claims
  and update-token records.

## Read synchronization

The daemon keeps per-node notification timestamps and read watermarks in
`push-attention.json`. Desktop and web clients acknowledge what is actually visible in
a focused window through `push.read`, and a new turn acknowledges the previous result.
The Worker takes signed, encrypted `background` envelopes and forwards them as silent
APNs pushes with priority 5, under a collapse key of their own, so a read receipt can
never replace a pending notification for a newer turn. Only clients that advertise
`readSync` get one; a daemon or client from before this keeps the old behavior.
Connected clients get `push.attention` events, and iOS reconciles a snapshot when it
connects. A late acknowledgment cannot remove a newer notification. Signed payloads
keep node IDs and read timestamps away from Pulsar and APNs.

Apple schedules background pushes opportunistically, so immediate removal is not
guaranteed, least of all after a force quit or with Background App Refresh off.
Opening Ruimte and connecting to the machine reconciles what was missed. A service
extension cannot reliably suppress an alert that arrives after its read receipt while
the app is suspended; the persisted watermark keeps the badge from going unread again,
and foreground reconciliation removes the delivered alert. See
[Apple's background push guidance](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).

## Alerts

An alert push is sent for attention and approval requests only. A finished turn sends
none and creates no notification-read entry; it does update the Live Activity.

## Live Activities

One activity represents one machine. The daemon combines the terminal and chat states
of that machine into one signed overview.

A work round has a generation, its `startedAt`. A new round starts a new activity
instead of reusing the token of the previous one, token registration requires the
matching claim, and a late registration, retirement or end from an older round cannot
replace or remove the current one. An unconfirmed start expires after the APNs
delivery window, which is what keeps a stale claim from swallowing the next run.

The card carries a machine caption, up to two agent rows and a footer; the Dynamic
Island uses the same hierarchy. Working shows a blue dot with a white elapsed timer,
attention an orange one; with exactly one active session the compact Island shows that
session's terminal or chat icon, otherwise a loader or a circle-alert icon. Timers use
SwiftUI's system timer rendering, so counting up costs no pushes, and an unknown start
time is left out rather than borrowed from the machine. Attention and resuming the same
turn keep the turn's start; a new turn resets it.

An attention row offers `Review`, which opens the matching terminal or chat and grants
no permission. The daemon picks the active agents, puts attention first and keeps the
totals when more than two are active. Agent titles, destinations, phases and row
timestamps are part of the signed but plaintext activity content; alerts and read
receipts stay encrypted. Optional rows keep older machine summaries decodable.

## Open

Delivery to a production-signed app has never been tested. A sandbox test does not
establish it, so it needs a production-signed build and its device token.
