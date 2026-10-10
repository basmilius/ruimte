# A remote daemon in Docker

A second daemon, on Linux, in a container, so a client on this Mac has a machine to reach that is not
its own. It is a test rig for everything that only happens over the wire: a client let in on a
statement from the account, the door on the local network, a direct channel over UDP, a `lan`
reachability, and paths and a shell that are not this machine's. It is also a second machine to
develop against, which is why it keeps what is put on it.

The container holds a shell, git and bun, and nothing else. No Claude Code, no Codex, so chat nodes
and agent status are out of scope here.

## Run

```sh
bun run --cwd apps/server docker:up        # build and start on 127.0.0.1:4310
bun run --cwd apps/server docker:login     # put it on your account with `ruimte login`
bun run --cwd apps/server docker:test      # the test suite, against a container of its own
bun run --cwd apps/server docker:down      # stop and remove it, its state kept
bun run --cwd apps/server docker:reset     # stop it and throw its state away
```

The daemon listens on `0.0.0.0:4310` inside the container and the port is mapped straight through
to `127.0.0.1:4310` on this machine, next to the local daemon on 4210. Nothing else on the network
reaches it. The app does not connect to that port; it reaches the container through a broker.

## Reaching it from the app

Pairing links are gone: a client gets in on a statement from the account the machine is on.
`docker:login` runs `ruimte login` inside the container, which prints a code to approve on the web
client and puts the container on that account. The app then lists it under the account's machines.

The app reaches it through a broker, so start the container with one: `RUIMTE_BROKER_URL` is the
broker the container dials and `RUIMTE_BROKER_ADVERTISE_URL` the address a client on this machine is
told to dial for the same broker (`apps/pulsar-broker/README.md`). Both are off unless set when
compose runs. The door on the local network stays closed on this container (`--no-lan`): the
addresses it would report are those of the container's own network, which the app on this machine
cannot dial. A direct channel's UDP still comes in through `127.0.0.1:43100-43109`, the ports the
container announces with `--direct-host-address 127.0.0.1`.

## What is in there

The first start seeds two repositories under `/work`:

| Path           | What it holds                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `/work/atlas`  | Three commits, a `lighthouse` branch next to `main`, `README.md` changed and an untracked `notes.txt`. |
| `/work/beacon` | One commit, nothing outstanding.                                                                       |

The image installs a workspace of `apps/server` and `packages/*` only (`workspace-package.json`);
the client and the desktop shell would drag vite and electron into every rebuild for nothing. The
sources are copied in and run with `bun`, so a change to the daemon is a rebuild of the last layers.

## State that stays

The container is a second machine to develop against, so it keeps what is put on it. Two named
volumes hold everything that is not the image:

| Volume | Mount | What is in it |
| --- | --- | --- |
| `ruimte-remote_home` | `/root/.ruimte` | `endpoint.json` (the daemon's id and key pair), `local.key`, `auth.json` (the account it is on and the clients a statement let in), `projects.json`, the session snapshots. |
| `ruimte-remote_work` | `/work` | The seeded repositories and anything else put there. |

Named volumes and not a bind mount on purpose: the file system has to be the container's own. A
mount of this machine would hand the second daemon this machine's paths, permissions and checkouts,
which is the one thing this rig is built to avoid.

`docker:down` stops and removes the container and leaves both volumes, so `docker:up` comes back to
the same machine: the same daemon id, the same account, the same clients, the same projects, the same
repositories. Seeding is per repository, so the first start writes `atlas` and `beacon` and later
starts leave `/work` alone, including whatever is put there by hand.

`docker:reset` is the way back to nothing. It removes the container and both volumes, so the next
`docker:up` mints a new daemon id and a new key pair (it is on no account, so `docker:login` again),
starts with no projects and no sessions, and seeds `/work` from scratch. Everything put in `/work` by
hand is gone with it.

## Tests

The suite counts what a daemon lists: no projects on a fresh one, exactly `atlas` and `beacon` under
`/work`, `atlas` with the outstanding work the seed left in it. None of that holds on a machine that
has been worked on, so `docker:test` runs it against `daemon-test`, a second service from the same
image on 127.0.0.1:4320 under the name `ruimte-remote-test`. It carries no volumes, throws `/work`
and `$RUIMTE_HOME` away on every start (`RUIMTE_FRESH_STATE=1`, the only thing that flag is for) and
is recreated and removed around every run. The container on 4310 is untouched, and it can stay up
while the suite runs.

`test.sh` makes an ed25519 key per run. The test container believes statements signed with it in
place of the address book's (`RUIMTE_PULSAR_TEST_STATEMENT_KEY`, which a daemon from source reads
and a compiled one never does), and the suite signs with the private half. Compose publishes the
door of the test container on `127.0.0.1:4330` (its port 4320 plus 10) and its UDP range on
`43200-43209`. A client of the suite is what the app is on another machine: a new key, a statement v2
that names the container's id and key and an account, an offer through the door, and a DataChannel
whose handshake hands out a ticket. Most tests open a socket on 4320 with that ticket; the owner
reads `local.key` out of the container and opens one with the local secret.

`apps/server/src/docker/remote-daemon.integration.test.ts` walks the wire in blocks:

- A client let in on a statement: `/health`, `server.hello` and `endpoint.info` (Linux, `lan`,
  authenticated), the daemon's id kept in `endpoint.json`, the pairing routes answering 410 and
  `auth.pairingToken` answering `pairing-removed` for the owner and the client alike, loopback
  without the local secret getting through no door, `project.list` on a fresh daemon answering
  nothing and making nothing, projects opened, closed and kept open by another client, a terminal
  that answers `uname -s`, `git.status` on the outstanding work and `fs.browse` on `/work`.
- What such a client may not do: put the machine on an account or take it off
  (`endpoint.signRegistration`, `endpoint.leaveAccount`), hear which account it is on, or read the
  machine's own state under its home by request or by URL; and once the owner revokes it, its socket
  closes and neither its key nor a new statement for it gets back in.
- The door: `endpoint.info` says where it listens, anything but `/signal` answers 404, a key without
  a statement gets a `not-paired` the machine signed, and `ruimte status` inside the container exits 0
  and names the door.
- A direct channel through the door: a terminal over it, the bytes of a file in pieces with what the
  route refuses refused, a paused machine noticed by the ping, and a channel proved by an unknown key
  or by no proof refused.
- Two daemons at once, which is what the client's transport pool holds: a plain daemon on this
  machine (its own `RUIMTE_HOME`, `--no-hooks`, `--no-lan`, port 4311) next to the container, a shell
  on each, then the container stopped while the daemon here keeps answering and streaming. It starts
  the container again afterwards, and a start of the test container is a new machine again, which
  lets a client in on a new statement.
- State that belongs to one machine: the same node id on both daemons is two shells with two
  screens, one absolute path is two checkouts whose watches do not touch each other, `fs.list` on
  that path answers about the machine it was asked of, and context set on a session of the container
  is read back from inside that session.
- A project on each machine at once: each saves its own canvas into its own `project.json`, neither
  list holds the other's project, each browses its own file system and checkout, the bytes of an
  image come from the daemon of the workspace that draws it (the container refuses the same URL
  without its ticket), and the container going down leaves the other project saving. That last test
  stops the container; it is started again in the block's teardown, so a failure never leaves it down.
- The broker: the suite runs one on this machine on port 4420 and the test container dials it at
  `host.docker.internal`. A key nobody let in gets a signed `not-paired`, a signal its key did not
  sign gets nothing, a key the door let in opens a channel through the broker alone with no
  statement, and the channel outlives the broker. A last block carries statements through the broker
  instead of the door: a good one opens a terminal, and none, one for another key, one that ran out,
  one for another machine or another machine key, and one that names no account all get
  `not-paired`.

The door lets one address open 30 sockets a minute, and every client of the suite comes from the
same address, Docker's gateway. The suite stays well under that; a test that opens many channels in
a row has to as well.

`ruimte-context` is reached by its path in the image there, not by its name. Debian's `/etc/profile`
writes PATH from scratch, so the directory the daemon puts in front of it is gone by the first
prompt of a login shell; on macOS `path_helper` keeps what was already there.

The suite skips itself unless `RUIMTE_DOCKER=1` is set, so `bun test` at the root, and CI, never
tries to reach a container. It needs a container that believes this run's statement key, which
`docker:test` arranges; `RUIMTE_DOCKER_CONTAINER` and `RUIMTE_DOCKER_PORT` point it at another one
started the same way, which costs that daemon's state.
