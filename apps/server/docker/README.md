# A remote daemon in Docker

A second daemon, on Linux, in a container, so a client on this Mac can pair with a machine that is
not its own. It is a test rig for everything that only happens over the wire: pairing, a session
token on the socket, a `lan` reachability, paths and a shell that are not this machine's, and it is
a second machine to develop against, which is why it keeps what is put on it.

The container holds a shell, git and bun, and nothing else. No Claude Code, no Codex, so chat nodes
and agent status are out of scope here.

## Run

```sh
bun run --cwd apps/server docker:up        # build and start on 127.0.0.1:4310
bun run --cwd apps/server docker:pair      # a pairing URL to paste into the app
bun run --cwd apps/server docker:test      # the test suite, against a container of its own
bun run --cwd apps/server docker:down      # stop and remove it, its state kept
bun run --cwd apps/server docker:reset     # stop it and throw its state away
```

The daemon listens on `0.0.0.0:4310` inside the container and the port is mapped straight through
to `127.0.0.1:4310` on this machine, next to the local daemon on 4210. Nothing else on the network
reaches it.

## What is in there

The first start seeds two repositories under `/work`:

| Path | What it holds |
| --- | --- |
| `/work/atlas` | Three commits, a `lighthouse` branch next to `main`, `README.md` changed and an untracked `notes.txt`. |
| `/work/beacon` | One commit, nothing outstanding. |

The image installs a workspace of `apps/server` and `packages/*` only (`workspace-package.json`);
the client and the desktop shell would drag vite and electron into every rebuild for nothing. The
sources are copied in and run with `bun`, so a change to the daemon is a rebuild of the last layers.

## State that stays

The container is a second machine to develop against, so it keeps what is put on it. Two named
volumes hold everything that is not the image:

| Volume | Mount | What is in it |
| --- | --- | --- |
| `ruimte-remote_home` | `/root/.ruimte` | `endpoint.json` (the daemon's id and key pair), `auth.json` (the clients paired with it), `projects.json`, the session snapshots. |
| `ruimte-remote_work` | `/work` | The seeded repositories and anything else put there. |

Named volumes and not a bind mount on purpose: the file system has to be the container's own. A
mount of this machine would hand the second daemon this machine's paths, permissions and checkouts,
which is the one thing this rig is built to avoid.

`docker:down` stops and removes the container and leaves both volumes, so `docker:up` comes back to
the same machine: the same daemon id, the same pairings, the same projects, the same repositories.
Seeding is per repository, so the first start writes `atlas` and `beacon` and later starts leave
`/work` alone, including whatever is put there by hand.

`docker:reset` is the way back to nothing. It removes the container and both volumes, so the next
`docker:up` mints a new daemon id and a new key pair (every paired client has to pair again), starts
with no projects and no sessions, and seeds `/work` from scratch. Everything put in `/work` by hand
is gone with it.

## Pairing

The daemon hands a pairing token only to a client on its own machine, so `pair.sh` asks for one
with `docker exec` and rewrites the URL, which names the container, to `127.0.0.1`. Paste what it
prints into the app's settings within ten minutes. Nothing in the daemon was changed for this.

The app registers its public key while it pairs and signs a challenge for a ticket on every
connection after that, so `auth.json` in the container holds a key and no token. To see what an
upgrade does to a client that paired before there were key pairs, build the daemon of the commit
before this one into an image of its own, run it on a volume at `/root/.ruimte`, pair, then run the
current image on the same volume: the daemon keeps its id and gains a key pair, the old token still
opens a socket, `auth.registerKey` works over it, and the token stops working the first time a
signature lands.

## Tests

The suite counts what a daemon lists: no projects on a freshly paired one, exactly `atlas` and
`beacon` under `/work`, `atlas` with the outstanding work the seed left in it. None of that holds on
a machine that has been worked on, so `docker:test` runs it against `daemon-test`, a second service
from the same image on 127.0.0.1:4320 under the name `ruimte-remote-test`. It carries no volumes,
throws `/work` and `$RUIMTE_HOME` away on every start (`RUIMTE_FRESH_STATE=1`, the only thing that
flag is for) and is recreated and removed around every run. The container on 4310 is untouched, and
it can stay up while the suite runs.

`apps/server/src/docker/remote-daemon.integration.test.ts` pairs, opens a socket and walks the wire: `/health`,
`server.hello` and `endpoint.info` (Linux, `lan`, authenticated), the daemon's own id in both the
pairing answer and `endpoint.info` and kept in `endpoint.json`, a refused token, `project.list` on a
freshly paired daemon answering nothing and making nothing, a project opened on `/work/atlas`, a
terminal session that answers
`uname -s`, `git.status` on the outstanding work and `fs.browse` on `/work`. It cleans up the
session and the project it made.

A second block is about signing in instead of carrying a token: pairing with a public key hands out
no token at all, every connection carries a credential of its own, the daemon proves which machine
it is, a wrong signature and a replayed challenge and a key nobody paired all get 401, a signature
meant for another machine is refused, revoking kills the ticket along with the pairing, and a client
paired on a token moves onto a key over its own connection.

A third block runs two daemons at once, which is what the client's transport pool holds: it starts
a plain daemon on this machine (its own `RUIMTE_HOME`, `--no-hooks`, port 4311) next to the
container, asks both who they are, runs a shell on each, then stops the container and checks that
the daemon on this machine keeps answering and keeps streaming its shell. It starts the container
again afterwards, and a start of the test container is a fresh machine again.

A fourth block is about state that belongs to one machine: the same node id on both daemons is two
shells with two screens, one absolute path is two checkouts whose watches do not touch each other,
`fs.list` on that path answers about the machine it was asked of, and context set on a session of
the container is read back from inside that session.

A fifth block opens a project on each machine at once, which is what a workspace carrying its own
connection is for: each saves its own canvas into its own `project.json`, neither list holds the
other's project, each browses its own file system and its own checkout, the bytes of an image come
from the daemon of the workspace that draws it (and the container refuses the same URL without its
token), and the container going down leaves the other project saving. That last test stops the
container; it is started again in the block's teardown, so a failure never leaves it down.

`ruimte-context` is reached by its path in the image there, not by its name. Debian's `/etc/profile`
writes PATH from scratch, so the directory the daemon puts in front of it is gone by the first
prompt of a login shell; on macOS `path_helper` keeps what was already there.

The suite skips itself unless `RUIMTE_DOCKER=1` is set, so `bun test` at the root, and CI, never
tries to reach a container. Run by hand it talks to `ruimte-remote-test` on 4320 as well;
`RUIMTE_DOCKER_CONTAINER` and `RUIMTE_DOCKER_PORT` point it somewhere else, which costs that
daemon's state.
