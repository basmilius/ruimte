# A remote daemon in Docker

A second daemon, on Linux, in a container, so a client on this Mac can pair with a machine that is
not its own. It is a test rig for everything that only happens over the wire: pairing, a session
token on the socket, a `lan` reachability, paths and a shell that are not this machine's.

The container holds a shell, git and bun, and nothing else. No Claude Code, no Codex, so chat nodes
and agent status are out of scope here.

## Run

```sh
bun run --cwd apps/server docker:up        # build and start on 127.0.0.1:4310
bun run --cwd apps/server docker:pair      # a pairing URL to paste into the app
bun run --cwd apps/server docker:test      # the test suite against it
bun run --cwd apps/server docker:down      # stop and remove it
```

The daemon listens on `0.0.0.0:4310` inside the container and the port is mapped straight through
to `127.0.0.1:4310` on this machine, next to the local daemon on 4210. Nothing else on the network
reaches it.

## What is in there

Every start throws away `/work` and `$RUIMTE_HOME` and seeds two repositories, so a run always
begins on a daemon that has seen nothing (`RUIMTE_KEEP_STATE=1` keeps both across a restart, which
is what you want when you paired a client by hand):

| Path | What it holds |
| --- | --- |
| `/work/atlas` | Three commits, a `lighthouse` branch next to `main`, `README.md` changed and an untracked `notes.txt`. |
| `/work/beacon` | One commit, nothing outstanding. |

The image installs a workspace of `apps/server` and `packages/*` only (`workspace-package.json`);
the client and the desktop shell would drag vite and electron into every rebuild for nothing. The
sources are copied in and run with `bun`, so a change to the daemon is a rebuild of the last layers.

## Pairing

The daemon hands a pairing token only to a client on its own machine, so `pair.sh` asks for one
with `docker exec` and rewrites the URL, which names the container, to `127.0.0.1`. Paste what it
prints into the app's settings within ten minutes. Nothing in the daemon was changed for this.

## Tests

`apps/server/src/docker/remote-daemon.test.ts` pairs, opens a socket and walks the wire: `/health`,
`server.hello` and `endpoint.info` (Linux, `lan`, authenticated), the daemon's own id in both the
pairing answer and `endpoint.info` and kept in `endpoint.json`, a refused token, `project.list` on a
freshly paired daemon answering nothing and making nothing, a project opened on `/work/atlas`, a
terminal session that answers
`uname -s`, `git.status` on the outstanding work and `fs.browse` on `/work`. It cleans up the
session and the project it made.

A second block runs two daemons at once, which is what the client's transport pool holds: it starts
a plain daemon on this machine (its own `RUIMTE_HOME`, `--no-hooks`, port 4311) next to the
container, asks both who they are, runs a shell on each, then stops the container and checks that
the daemon on this machine keeps answering and keeps streaming its shell. It starts the container
again afterwards, with the fresh state every start gives it.

A third block is about state that belongs to one machine: the same node id on both daemons is two
shells with two screens, one absolute path is two checkouts whose watches do not touch each other,
`fs.list` on that path answers about the machine it was asked of, and context set on a session of
the container is read back from inside that session.

`ruimte-context` is reached by its path in the image there, not by its name. Debian's `/etc/profile`
writes PATH from scratch, so the directory the daemon puts in front of it is gone by the first
prompt of a login shell; on macOS `path_helper` keeps what was already there.

The suite skips itself unless `RUIMTE_DOCKER=1` is set, so `bun test` at the root, and CI, never
tries to reach a container.
