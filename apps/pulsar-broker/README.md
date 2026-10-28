# @ruimte/pulsar-broker

The broker behind remote access: a Bun WebSocket server that brings a client and a machine together without either reaching the other's address. A peer announces its ed25519 public key and signs the broker's nonce over `brokerHelloMessage` from `@ruimte/pulsar`. The broker then relays signals between keys with the sender filled in. It has no database, accounts or disk state, and passes the envelope on as written after checking that it parses. The receiver verifies the sender's signature.

Once offer and answer have crossed, client and machine talk over their own DataChannel. Stopping the broker drops no open connection.

## Run

```sh
bun run --cwd apps/pulsar-broker start                 # ws://127.0.0.1:4400
bun apps/pulsar-broker/src/main.ts --port 4500 --name broker.example.com --trust-proxy
```

`GET /health` answers `{ "status": "ok", "sockets": n, "machines": n, "clients": n }`. A WebSocket upgrade on any other path is a peer.

Every flag also reads `PULSAR_BROKER_` plus the flag in upper snake case (`--key-relays-per-minute` is `PULSAR_BROKER_KEY_RELAYS_PER_MINUTE`). A flag wins over the variable.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface to listen on |
| `--port` | `4400` | Port for peers and `/health` |
| `--name <host>` | none | Host name the broker answers to and signs into its challenge. Repeatable (`PULSAR_BROKER_NAMES`, comma-separated). Without one the `Host` header is believed |
| `--trust-proxy` | off | Count limits against the last `X-Forwarded-For` entry, for a loopback socket only (Caddy on the same host) |
| `--trust-cloudflare` | off | Count limits against `CF-Connecting-IP`, only from Cloudflare's published ranges (the socket, or the last `X-Forwarded-For` entry with `--trust-proxy`) |
| `--max-message-bytes` | `65536` | A larger frame closes the socket |
| `--max-sockets-per-ip` | `32` | Open sockets per address; the next upgrade gets 429 |
| `--ip-connections-per-minute` | `30` | Upgrades per address per minute; the next gets 429 with `Retry-After` |
| `--ip-frames-per-second` | `20` | Frames per address per second; an extra frame gets `rate-limited` and is dropped unread |
| `--key-relays-per-minute` | `60` | Relays per key per minute; an extra gets `rate-limited` with its id |
| `--key-announces-per-minute` | `10` | Proven announcements per key per minute; an extra gets `rate-limited` and a closed socket, and the holding socket stays. A hello never counts |
| `--heartbeat-seconds` | `25` | Ping interval; two missed heartbeats drop the socket. At most 40, since a daemon gives up after 90 seconds of silence |
| `--hello-timeout-seconds` | `10` | Time from open to a verified signature |
| `--key-ice-per-minute` | `10` | `ice` questions per key per minute; an extra gets `rate-limited` with its id |
| `--ip-ice-per-minute` | `30` | `ice` questions per address per minute, over every key behind it |
| `--ice-per-minute` | `120` | `ice` questions per minute overall, so many addresses cannot outpace coturn's quota; an extra gets `rate-limited` (scope `ip`), logged once a minute |
| `--turn` | `none` | TURN credential source: `none`, `shared-secret` or `cloudflare` |
| `--turn-secret-file` | none | With `shared-secret`: the file with coturn's `static-auth-secret`, read on every question |
| `--turn-url` | none | With `shared-secret`: a `turn:` or `turns:` URL to hand out. Repeatable (`PULSAR_BROKER_TURN_URLS`, comma-separated) |
| `--turn-ttl-seconds` | `3600` | Credential lifetime, 60 seconds to a week. A daemon asks again at two thirds |
| `--cloudflare-turn-key-id` | none | With `cloudflare`: the TURN key id |
| `--cloudflare-turn-token-file` | none | With `cloudflare`: a file with that key's API token |

A bucket fills to its limit and refills evenly over its window, so a limit is also the burst. An IPv6 address counts by its /64.

### Why a name

A peer compares the host in the challenge with the host it dialed. With `--name` set, a service in the middle that dials under its own `Host` gets a 421 instead of a challenge, so it cannot replay this broker's nonce. Without a name the header is believed, which is fine on a laptop and not on a public host.

A daemon on the broker's own host that dials `ws://127.0.0.1:4400` sends `Host: 127.0.0.1:4400` and gets a 421 too. Add `--name 127.0.0.1:4400` beside the public name, or let the daemon dial the public `wss://` URL.

## Wire

One JSON frame per WebSocket message, shapes in `packages/pulsar/src/broker.ts`:

1. peer `hello { role, publicKey }`, broker `challenge { broker, nonce }`
2. peer `prove { signature }` over `brokerHelloMessage(broker, role, publicKey, nonce)`, broker `ready`
3. peer `relay { id, to, envelope, signature }`, broker `delivered { id }` to the sender and `relayed { from, envelope, signature }` to the receiver, or `error not-connected` with the id
4. peer `ice { id }`, broker `ice { id, servers, expiresAt }` (no servers without TURN), `rate-limited` or `error internal` with the id

A machine relays only to clients and a client only to machines. A second announcement of a key replaces the first socket, which hears `error replaced`.

| Close code | Reason |
| --- | --- |
| 4002 | Bad frame before `ready` |
| 4003 | Bad signature |
| 4008 | Hello timeout or missed heartbeat |
| 4009 | Replaced |
| 4029 | Announcing too often |
| 1006, 1009 | Frame over the size cap |

`BrokerPeer` in `@ruimte/pulsar` is the peer's side without a socket. The daemon (`apps/server/src/pulsar/broker-relay.ts`), the client (`apps/client/src/transport/broker-signaling.ts`) and the tests wrap a socket around it.

## Try it against the Docker container

The container on `127.0.0.1:4310` (`apps/server/docker`) reaches this machine as `host.docker.internal`. `--broker-advertise` is the URL the daemon hands clients in `endpoint.info`.

1. Start the broker and leave it running: `bun run --cwd apps/pulsar-broker start`.
2. Recreate the container with the broker URL (the home volume keeps the account):

    ```sh
    RUIMTE_BROKER_URL=ws://host.docker.internal:4400 RUIMTE_BROKER_ADVERTISE_URL=ws://127.0.0.1:4400 bun run --cwd apps/server docker:up
    ```

    `docker logs ruimte-remote` says `Announced to the broker at ws://host.docker.internal:4400`, and `curl -s http://127.0.0.1:4400/health` counts one machine.
3. If the container is not on your account yet, `bun run --cwd apps/server docker:login` prints a code to approve. Start `bun dev` signed in to the same account; `docker-linux` appears under Settings, Machines.
4. Open it. The container's local door is closed, so its row says "Via broker". Open a terminal and type.
5. Stop the broker with Ctrl+C. The terminal keeps working.
6. With the broker still stopped, restart the dev app. The row says `The broker at 127.0.0.1:4400 could not be reached`. Start the broker and the next retry connects.

To go back, stop the broker and run `bun run --cwd apps/server docker:up` without the two variables.

## Deploy on the VPS

Nothing deploys itself. `deploy/pulsar-broker.service` and `deploy/Caddyfile` target a small Linux VPS (1 vCPU, 2 GB), with the broker on loopback and Caddy in front for TLS. Replace `broker.ruimte.app` in both with your name.

1. Point the name's A and AAAA records at the VPS and open ports 80 and 443 (Caddy needs 80 for the certificate).
2. Install Bun to `/usr/local/bin/bun` and Caddy from its package repository.
3. Create the user and checkout:

    ```sh
    sudo useradd --system --home /opt/ruimte --shell /usr/sbin/nologin pulsar
    sudo git clone https://github.com/basmilius/ruimte /opt/ruimte
    cd /opt/ruimte && sudo bun install --production --filter @ruimte/pulsar-broker
    sudo chown -R pulsar:pulsar /opt/ruimte
    ```

4. Install the service and the Caddyfile:

    ```sh
    sudo cp apps/pulsar-broker/deploy/pulsar-broker.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now pulsar-broker
    sudo cp apps/pulsar-broker/deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
    ```

5. Check `curl -s https://broker.ruimte.app/health`, and `journalctl -u pulsar-broker -f` for the log.
6. A daemon uses `wss://broker.ruimte.app` without a flag. For another name, start it with `--broker wss://<name>` (or `RUIMTE_BROKER_URL`), or set a custom broker under Settings, Machines. A daemon on the same host that dials loopback needs the second `--name` (see "Why a name").

With `--telemetry` (or `PULSAR_BROKER_TELEMETRY=1`), as in the unit, the broker sends errors and log lines to Observatory (the broker app of product Ruimte) through `@sentry/bun` (`src/telemetry.ts`), with release `broker@<12 hex>` of the checkout. Events keep only the allow-list of `@ruimte/telemetry`, and log lines their first line and scalar attributes, scrubbed. No peer address or host name leaves. Without the flag nothing is sent.

The unit raises the descriptor limit to 65536, one socket per online machine. To update, run `git pull`, `bun install` and `sudo systemctl restart pulsar-broker`. A restart drops every socket. Daemons return within their backoff (at most 30 seconds, with jitter), and open channels are unaffected.

## TURN

When ICE cannot make a direct pair, a TURN relay carries the connection. The broker hands out TURN REST credentials (`use-auth-secret`) bound to the asking key in its `ice` frame, valid for an hour. ICE still prefers a direct pair. Nothing changes until `--turn` is set.

To run coturn on the broker's host:

1. Point a DNS-only name at the host (`turn.ruimte.app`, no Cloudflare proxy, since it carries UDP) and open UDP and TCP 3478, TCP 5349 and UDP 49152 to 49999.
2. Install coturn and create one secret for coturn and the broker:

    ```sh
    sudo groupadd --system ruimte-turn
    sudo install -d -m 0750 -o root -g ruimte-turn /etc/ruimte
    sudo sh -c 'umask 027; openssl rand -base64 48 > /etc/ruimte/turn-secret'
    sudo chgrp ruimte-turn /etc/ruimte/turn-secret
    ```

3. Copy `deploy/turnserver.conf` to `/etc/coturn/turnserver.conf` with `PUBLIC_IP` replaced by the host's address, and `deploy/coturn.service.d/ruimte.conf` to `/etc/systemd/system/coturn.service.d/`. The drop-in writes the secret into a runtime copy of the config, so it never shows in the process list.
4. For TLS on 5349, put a certificate at `/etc/coturn/certs/turn.ruimte.app.crt` and `.key`, readable by the `turnserver` user. Without one coturn starts without TLS.
5. Run `sudo systemctl daemon-reload && sudo systemctl enable --now coturn`. Copy `deploy/pulsar-broker.service.d/turn.conf` to `/etc/systemd/system/pulsar-broker.service.d/` (add the `turns:` URL once the certificate is there) and restart the broker.
6. On the host, `turnutils_uclient -u <username> -w <password> -e 1.1.1.1 127.0.0.1` with a credential from an `ice` frame gets an allocation, and `journalctl -u coturn` logs it.

The config refuses private, loopback, link-local, CGNAT and multicast peers and the host's own address, so the relay reaches nothing behind it. It also refuses two peers both relayed on this host; `allowed-peer-ip=<address>` after the deny list allows that. `bps-capacity` counts allocations more than traffic, since coturn reserves `max-bps` per allocation.

For Cloudflare's TURN service instead, create a TURN key, put its API token in a file only the broker reads, and start the broker with `--turn cloudflare --cloudflare-turn-key-id <id> --cloudflare-turn-token-file <file>`. With the default hour, the broker asks the API once every forty minutes.

`apps/server/scripts/webrtc-probe.ts` takes `--turn <url> --turn-user <u> --turn-pass <p>` and `--relay-only` to try the relay between two machines.

## Behind Cloudflare's proxy

Only signaling crosses the broker, so it can sit behind Cloudflare's proxy without costing bandwidth.

- Start the broker with `--trust-cloudflare` (the unit does), so limits count against `CF-Connecting-IP`. The header is believed only from the ranges in `src/cloudflare.ts`. Refresh that list from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 when Cloudflare announces a change.
- Cloudflare closes a WebSocket idle for 100 seconds. The 25-second ping prevents that (`--heartbeat-seconds` stops at 40). A socket reset during Cloudflare's deploys reconnects with the backoff, and open channels do not notice.
- Open ports 80 and 443 only to Cloudflare's ranges, for example one ufw rule per range. `trusted_proxies` in `deploy/Caddyfile` lists the same ranges. Caddy 2.6.2 refuses that option; on so old a Caddy leave the global block out. If the HTTP challenge on port 80 fails, use a Cloudflare Origin CA certificate in the site block (`tls /etc/caddy/origin.pem /etc/caddy/origin.key`) or a Caddy build with the Cloudflare DNS module. Keep the zone's SSL mode on Full (strict).
