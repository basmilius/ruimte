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

The code and local keys are ready. The cloud upload was rejected by automatic approval
review because transferring these private keys to Cloudflare needs explicit user
permission. Nothing was uploaded or activated. After permission, use a private,
temporary secrets file with `wrangler versions upload --secrets-file ... --keep-vars`
to stage code and both pairs together, then remove the temporary file. That command
creates an inactive version and preserves existing secrets. See
[Cloudflare's secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

Before activating that version, apply pending Worker migrations, including
`0008_activity_target.sql`. Broker and TURN do not need these private keys or a restart.
The running daemon's new iOS functionality still needs a separately coordinated restart.

29 focused Worker/server push tests and `bun run check` pass. Tests verify key selection,
JWT signatures, interleaved environment requests, rotation, missing credentials and
independent device registrations. They use generated fixture keys. Real APNs delivery
and Live Activity behavior on the iPhone remain unverified.
