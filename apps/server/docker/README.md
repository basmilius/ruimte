# A remote daemon in Docker

A second daemon on Linux, in a container, so a client on this Mac has a machine that is not its own. It tests what only happens over the wire: a client let in on an account statement, the door on the local network, a direct channel over UDP, `lan` reachability, and foreign paths and shells. It keeps its state, so it doubles as a second machine to develop against.

The container holds a shell, git and bun, and no agent CLIs, so chat nodes and agent status are out of scope.

## Run

```sh
bun run --cwd apps/server docker:up        # build and start on 127.0.0.1:4310
bun run --cwd apps/server docker:login     # put it on your account with `ruimte login`
bun run --cwd apps/server docker:test      # the test suite, against a container of its own
bun run --cwd apps/server docker:down      # stop and remove it, its state kept
bun run --cwd apps/server docker:reset     # stop it and throw its state away
```

The daemon listens on `0.0.0.0:4310` inside the container, mapped to `127.0.0.1:4310` here. Nothing else on the network reaches it.

## Reaching it from the app

`docker:login` runs `ruimte login` inside the container. Approve the printed code on the web client, and the app lists the container under the account's machines.

The app reaches it through a broker. `RUIMTE_BROKER_URL` is the broker the container dials and `RUIMTE_BROKER_ADVERTISE_URL` the address a client here dials for it (`apps/pulsar-broker/README.md`). Both are `off` unless set when compose runs, so the container never announces itself to the public broker by accident. The door on the local network stays closed (`--no-lan`), since its addresses would be the container's own network. A direct channel's UDP comes in through `127.0.0.1:43100-43109`, announced with `--direct-host-address 127.0.0.1`.

## What is in there

The first start seeds two repositories:

| Path | What it holds |
| --- | --- |
| `/work/atlas` | Three commits, a `lighthouse` branch beside `main`, `README.md` changed and an untracked `notes.txt`. |
| `/work/beacon` | One commit, nothing outstanding. |

The image installs only `apps/server` and `packages/*` (`workspace-package.json`), so a daemon change rebuilds only the last layers.

## State that stays

| Volume | Mount | What is in it |
| --- | --- | --- |
| `ruimte-remote_home` | `/root/.ruimte` | The daemon's home: id and key pair, `local.key`, account and clients, projects, snapshots. |
| `ruimte-remote_work` | `/work` | The seeded repositories and anything else put there. |

Both are named volumes, not bind mounts, so the file system is the container's own. `docker:down` keeps them, so `docker:up` comes back as the same machine. Seeding skips a repository that exists. `docker:reset` removes both volumes: the next start mints a new id and key pair, is on no account, and seeds `/work` again.

## Tests

`docker:test` runs `src/docker/remote-daemon.integration.test.ts` against `daemon-test`, a second service from the same image on `127.0.0.1:4320` (`ruimte-remote-test`). It has no volumes, starts fresh every time (`RUIMTE_FRESH_STATE=1`) and is recreated around every run, so the container on 4310 is untouched.

`test.sh` makes an ed25519 key per run, which the test container accepts in place of the address book's (`RUIMTE_PULSAR_TEST_STATEMENT_KEY`, read only by a daemon from source). Compose publishes its door on `127.0.0.1:4330` and its UDP range on `43200-43209`. The suite runs a broker on port 4420, which the container dials at `host.docker.internal`.

Every client of the suite comes from Docker's gateway, and the door allows one address 30 sockets a minute, so a test that opens many channels in a row has to stay under that.

Inside the image `ruimte-context` is called by its path, since Debian's `/etc/profile` rewrites PATH in a login shell.

The suite skips itself unless `RUIMTE_DOCKER=1` is set, so `bun test` and CI never reach for a container. `RUIMTE_DOCKER_CONTAINER` and `RUIMTE_DOCKER_PORT` point it at another container started the same way, at the cost of that daemon's state.
