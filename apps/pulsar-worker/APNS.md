# APNs on the shared Pulsar Worker

Development and production devices share one Worker and database. The registered APNs environment picks the Apple endpoint and the credential pair, nothing else.

| Device environment | Private-key secret | Key-ID secret | Current key ID |
| --- | --- | --- | --- |
| `sandbox` | `APNS_SANDBOX_KEY` | `APNS_SANDBOX_KEY_ID` | `Q39B5735J7` |
| `production` | `APNS_PRODUCTION_KEY` | `APNS_PRODUCTION_KEY_ID` | `9X8N3H3LXC` |

`APNS_TEAM_ID=7RGV9KKX87` and `APNS_TOPIC=app.ruimte.mobile` live in `wrangler.jsonc`. Alerts and Live Activities use the same key.

Missing credentials make registration and delivery for that environment fail with HTTP 503. The Worker never falls back to the other key. A device record is unique per account session and environment, so a production registration leaves its sandbox twin alone.

## Local custody

The key files live on Bas's Mac in `~/.private/ruimte/apns/` (`AuthKey_Q39B5735J7.p8`, `AuthKey_9X8N3H3LXC.p8`), directory mode 700, files mode 600. There is no off-machine backup.

Never commit key contents or put them in command arguments, logs or reports. Cloudflare gets them as Worker secrets. Deploy with `--keep-vars` so the other provider secrets on the Worker survive.

## What the Worker relays

The daemon decides every alert, read receipt and Live Activity update (`apps/server/README.md#push-notifications`). The Worker checks the account and signature and relays.

- A read receipt is a silent push, priority 5, under its own collapse key, so it never replaces a pending alert.
- An automatic Live Activity accepts only the fixed machine-summary collapse ID. A token registration must match the work round that started the activity.
- Live Activity requests append `.push-type.liveactivity` to the topic.

Each environment has one provider token, kept in `apns_provider_tokens` for 50 minutes, because APNs answers `429 TooManyProviderTokenUpdates` when the token changes more than once in 20 minutes. While D1 does not answer, an isolate signs its own token.

## Open

Delivery to a production-signed app has never been tested. The check is in [`docs/ACCEPTANCE.md`](../../docs/ACCEPTANCE.md#push-notifications).
