# @ruimte/pulsar-broker

The broker from remote access (`docs/reports/2026-09-11-remote-access.html`, phase 4): a Bun WebSocket
server that brings a client and a machine together without either reaching the other's address. A peer
announces its ed25519 public key, signs the broker's nonce over `brokerHelloMessage` from
`@ruimte/pulsar`, and is then held in a `Map` from key to socket. A signal for another key is written to
that key's socket with the sender filled in, and that is all the broker does: no database, no accounts,
nothing on disk, and it never checks or reads the envelope it passes on. The receiver verifies the
sender's signature, since the receiver is the one a lying broker would be lying to.

Once the offer and the answer have crossed, client and machine talk over their own DataChannel and the
broker is out of the picture: stopping it drops no connection that is already open.

## Run

```sh
bun run --cwd apps/pulsar-broker start                 # ws://127.0.0.1:4400
bun apps/pulsar-broker/src/main.ts --port 4500 --name broker.example.com --trust-proxy
```

`GET /health` answers `{ "status": "ok", "sockets": n, "machines": n, "clients": n }`. A WebSocket upgrade on
any other path is a peer.

Every flag also reads an environment variable, `PULSAR_BROKER_` plus the flag in upper snake case
(`--key-relays-per-minute` is `PULSAR_BROKER_KEY_RELAYS_PER_MINUTE`); a flag wins over the variable.

| Flag                          | Default     | Meaning                                                                                                                                                                                                                                     |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--host`                      | `127.0.0.1` | Interface to listen on.                                                                                                                                                                                                                     |
| `--port`                      | `4400`      | Port for the peers and `/health`.                                                                                                                                                                                                           |
| `--name <host>`               | none        | A host name the broker answers to and signs into its challenge. Repeatable (`PULSAR_BROKER_NAMES` takes a comma-separated list). Without one the `Host` header is taken as it is.                                                           |
| `--trust-proxy`               | off         | Count limits against the last `X-Forwarded-For` entry, for a socket from loopback only. For a broker behind Caddy on the same host.                                                                                                         |
| `--trust-cloudflare`          | off         | Count limits against `CF-Connecting-IP`, but only when the connection came from one of Cloudflare's published ranges (the socket itself, or the last `X-Forwarded-For` entry with `--trust-proxy`). For a broker behind Cloudflare's proxy. |
| `--max-message-bytes`         | `65536`     | A frame larger than this closes the socket.                                                                                                                                                                                                 |
| `--max-sockets-per-ip`        | `32`        | Open sockets one address may hold; the next upgrade gets a 429.                                                                                                                                                                             |
| `--ip-connections-per-minute` | `30`        | Upgrades per address per minute; the next gets a 429 with `Retry-After`.                                                                                                                                                                    |
| `--ip-frames-per-second`      | `20`        | Frames per address per second; a frame over it gets `rate-limited` and is dropped unread.                                                                                                                                                   |
| `--key-relays-per-minute`     | `60`        | Relays per key per minute; a relay over it gets `rate-limited` with its id.                                                                                                                                                                 |
| `--key-announces-per-minute`  | `10`        | Announcements per key per minute; one over it gets `rate-limited` and a closed socket, and the socket that already holds the key stays.                                                                                                     |
| `--heartbeat-seconds`         | `25`        | A ping this often; a socket that answers nothing for two heartbeats is dropped. At most 40, because a daemon gives up on a broker it has not heard from in 90 seconds.                                                                      |
| `--hello-timeout-seconds`     | `10`        | Time from open to a verified signature.                                                                                                                                                                                                     |

A bucket fills to its limit and refills evenly over its window, so the limits are also the bursts.

### Why a name

A peer compares the host in the challenge with the host it dialed, and the broker verifies the answer
against the name it put in the challenge. With `--name` set, a service in the middle that dials this
broker under its own `Host` gets no challenge at all (421), so it cannot hand a peer this broker's nonce
and announce that peer's key here. Without a name the header is believed, which is fine on a laptop and
not on a public host.

The same check applies to a daemon on the broker's own host. With `--name broker.example.com` set, a
daemon there that dials `ws://127.0.0.1:4400` sends `Host: 127.0.0.1:4400` and gets a 421. Either give
the broker a second name for that, `--name 127.0.0.1:4400` beside the public one, or let the daemon dial
the public `wss://` URL like every other machine.

## Wire

One JSON frame per WebSocket message, all shapes in `packages/pulsar/src/broker.ts`:

1. peer `hello { role, publicKey }`, broker `challenge { broker, nonce }`
2. peer `prove { signature }` over `brokerHelloMessage(broker, role, publicKey, nonce)`, broker `ready`
3. peer `relay { id, to, envelope, signature }`, broker `delivered { id }` to the sender and
   `relayed { from, envelope, signature }` to the receiver, or `error not-connected` with the id

A machine relays to clients and a client to machines; a relay to the same role is `not-connected`. A
second announcement of a key replaces the first socket, which hears `error replaced` and is closed with 4009. The close codes: 4002 a bad frame before `ready`, 4003 a bad signature, 4008 a hello timeout or a
missed heartbeat, 4009 replaced, 4029 announcing too often, and 1006 or 1009 for a frame over the size cap.

`BrokerPeer` in `@ruimte/pulsar` is the peer's side of this without a socket; the daemon
(`apps/server/src/pulsar/broker-relay.ts`), the client (`apps/client/src/transport/broker-signaling.ts`)
and the tests wrap their own socket around it.

## Try it against the Docker container

The container on `127.0.0.1:4310` (`apps/server/docker`) reaches this machine as `host.docker.internal`,
so it dials the broker under that name while a client here dials `127.0.0.1`. `--broker-advertise` is the
URL the daemon hands clients in its pairing answer and in `endpoint.info`.

1. Start the broker on this machine and leave it running:

    ```sh
    bun run --cwd apps/pulsar-broker start
    ```

2. Recreate the container with the broker URL. The home volume keeps its pairings:

    ```sh
    RUIMTE_BROKER_URL=ws://host.docker.internal:4400 RUIMTE_BROKER_ADVERTISE_URL=ws://127.0.0.1:4400 bun run --cwd apps/server docker:up
    ```

    `docker logs ruimte-remote` says `Announced to the broker at ws://host.docker.internal:4400`, and
    `curl -s http://127.0.0.1:4400/health` counts one machine.

3. Start the Electron dev app with `bun dev`. If `docker-linux` is not under Settings, Machines yet,
   pair it: `bun run --cwd apps/server docker:pair` prints a link to paste there. A machine that was
   paired before learns the broker URL the next time it connects.

4. Turn Direct on for `docker-linux`. The machine reconnects over WebRTC with the offer and the answer
   going through the broker; the tooltip on its status dot says "Direct connection through the broker".
   Open a terminal on it and type something.

5. Stop the broker with Ctrl+C. The terminal keeps working: the channel does not run through it.

6. To see that the signals really went over the broker: with the broker still stopped, turn Direct off
   and on again. The row says `The broker at 127.0.0.1:4400 could not be reached` instead of connecting
   over port 4310. Start the broker again and the next retry comes up.

To go back, stop the broker and run `bun run --cwd apps/server docker:up` without the two variables,
which recreates the container with the broker off.

## Deploy on the VPS

Nothing here deploys itself. `deploy/pulsar-broker.service` and `deploy/Caddyfile` are for a small Linux
VPS as the report describes (1 vCPU, 2 GB), with the broker on loopback and Caddy in front for TLS.
Replace `broker.ruimte.app` in both with the name you use.

1. Point the name's A and AAAA records at the VPS, and open ports 80 and 443 (Caddy needs 80 for the
   certificate).
2. Install Bun to `/usr/local/bin/bun` and Caddy from its package repository.
3. Create the user and put a checkout in place:

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

5. Check it: `curl -s https://broker.ruimte.app/health`, and `journalctl -u pulsar-broker -f` for the log.
6. A daemon is on `wss://broker.ruimte.app` without any flag. For another name, start it with
   `--broker wss://<name>` (or `RUIMTE_BROKER_URL`), or pick a custom broker for the machine under
   Settings, Machines. A daemon on the same host that dials the broker on loopback needs the second
   `--name` from "Why a name".

The unit raises the descriptor limit to 65536, since every machine that is online holds one socket. To
update: `git pull`, `bun install`, `sudo systemctl restart pulsar-broker`. A restart drops every socket;
the daemons come back within their backoff (at most 30 seconds, with jitter), and open channels are not
affected.

## Behind Cloudflare's proxy

Only signaling crosses the broker, and the channel itself goes direct, so the broker can sit behind
Cloudflare's proxy (the orange cloud) at no cost in bandwidth. Three things change.

- **The client address.** Every socket now comes from a Cloudflare edge, and Caddy's `X-Forwarded-For`
  names that edge. Start the broker with `--trust-cloudflare` (the unit does) so the limits count
  against `CF-Connecting-IP`. The header is believed only when the connection came from one of the
  ranges in `src/cloudflare.ts`, so a client that reaches the origin directly cannot pick its own bucket.
  Refresh that list from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 when
  Cloudflare announces a change.
- **Idle sockets.** Cloudflare closes a WebSocket that carried nothing for 100 seconds. The broker pings
  every 25 seconds (`--heartbeat-seconds` stops at 40), so none is idle that long. Cloudflare can still
  reset a long-lived socket during its own deploys; a daemon reconnects with its backoff and a client
  tries again on its next attempt, and an open channel does not notice.
- **The origin.** Open ports 80 and 443 only to Cloudflare's ranges, for example with ufw, one rule per
  range from the two lists above. Caddy's `trusted_proxies` in `deploy/Caddyfile` lists the same ranges,
  so its logs and `{client_ip}` name the client. Caddy 2.6.2 does not know the option and refuses the file;
  on a Caddy that old leave the global block out, since the broker reads the header on its own. Caddy gets its certificate with the HTTP challenge on
  port 80, which passed the proxy on a zone that redirects HTTP to HTTPS. If the challenge fails, use a
  Cloudflare Origin CA certificate in the site block (`tls /etc/caddy/origin.pem /etc/caddy/origin.key`),
  or a Caddy build with the Cloudflare DNS module and an API token that may edit the zone's DNS. Keep
  the zone's SSL mode on Full (strict) either way.
