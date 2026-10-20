# @ruimte/server

The daemon. It owns terminal sessions, chats and everything a project keeps on this machine, and serves them to clients over one WebSocket. Closing a client never ends a session. A session ends on `session.kill`, when the last client holding its project sends `project.close`, or when the daemon goes down.

This file is for running and operating the daemon: flags, the CLI, what it writes on disk, and where its security lines sit. The architecture, the wire protocol, the invariants and the product rules are in the root `CLAUDE.md`, and per-area invariants sit in a `CLAUDE.md` beside the code. Neither is repeated here.

## Run

```sh
bun run --cwd apps/server start            # ws://127.0.0.1:4210/ws
bun run --cwd apps/server start -- --host 0.0.0.0 --port 4300
bun run --cwd apps/server dev              # ws://127.0.0.1:4211/ws, home ~/.ruimte-dev, restarts on file changes
```

The `dev` script runs on port `4211` with `RUIMTE_HOME` set from `RUIMTE_DEV_HOME`, defaulting to `~/.ruimte-dev`. A checkout then runs beside an installed Ruimte (`4210`, `~/.ruimte`) without sharing its id, its projects or its sessions. Its door on the local network listens on `4221`, and `bun src/main.ts status --port 4211` says how clients reach it.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface the API listens on. Go beyond loopback only for a container that publishes the port; only the local secret or a ticket from a direct channel gets in. |
| `--port` | `4210` | Port for `/ws`, `/health`, `/hooks` and the other HTTP routes. |
| `--no-hooks` | off | Write nothing into the CLIs' settings and remove nothing from them: no status hooks, no Codex rule for `ruimte-context`, and the app cannot change that choice. |
| `--label <name>` | hostname | What the machine calls itself until someone names it from a client (`RUIMTE_LABEL` works too). |
| `--no-price-fetch` | off | Never fetch the LiteLLM price table or the exchange rate; the bundled snapshot prices everything. |
| `--no-model-fetch` | off | Never ask the address book for newer model catalogs. |
| `--stun <url>` | `stun:turn.ruimte.app:3478` | A STUN server for direct connections. Repeatable; given once, it replaces the default. |
| `--no-stun` | off | Use no STUN server, so a direct connection announces the interfaces only. |
| `--direct-ports <first-last>` | any | The UDP ports a direct connection binds (`43100-43109`, or one port). |
| `--direct-host-address <ip>` | none | An extra address to announce as a candidate, such as the one a container is published on. Repeatable. |
| `--broker <url>` | the machine's setting | Announce the machine to this Pulsar broker (`RUIMTE_BROKER_URL`; `off` turns it off). `wss://`, or `ws://` for a broker on this machine or the local network. Without it the daemon uses the broker set under Settings, Machines, which defaults to `wss://broker.ruimte.app`. |
| `--no-broker` | off | Announce the machine to no broker, whatever else says otherwise. |
| `--broker-advertise <url>` | the broker | The broker URL clients are told in `endpoint.info`, when they reach it under another name (`RUIMTE_BROKER_ADVERTISE_URL`). |
| `--lan-port <port>` | `--port` plus 10 | The port of the door on the local network; `0` lets the system pick one. |
| `--no-lan` | off | Keep the door on the local network closed, whatever the machine's setting says. |

`GET /health` answers `{ ok: true, version, build, service }`, where `service` says whether the daemon runs as the background service. `POST /hooks/<claude|codex>` takes a hook payload from an agent CLI; other kinds answer 404. Everything else goes over `/ws` in the frames of `packages/contracts`.

Other environment variables:

| Variable | Meaning |
| --- | --- |
| `RUIMTE_HOME` | Where the daemon keeps its state (below). |
| `RUIMTE_DEBUG=1` | Print the whole stack of an error instead of its message. |
| `RUIMTE_PULSAR_URL` | Another address book for `ruimte login`. |
| `RUIMTE_DATABASE_HELPER` | The database helper binary (see "Databases"). |
| `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE`, `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE` | A checkout of a native language server for a development daemon. |
| `BUN_CHROME_PATH` | The Chrome a render child of a visual runs. |

## Compile

`bun run compile` (`scripts/compile.ts`) builds one executable with `bun build --compile` into `dist/<os>-<arch>/ruimte`, with `ruimte-context` and `ruimte.build` next to it. It builds for this machine, or for another with `--os mac|linux --arch arm64|x64`. `--target darwin-arm64` names the target the way the npm packages do, and `--outdir` picks the folder. A macOS binary only compiles on macOS, since `codesign` has to repair the signature Bun leaves. `RUIMTE_VERSION` stamps a version in. The desktop app packages that folder as its `bin` resource.

## Crash reports

A release build reports its crashes and errors, always, and nothing else (`src/telemetry`). `scripts/compile.ts` stamps `RUIMTE_TELEMETRY=1` into a binary only when CI compiles a release, so `bun dev`, the tests and a local compile send nothing. A report goes out for:

- an exception or rejection nothing caught, before the process exits as it did before (two seconds at most, reading the project names included; a registry that does not answer in time leaves the names of the last read)
- a helper that ends while the daemon still needs it: the database helper, the Apple Foundation Models helper of a chat or of the editor's help, and a language server Ruimte ships, with its exit code or signal and its last stderr lines. Not one stopped by SIGTERM, SIGINT or SIGHUP (a person's Ctrl-C, a service manager stopping the group), and nothing once the daemon began to shut down
- an event loop that has not answered for five seconds, seen from a worker that keeps running while the main thread is stuck. A worker that missed its own ticks was suspended with the rest of the process, by a sleep of the machine for one, and starts counting again instead of reporting. It also writes a line to the log, with a release build or without, and another when the loop answers again. It has no stack: Bun cannot take one of another thread.

Each report carries the version, the platform, the architecture and how the daemon runs (`service`, `desktop` or `standalone`). The binary carries its source map, so Bun maps a stack trace back to the source before it leaves. The same error goes out once a day at most (`telemetry/sent.json`).

What goes out is built from an allow-list in `@ruimte/telemetry`: the stack frames without source lines or variables, the error's type and the first line of its message, and a fixed set of tags and contexts. Every string in it loses the home directory (`~`), the user and host names, the names and folders of the machine's projects, the local secret, anything that looks like a token, password, key or environment value, e-mail and IP addresses, URL paths and queries, SQL, other paths and quoted text. A stack frame's file name only loses the home directory and the user and host names, and a frame of Ruimte's own source keeps the rest whole, so a project named like one of its folders cannot break the mapping or the grouping; a frame of anything else loses the project names too. Never sent: requests or replies on the wire, prompts and chats, file contents, terminal output, environment variables, cookies, breadcrumbs, the machine's name or address. There is no tracing, no session tracking, no profiling and no log forwarding.

Every line the serving daemon writes to a log file starts with an ISO timestamp; in a terminal the lines stay as they are.

## Usage statistics

A release build also counts how this machine is used and sends the totals once a day (`src/stats`), apart from the crash reports and never through them. The same stamp decides: `bun dev`, the tests and a local compile count nothing and send nothing. A person turns it off with the machine setting `usageStats` (below); off, nothing is counted and the days not sent yet are deleted, with the last week and month, so the day it comes back on is a first of both again.

`UsageCounter` adds one to a counter in memory per UTC day and writes `usage/stats.json` at most once a minute and on shutdown. It keeps today and the seven days before it, the first day it counted (for the cohort week) and the last week and month it was active in (for `firstThisWeek` and `firstThisMonth`). Every count is one call at its site (`countUsage` and the helpers in `src/stats/usage-stats.ts`). What counts once a day remembers its keys (a project, a view, a session or a machine id) in memory for that day only; they are never written or sent, and go with the day, a restart or the switch:

| Counter | Where it counts |
| --- | --- |
| `projectsOpened` | distinct projects opened per day: an answered `project.open`, each project once a day, so a client's open after a reconnect does not count again |
| `views*` | distinct views shown per day, by kind: a view that is the active view of a client's local state (`project.save-local`), each view of a project once a day |
| `terminalsStarted` | a session the session manager starts without `exec`, so not a launch |
| `chats*` | a chat that opens with no stored record, by provider |
| `turns*` | the first `running` item of each new turn in a chat, by provider |
| `verbs*` | a `ruimte-context` verb that ran, by its group in `USAGE_VERB_COUNTERS`, `list` and `read` included |
| `agentsDelegated`, `teamsDelegated` | an `agent` or `team` verb that ran |
| `browserActions`, `deviceActions`, `databaseActions`, `computerActions` | the `browser`, `device`, `database` and `computer` verbs, and a person's `browser.navigate`, `browser.command`, `device.boot`, `device.shutdown`, `device.action`, `device.capture`, `device.record`, `device.clipboard`, `database.request` and `computer.control` |
| `launchesRun` | a launch the runner started, by a person, an agent, its project or a worktree task |
| `worktreeMerges` | a worktree merge that landed on the target branch; not one that stopped on a conflict or a hook, or had nothing to merge |
| `clientsDesktop`, `clientsIos`, `clientsStation` | a client that is not the local secret, once a day per session its key proved, by the `client` it names in `endpoint.info` |
| `clientsPeer` | another machine working here as a peer, once a day per machine |
| `startupMs` | the median of the day's `usage.startup` (local secret only): the desktop app's time from its start to its page's first connection, handed out once per start by the shell |

The finished days go to the address book (`POST /v1/usage`, `apps/pulsar-worker/README.md`) when the daemon starts and whenever a client lists the providers, the moments the model catalogs are fetched too, so nothing runs on a clock of its own. A day goes once: after a 204 (the address book skips a day outside its window and still takes the others) or a 400 (a body it refuses) it is dropped, after any other failure it waits for the next try, at most every ten minutes, until it is more than seven days old. A day carries the version, platform, arch, launcher (as the crash reports tag it), whether the machine was on an account at any moment of it, and the counts; no id, key, name, path or content. `--no-model-fetch` stops only the catalogs: usage has its own switch, so a person who wants neither turns off both.

## The `ruimte` CLI

A machine without the desktop app runs the same binary from npm (`packages/npm`), with Node or Bun:

```sh
npx ruimte                                # the daemon, with every flag above
npx ruimte login                          # onto an account with a code
npx ruimte status                         # how clients reach it
npx ruimte logout                         # off its account again
npx ruimte service install [flags]        # the background service for this user
npx ruimte service status
npx ruimte service uninstall
npx ruimte closed-lid install             # let keep awake hold a closed lid on a Mac (asks for sudo)
npx ruimte closed-lid remove
npx ruimte notify [--node <id>] <text>   # a notification from a script, which opens that node
npx ruimte --version
```

A bare `ruimte` at a terminal prints the address it listens on and names the commands above. Under the service or the desktop app it logs one `listening on` line. The port is tried before the daemon reads its home, so a second start leaves no trace. When the port is taken it says so and exits 1, naming the Ruimte that holds it when that program answers `/health`.

`ruimte login` puts the machine on a Pulsar account. Run it as the user and with the `RUIMTE_HOME` of the daemon (and `--port` when it is not `4210`). It prints `https://station.ruimte.app/link?code=BCDF-GHJK`, the code and the machine's key fingerprint. A person opens that page anywhere, signs in, checks the name and the fingerprint, and presses "Add to my account". The command then has the daemon sign a registration for that account and exits 0. A denial, an expired code or a withdrawn code exits 1, and Ctrl+C withdraws the code and exits 130. A machine already on another account refuses (see "One account per machine"). Without a daemon answering, it says how to start one.

`ruimte logout` takes the machine off its account. `ruimte status` asks the daemon on the local secret (`GET /machine/status`). It prints the version, whether it runs as the background service, its name, its account, its broker and whether that broker took its signature, the addresses of its door on the local network, and the keep awake state. It warns when neither the broker nor the door can bring a client in. It exits 0 when the daemon answers and 1 when it does not.

`ruimte notify` raises a notification the way an agent's `ruimte-context alert` does: on every window of the app and as a push to the phones, under the node's title. It asks the daemon on the local secret (`POST /machine/notify`) and refuses without it, so only a process of the person whose `RUIMTE_HOME` that is may notify. The notification opens a node, so it always names one: `--node <id>`, or else the terminal of Ruimte the script runs in (`RUIMTE_SESSION_ID`). The text is at most 500 characters. It exits 0 once the daemon queued it, which does not say a device showed it, and 1 without a secret, a node, a daemon that answers, or a project that holds the node.

`ruimte service install` copies `ruimte`, `ruimte-context` and `ruimte.build` to `$RUIMTE_HOME/bin`. It writes the LaunchAgent or systemd user unit the desktop app writes, pointing at that copy and never at the npx cache. The unit carries the flags after `install`, the PATH of the shell it ran in (without npx's own folders) and `RUIMTE_SERVICE=1`. Running it again with a newer version replaces the copy, and the daemon under the service moves to it once idle; different flags restart the service. It refuses to touch a service that runs another program, such as the desktop app's. On Linux it prints `loginctl enable-linger <user>` when lingering is off and leaves turning it on to you. `uninstall` stops the service and removes the definition and the copy, and leaves the rest of `$RUIMTE_HOME` alone. `status` exits 0 only when the service is installed and answers on `--port`.

`ruimte context` is the agent-side CLI behind the `ruimte-context` script (see "Context links").

## Machine settings

What a person sets for the machine lives in `endpoint.json`, next to the id and the key pair, and reaches clients through `endpoint.info` and `endpoint.changed`. Any client the machine let in may change them through `endpoint.setIdentity`, unless noted.

| Setting | What it does |
| --- | --- |
| `name`, `icon` | The machine's name and Lucide icon. A null name falls back to `--label`, `RUIMTE_LABEL`, else the hostname; a typed name wins over both. |
| `agentsDeleteAnyView` | Lets an agent's `view delete`, `node delete` and `link delete` remove what it did not make. Off by default. |
| `resumeAtReset` | Resumes a chat that stopped on a limit, on a clock. Off by default; a chat's own switch can say no. |
| `visualReplies` | Lets an agent in a chat show a page above its reply. On by default; written only as `false`. |
| `streamingAllowed` | Browser pages and device screens stream to clients. On by default. |
| `appleFoundationEnabled` | Offers the Apple on-device model as a chat provider. |
| `keepAwake`, `keepAwakeOnBattery`, `keepAwakeDisplay` | Hold a block on sleep: `off`, `working` (while an agent works) or `always`; on the adapter only unless battery is allowed; the display only under `always`. |
| `keepAwakeLidClosed` | Also hold with the lid closed (below). |
| `broker` | The broker this machine announces itself to, or off. |
| `lanDoor` | Whether the door on the local network is open. |
| `worktreeRoot` | The folder new worktrees are made in; absent is `worktrees` in the data folder. Only the local secret sets it. |
| `usageStats` | Sends the anonymous daily usage counts of a release build (see "Usage statistics"). On by default; written only as `false`. Only the local secret sets it. |
| `nodeSizes` | The size a new node of a kind starts at, by kind, for a person's nodes and an agent's (`node new`, `agent`, `team`, a fork) alike. Only the kinds a person changed are written; a missing kind takes its built-in size (`NODE_SIZE` in `packages/contracts`). Set and reset one kind at a time through `endpoint.setNodeSize`; no verb changes it. |

Keep awake is the daemon's own (`src/power/keep-awake.ts`), so it holds with no window open and when a phone set it. On macOS it is a `caffeinate -w <daemon pid>` child, so a daemon that dies never leaves the Mac awake. Elsewhere `keepAwakeAvailable` is false and nothing is held.

`endpoint.json` stays at `version: 1`. A newer field is added as optional, because a version bump would make an older daemon mint a new id and greet every client as a stranger. A field that will not read is dropped on its own, and the id and key pair survive it. A file that will not read at all is renamed to `endpoint.json.corrupt-<time>` before a new id is minted, so the old key pair can be put back by hand.

### With the lid closed

macOS sleeps on a closed lid whatever assertion is held, so `keepAwakeLidClosed` runs `pmset -a disablesleep 1` while the block holds (`src/power/closed-lid.ts`). The daemon never holds root. A person installs a sudoers rule once, `/etc/sudoers.d/ruimte-closed-lid-<uid>`, that lets this user run exactly `/usr/bin/pmset -a disablesleep 1` and `/usr/bin/pmset -a disablesleep 0`. The file name has no dot because sudo skips such files. `ruimte closed-lid install|remove` does this from a terminal and prints the rule word for word; the app does it through `endpoint.closedLidRule`, which only the local secret may call. Before sleep goes off the daemon writes `power/closed-lid-held` and starts a detached watchdog shell that turns sleep back on once the daemon is gone, however it went. A start that finds `SleepDisabled` with that marker turns sleep back on. Without the marker someone else turned it off, and the daemon leaves it alone. Root `CLAUDE.md` has the rule for when it holds.

### Updates of the desktop app

`endpoint.info` carries `update`, where the desktop app on this machine stands with its next version. The app holds the updater and reports each step with `endpoint.reportUpdate` (local secret only). Any client may call `endpoint.installUpdate`: with `confirm` false it lists the terminals and agents a restart would end, and with `confirm` true it hands the install to the app. Without an app connected it answers `update-no-app`.

## `RUIMTE_HOME`

Where the daemon keeps its state. Defaults to `~/.ruimte` (`~/.ruimte-dev` under the `dev` script and in an unpackaged desktop app). Directories marked 0700 are created with that mode.

```
$RUIMTE_HOME/
  endpoint.json                    the machine's id, key pair and settings (above)
  agent-integrations.json          0600, which CLIs Ruimte may write status hooks into, and what it wrote
  local.key                        the local secret (0600), written on the first start
  peer-machines/<machineId>.json   0700, a machine this one works in: the key the account lists it with and the broker it signals through
  peer-key.json                    the key other machines let this one in under (0600), made when this machine first asks to work in one
  auth.json                        the clients this machine let in by public key, their push subscriptions, and the account the machine is on
  projects.json                    every project the machine knows: id, name, color, folder, and when it was last closed
  providers.json                   the accounts of each agent CLI: kind, label, color, config folder; never a credential
  accounts/<id>/                   0700, the config folder of an account the daemon made (a shadow home for Codex)
  snoozes.json                     the nodes a person put aside, with when each snooze ends
  launch-after-settle.json         per project, the task a person chose to run after a worktree chat settles, and the last turn each chat ran it for
  push-attention.json              the alerts pushed in the last 30 days, which clients mark nodes from
  apple-mcp.json                   optional, written by a person: the MCP servers the Apple chat provider may use
  telemetry/sent.json              0600, hashes of the errors a release build reported in the last day (see "Crash reports")
  bin/                             the copy of the binaries `ruimte service install` runs
  projects/<projectId>.local.json  camera, focus, grid and panels, where a client that never saw the project starts
  scratch/                         the Chats project (see "Projects")
  worktrees/
    <repo>-<hash>/<branch>/        a worktree the daemon made, unless `worktreeRoot` in `endpoint.json` sends new ones elsewhere; nothing removes it on its own
    worktrees.json                 what git cannot say about them: branch, from, project, node, who made it (stays here either way)
  bundles/<id>.bundle              0700, a git bundle written for another machine to read with `bytes.read`; cleared at daemon start, and each file goes once its last piece was read (a client holds at most 4, the machine 16 that nobody began to read)
    incoming/<id>.bundle           0700, a bundle another machine is sending with `git.bundlePut`; removed after `git.fetchBundle`, taken in or refused
    peers/<hash>/                  0700, the same two folders for a machine that works here as a peer, one per machine so no machine reaches another's bundles; cleared at daemon start
  hidden-agents/<id>.json          agents a chat view started outside the canvas, with their placement
  sessions/                        0700
    <sessionId>.txt                serialized screen plus scrollback of one session
    <sessionId>.agent.json         the agent CLI last seen in that session, for a cold resume
  shell-integration/zsh/.zshenv    the shim a zsh session loads first; it keeps a person's own startup files
  prompts/<nodeId>.json            0700, the first prompt of an agent node until its session or chat exists
  outbox/<id>.json                 0700, work the daemon still owes (src/outbox/CLAUDE.md)
  tasks/<taskId>.json              0700, a task a chat gave a node it opened
  lineage/<nodeId>.json            0700, who opened a node, its depth, its mode ceiling and when it was ended
  peers/<machineId>.json           0700, a machine that works in a project here: its label and, per project, the ceiling of its agents (see "Linked machines")
  remote/<projectId>.json          0700, which node of the project runs on another machine, as node id to machine id
  command-approvals/<hash>.json    0700, a command or launch a person approved for a node, or a task for the project's worktrees
  mode-approvals/<hash>.json       0700, the permission mode a person's save gave a terminal agent
  notices/<nodeId>.json            0700, messages left for a node until its agent picks them up
  database-access/<projectId>.json 0700, what agents may do with each connection (see "Databases")
  secrets/<hash>.json              0700 folder, 0600 files: the secrets of a project's launches (see "Launch secrets")
  database-snapshots/<projectId>/<connectionId>/<database>.json
                                   schema snapshots the SQL language servers read
  chats/                           0700
    <chatId>.json                  the thread and info of one chat, with the seq it holds
    <chatId>.log                   every event since that snapshot, one `{ seq, at, event }` per line
    <chatId>.bookmarks.json        bookmarked messages
    <chatId>.plans.json            the chat's plans (src/chat/CLAUDE.md)
    <chatId>.visuals.json          the pages agents showed in that chat
    <chatId>.visuals/              editable HTML sources and preview pngs of those pages
  attachments/<chatId>/            0700, files attached to messages, generated images and visual pages
  checkpoints/<repo>-<hash>.index  0700, the private git index a turn's checkpoint is written through
  provenance/<projectId>/<hash>.json
                                   0700, which chat wrote which lines of a file
  computer-use/                    0700, shared with the computer use helper
    settings.json                  whether computer use is on, and the language it speaks
    grants.json                    apps let in for always, and apps seen running shells
    overlay.json                   the words of the helper's cursor, session bar and menu
    agent.sock, screenshots/       the helper's own (apps/computer-use/README.md)
  browser/                         the profile of the pages the daemon runs for clients without a browser
  screenshots/                     pngs `browser shot` and `device shot` wrote, swept after a day
  device-captures/                 a person's screenshots and recordings of a device, read by the client over `bytes.read`, swept after a week
    placed/                        the screenshots a person placed on a canvas (`device.importCapture`), never swept
  language-servers/
    choices.json                   which PHP server this machine uses
    custom.json                    a person's own language servers
    <kind>/                        one folder per installed kind (see "Language servers")
  usage/                           0700
    index.json                     every transcript the scanner read, with where it stopped
    stats.json                     0600, the usage counts of today and the seven days before it, with the first day and the last week and month (see "Usage statistics")
    prices.json                    the last LiteLLM price table
    exchange-rate.json             the last euro rate for a dollar
  models/catalogs.json             0700, the last model catalogs from the address book
  power/closed-lid-held            0700 folder, present while sleep is off for a closed lid
```

The desktop shell and helpers write a few entries of their own in the same home: `speech.json` and the speech models under `models/`, and `apple-foundation/` for the Apple helper's sessions.

File names are the id passed through `encodeURIComponent`, so an id can never name a path outside its directory.

One home belongs to one daemon. The id in `endpoint.json` is what clients call this machine, and the stores write as if nothing else touches them. Two daemons sharing a `RUIMTE_HOME` are two daemons a client cannot tell apart.

## Projects

Root `CLAUDE.md` and `src/projects/CLAUDE.md` cover the two project files, sharing, revs, holds and closing. What remains for an operator:

- Both project files put every node, text, line and arrangement on a line of its own, so two people who each add a node do not collide in a diff. Node folders inside the project are stored relative to it.
- A project file that does not parse is moved aside as `project.json.corrupt-<timestamp>` and a fresh canvas takes its place. Every write is a temp file plus rename.
- `project.open` refuses a folder whose canvas uses node ids that another open project uses too (`project-ids-taken`). Two checkouts of one repository carry the same canvas, and sessions and chats are keyed on node ids. Close the other project first.
- `project.delete` forgets the project and, when asked, removes the canvas file. Other files in the folder are never touched.
- The Chats project lives in `$RUIMTE_HOME/scratch` and holds one folder per chat, which nothing removes. A home inside a git checkout answers `scratch-unavailable`, since every chat folder would land in someone's repository.
- An agent in a chat of Chats suggests that the chat becomes a project with `ruimte-context project propose` (`src/canvas/project-verb.ts`, `src/projects/project-proposals.ts`). The daemon raises one card per chat (`chat.proposals`, to every client), holds the chat at `needs-you` while it stands and makes nothing: the person reviews it in the dialog that moves a chat (`chat.move`), which takes the card down, or declines it (`chat.proposalDecline`). A card outlasts the turn that raised it and goes after a day without a new suggestion, when the chat stops or when it leaves Chats. The verb never waits for the person, since a call that holds the turn open blocks the very move the card offers: it answers `waiting` at once, and `declined` reaches the agent with its next suggestion, once; a chat that moved suggests nothing more, so a move tells it nothing; a card that lapsed or whose chat stopped tells nothing either, and the next suggestion raises a new one.
- Without a chosen icon the daemon looks for one in the folder (`.ruimte/icon.*`, IDE icons, favicons), jailed to the folder, sniffed by magic bytes and capped at 256 KB. `GET /projects/<projectId>/icon` serves it behind the same access rules as `/ws`, with `nosniff` and, for an SVG, a policy that runs nothing.
- An inline edit in the editor runs in a hidden chat view in the private project file (`src/projects/inline-chat.ts`). No sidebar lists it. The client asks for old ones to be removed after seven days.

## Drawings

A drawing or diagram lives in `.ruimte/drawings/<viewId>.json` while its view is shared and in `.ruimte/private/drawings/<viewId>.json` while it is not. Both folders are watched. A drawing nobody touched leaves no file. Broken JSON is set aside as `<viewId>.json.corrupt-<timestamp>`; a file that parses but is not a drawing stays and answers `drawing-invalid`. A view that disappears through an outside edit of `project.json` never takes its file along, because a pull can drop a view whose file is still on its way.

## Databases

A project's connections live in `.ruimte/databases.json` (shared) and `.ruimte/private/databases.json` (this person's, with the `rev` and the order), managed by `src/database/connection-store.ts`. A connection is private until a person's save shares it. A SQLite file outside the project folder cannot be shared. No password lands in either file; a save drops `config.password` whatever the client sent, because the desktop app keeps passwords in its own secret store.

`database.request` carries one message of `@adecore/database`'s protocol to a native helper. The helper is `native/adecore-database` beside a compiled daemon, `RUIMTE_DATABASE_HELPER` when set, or else what `helperPath()` of `@adecore/database` finds: `ADECORE_DATABASE_HELPER`, the binary of the platform package in `node_modules`, or the release build of a linked checkout. Without one every request answers `helper-unavailable`. It runs with the daemon's `PATH`, so `ssh` and `docker` resolve, and its stderr goes to the daemon's log as `[database] <line>`. Requests are never logged, since `open` and `test` carry the password. A SQLite file under `$RUIMTE_HOME` never opens. Export and import are for the local secret only.

Passwords reach the daemon only through `database.passwords`, from a client of the project, for its agents and its schema snapshots (`src/database/agent-passwords.ts`). The daemon keeps them in memory only. They are never on disk or in a log, and they are gone when the last client lets the project go or the daemon stops. Each is bound to where its connection pointed when it was handed over, so a connection repointed afterwards opens without it.

What agents may do with each connection is a person's choice kept outside the project, in `$RUIMTE_HOME/database-access/<projectId>.json` (`src/database/agent-access.ts`). It lists `off` or `write` per connection, and a connection not listed is `read`. Any client of the project may set `off` or `read`; only the local secret may set `write`. No verb reads or writes that file.

The SQL language servers read a database through a schema snapshot the daemon takes (`src/database/schema-snapshots.ts`) into `database-snapshots/`. A snapshot holds no credential and no row, and is taken on a read-only session of its own. Which connection a `.sql` file or the SQL in a PHP file reads is one person's choice in the private project file (`src/database/sql-analysis.ts`).

## Launch secrets

An agent in an AI chat asks for a secret a launch needs with `ruimte-context secret request` (`src/canvas/secret-verb.ts`, `src/actions/secret-actions.ts`). The daemon raises a card in that chat (`secret.requests`, `src/secrets/secret-requests.ts`) and holds the chat at `needs-you` while it stands, so its status, the stack and push treat it like a question. One card stands per chat, launch and variable; a turn that ends, a chat that stops and 15 minutes without a new ask take it down. The verb answers only `saved`, `declined`, `cancelled`, `timed-out` or `waiting`, never the value.

A person answers with `secret.save` or `secret.decline`. The value goes into `$RUIMTE_HOME/secrets/<hash>.json` (`src/secrets/secret-store.ts`), one file per project named after a hash of its id, written whole with mode 0600. The launch gets `ruimte:secret` as the value of that variable (`LAUNCH_SECRET_REFERENCE`), in this machine's own launch file: the overlay of a shared launch, or the launch itself when it is private. That marker, not the value, is what the launch's approval covers. A Save keeps a launch approved that was approved before, and approves nothing else; a new value for the same variable changes nothing an approval covers, and a marker added or removed outside a person's save asks again. The daemon swaps the marker for the value only in the environment of the process it starts (`resolveEnv` in `src/launches/runner.ts`); a marker without a secret leaves the variable unset. A person's save of the launches drops the secrets no variable refers to any more.

The value is never in a project file, the chat log, an event, a reply to an agent or a log line, and no verb reads it. `secrets/` is the machine's state, so no file request of a client reaches it (`src/fs/machine-home.ts`). What the launched process does with it, printing it included, is that process's.

## Sessions

- A session is keyed by the id the client chooses. `session.create` on a running id answers `session-exists`. On an id whose shell ended it starts a fresh shell and shows the old screen above a `[session restored, previous shell ended]` line.
- The shell is `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere), started as a login shell, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `RUIMTE_SESSION_ID` set.
- Every session runs a headless xterm with 10000 lines of scrollback. A screen that would weigh more than 4 MB as JSON loses its oldest scrollback until it fits (`src/sessions/fit-screen.ts`), because a frame past 16 MB closes the socket and the reconnect would meet the same screen.
- Several clients may attach to one session; the last attacher's size wins.
- A slow client does not grow a queue in the daemon. Past 1 MB buffered on a socket (`src/backpressure.ts`) its output stops, and on drain each session that lost bytes sends a fresh screen as `session.resync`.
- A shell that exits stays in `session.list` as `exited` with its `exitCode`. `session.kill` removes it.
- `session.create` takes either `command` or `agent`, never both. With `agent` the daemon builds the launch line itself (`src/providers/launch.ts`), so no flag travels over the wire. A line longer than 1000 bytes goes into the shell's environment as `RUIMTE_START_LINE`, and `eval "$RUIMTE_START_LINE"` is typed instead (`src/sessions/session.ts`). macOS cuts the tty's input queue at 1024 bytes, so a longer typed line would arrive cut off.
- `session.login` opens a shell that types a CLI's own login command for an account. It ends with the socket of the client that asked and never writes a snapshot.

## Session listener discovery

`session.ports` lists the TCP listeners a session's process tree holds, for opening a dev server from its terminal. macOS reads ownership with libproc and listeners with `/usr/sbin/lsof`; other platforms answer `unavailable`. Only loopback and wildcard bindings are offered. A port another process could also own makes the answer `unknown`. Scans are shared, cached for five seconds and bounded in sessions, processes, time and output. `session.verifyPort` checks one port again before it opens; only the local secret may call it.

## Snapshots

The daemon writes each session's screen to `sessions/<sessionId>.txt` (temp file, then rename) once it has gone quiet: a pass every 10 seconds takes a screen that did not change since the previous pass, and one that keeps changing every 3rd pass at the latest, so a crash loses at most 30 seconds of a busy screen. On `SIGINT`/`SIGTERM` it writes every screen that changed. After a restart, the first attach to a session with a snapshot shows the snapshot, the restored marker and then the fresh shell. `session.kill` deletes the snapshot, so a killed session does not come back. On shutdown the chats are written first and synchronously (`ChatManager.persistAllSync`), because a `bun --watch` reload restarts the module during the first await.

## Agent status via hooks

Claude Code and Codex report status through hooks. Gemini and GitHub Copilot have none, so their terminals show only the session's own status.

The daemon writes into a CLI's global settings only for a provider a person on this machine allowed. The choice is per provider (`claude`, `codex`), kept in `$RUIMTE_HOME/agent-integrations.json` (`0600`) and changed only with the local secret, through `endpoint.setAgentIntegration`; any other client gets `forbidden`. A fresh home writes nothing until then. A home whose CLI already holds Ruimte's hooks counts as allowed and asks once (`reviewed: false`).

For an allowed provider the daemon merges one command hook per lifecycle event into `~/.claude/settings.json` or `~/.codex/hooks.json` (honoring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`) at startup, and into the config folder of every other account of that provider when it launches. For Codex it also writes `~/.codex/rules/ruimte.rules`, which lets Codex run `ruimte-context` outside its sandbox, because the sandbox blocks the daemon's loopback port and the daemon checks every verb itself. Without that rule Codex in a sandboxed mode cannot reach Ruimte. The merge is idempotent and leaves other tools' hooks alone, and a settings file whose top level or `hooks` is not an object is left untouched. Codex asks you to trust new hooks once (`/hooks`).

Turning a provider off removes only the hooks that are exactly what Ruimte writes, and the Codex rules file while it is unchanged, and answers per file what happened (`removed`, `deleted`, `kept-edited`, `missing`, `refused`, `failed`). A file Ruimte created goes away when nothing else is in it. The paths written are kept in the same file as a ledger, so a provider turned off later knows what to look for.

Homes share the global files. Two daemons with different `$RUIMTE_HOME`s write into the same `~/.claude` and `~/.codex`, so turning a provider off in one removes the entries the other relies on until its next start; there is no lock between processes. `--no-hooks` skips all of this: nothing is written or removed, and the choice cannot be changed while it is set (`integrations-fixed`).

Every shell gets `RUIMTE_HOOK_URL` (`http://127.0.0.1:<port>/hooks`) and a per-session `RUIMTE_HOOK_TOKEN`. The hook POSTs its stdin to `$RUIMTE_HOOK_URL/<kind>` with the token as bearer and does nothing outside Ruimte. On `SessionStart` and `UserPromptSubmit` the reply carries `additionalContext`, which is how a terminal agent hears about `ruimte-context`, its links and messages left for it. A chat never reaches these hooks.

A Codex a node launches gets `--no-daemon` when `codex --help` names the flag. Codex's shared background server would otherwise run hooks with the environment of whichever terminal started it.

The daemon folds the events into one status per session (`running`, `needs-you`, `idle`, `error`) and sends it as `session.status`.

## Permission requests

A terminal agent's permission request is answered in its CLI's own prompt; the hook only turns the status to `needs-you`. An AI chat's approvals are answered with `chat.approve`.

The agent record is also written to `sessions/<id>.agent.json`. After a restart the restored session's agent comes back with `live: false`, and the client answers with `agent.resume`, which types the CLI's resume line into the shell. When the transcript the hooks reported is gone, the session's own launch line is typed instead, so the node ends up with a working CLI. A second `agent.resume` is refused with `agent-resuming` for 15 seconds.

## Computer use

An agent operates the apps of this Mac through `ruimte-context computer`, which the daemon carries out through the helper app in `apps/computer-use` (`src/computer`). See `apps/computer-use/README.md` for the helper, and `src/computer/CLAUDE.md` for what the daemon enforces.

The helper is `Contents/Helpers/Ruimte Computer Use.app` in Ruimte.app and `apps/computer-use/dist/Ruimte Computer Use Dev.app` in a checkout. The daemon starts it with `open -g <app> --args --home $RUIMTE_HOME` the first time it needs it and quits it when the feature is turned off or the daemon stops. A daemon from npm and one on Linux have no helper and refuse with `unavailable`. `computer.restart` relaunches the helper, since macOS applies a Screen Recording grant only to a fresh launch.

## Devices

A device node shows a simulator, an emulator or a phone that runs on this machine (`src/devices`). `DeviceManager` has a backend per kind and keeps one capture session per device, shared by every client that shows it and every agent that holds it. A person starts, stops, restarts and, after confirming, erases a simulator or an emulator from its node, and drives it with the pointer, the keyboard while the screen has the focus, its buttons, the fold menu and the tools panel (a capture or a recording, the clipboard, appearance, text size, color filters, permissions, location, the status bar, the battery, biometrics, opening a link or an app, installing an app, adding media and a simulator's camera). An agent with a line to the node goes through `DeviceDriver` (`src/devices/agent-driver.ts`, `ruimte-context device`): it reads the elements, takes shots, taps, swipes, presses buttons, types, opens apps and links, changes settings, permissions and biometrics, sends a push, writes the clipboard and reads an Android one (a simulator's pasteboard follows the Mac's, so an agent never reads it), records the screen, and installs an app or adds media from the project folder or its worktrees, with no approval card. It never starts, stops, restarts, erases or folds a device, nor sets its camera. An agent also lists the devices of the machine (`device list`) and puts one on its canvas itself (`node new device --device <id>`), with the line from it that lets it operate the device. A chat view puts one on the canvas it names with `--view`, with no line, and operates it by naming that canvas again. A person types while the screen has the focus; an agent types through device type.

| | iOS simulator | Android emulator |
| --- | --- | --- |
| Needs | macOS with Xcode (`xcrun simctl`) | the Android SDK on macOS or Linux: `adb` from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the `adb` on PATH or the default folder, the `emulator` package to start one, and the AVDs in `ANDROID_AVD_HOME` or `~/.android/avd` |
| Start and stop | `simctl boot` and `shutdown` | `emulator -avd <name> -no-window` on a free console port, its output in `$TMPDIR/ruimte-emulator-<avd>.log`, so a start that fails says why; `adb emu kill` |
| Screen and touch | the native helper the daemon starts as `device-helper`, JPEG or HEVC | the pinned scrcpy server (`src/devices/scrcpy-server.ts`), H.264, pushed to `/data/local/tmp` for each session and gone after it |
| Shot | `simctl io screenshot` | `adb exec-out screencap -p` |
| Capture | the shot, written to `device-captures/` for the client to copy, save or place on a canvas | the same |
| Clipboard | `simctl pbpaste` and `pbcopy` | over the scrcpy control socket: `GET_CLIPBOARD` answered by a clipboard message, `SET_CLIPBOARD` acknowledged; only while the device is open |
| Status bar | `simctl status_bar override` with 9:41, full Wi-Fi and cell bars and a charged battery; `clear` for the default | SystemUI demo mode (`sysui_demo_allowed`, then `com.android.systemui.demo` broadcasts); `exit` for the default |
| Battery | `status_bar override --batteryLevel --batteryState`, which only the status bar shows | `adb emu power capacity` and `power ac` on an emulator, `dumpsys battery set` and `reset` on a phone |
| Biometrics | `notifyutil` in the simulator: `com.apple.BiometricKit.enrollmentChanged` to enroll, `BiometricKit_Sim.pearl` (Face ID) and `fingerTouch` (Touch ID) `.match` or `.nomatch` | `adb emu finger touch 1` (match) or `99` (no match) on an emulator |
| Shake, memory warning | `notifyutil -p com.apple.UIKit.SimulatorShake`; the memory warning through the native helper, so only on a simulator someone has open | none |
| Install | `simctl install` of an `.app` built for the simulator; an iPhone takes an `.app` or `.ipa` through `devicectl device install app` | `adb install -r` of an `.apk`, on an emulator or a phone |
| Media | `simctl addmedia` of png, jpg, jpeg, heic, gif, mp4 or mov | `adb push` to `/sdcard/Pictures` or `/sdcard/Movies`, then the media scanner broadcast and the provider's `scan_file` call |
| Fold | an iPhone Duo with Xcode 27.1 and the iOS 27.1 runtime: five poses and a free angle through the native helper and its guest helper `serve-sim-duo-hid`; the capture follows the panel SpringBoard reports in its log (`src/devices/fold-panel.ts`), the angle deciding until it does | an AVD with `hw.sensor.hinge = yes`: closed with `adb emu fold`, any other pose with `emu unfold`, the hinge read back from `cmd device_state state` |
| Camera | for one app a person names: `serve-sim-camera-helper` per simulator writes a test pattern, a picture or a video into shared memory, and the app is launched again once with `libSimCameraInjector.dylib` (`SIMCTL_CHILD_DYLD_INSERT_LIBRARIES`), after which a new choice only switches the helper (`src/devices/simulator-camera.ts`); never the Mac's own camera | none |
| Erase | `simctl erase` on a simulator that is shut down, which the person's client shuts down first and starts again after | the emulator stopped and started again with `-wipe-data`; a phone is never erased |
| Record | `simctl io recordVideo --codec=h264`, ended with SIGINT so it writes the end of the file, and by itself after 10 minutes | `screenrecord --time-limit 180` on the device, ended with `pkill -INT screenrecord` there, then pulled and removed |
| Elements | the device bridge (`apps/ios-device-bridge`) | `uiautomator dump`, which needs nothing installed |
| Typing | each run pasted through the simulator pasteboard and Cmd+V | each run pasted through the device clipboard over the scrcpy control socket, which presses paste |
| Keyboard | a person's keys as HID usages through the native helper | the same usages as Android key codes with the meta state of the modifiers held, over the scrcpy control socket |
| Settings | `simctl ui` and the accessibility helper of `serve-sim` | `settings`, `cmd uimode`, `setprop` and `pm` in the device shell |

The clipboard tools move text between the device and the clipboard of the client a person sits at, not the machine's, so they work the same from another machine. Typing on either replaces the device's clipboard. A newline is Return and a tab is Tab, so what a Return does is the app's: a chat sends, a note adds a line. Nothing is installed on an Android device, no app and no keyboard.

An Android phone on USB or Wi-Fi debugging is listed by its serial and takes the same shots, touch, typing, elements and tools; it cannot be started, stopped or given a location. An iPhone streams through the device bridge and takes touch, shots, captures and an app installed with `devicectl`, but no text and no elements.

What an Android emulator cannot do that a simulator can, and stays out of scope:

- Clear a simulated location: the emulator console only sets one.
- Send a push: Android has no local push without the app's own Firebase sender.
- Liquid Glass, Reduce Transparency, and the Reminders and Face ID permissions, which have no Android counterpart.
- Rotate to a chosen side: the screen server turns between portrait and landscape whichever direction is asked.
- Show borders on a screen already drawn: Android draws them from the next screen on.
- Read elements on a screen that never stands still, such as one with an endless animation: `uiautomator` gives up, the agent gets `tree none`, and a shot still works.
- Record for longer than 3 minutes: Android's own recorder stops there, and the node says so.
- Shake, or warn an app of low memory: Android has no counterpart.
- Feed the camera a picture: the emulator's camera is an AVD setting read at its start, not something to switch while it runs.
- Enroll a fingerprint, or touch one on a phone: enrolling happens in the device's Settings, and only the emulator console has a sensor to touch.

A path to install or add is always a file on the machine, never an upload: a client picks it in the machine's own files or drops it from the project's file tree, so it works the same from another machine. The daemon refuses a path that is not absolute or lies in the machine's own state under `$RUIMTE_HOME`, as `fs.read` does (`device-path-refused`), and a file the device does not take. Which of the two media scans Android 14 and later honor is not verified yet (`android-media.device.integration.test.ts`).

The panels of an iPhone Duo are 1398x2034 (cover) and 2007x2853 (inner), as the simulator's device type has them; whether the scrcpy server starts a picture of the new size by itself after a fold is not verified, so the daemon asks it for a fresh one, and `fold.device.integration.test.ts` checks both platforms on a device.

What the status bar and the battery are set to is remembered by the daemon, since neither platform reads it back, and is unknown again after a restart. The `notifyutil` names for biometrics and shake are those earlier Xcode releases used and are not verified on Xcode 27 yet, and neither is the camera feed of a daemon that runs as a launchd service; `docs/ACCEPTANCE.md` ("Devices") lists what still waits for a real simulator, emulator or phone. A simulator's side buttons (volume, power, play) go through the native helper's HID but are announced only once `side-buttons.device.integration.test.ts` confirmed them on a simulator; an Android device presses volume and play as key codes.

TalkBack shows up as a tool only on an image that has it, and typing needs Android 7 or later, the first with a paste key. A development checkout downloads the scrcpy server on first use into `.native`, checked against its pinned checksum; a build carries it in `native/`, and without it a device is listed with its shots, elements and tools but without a screen, touch or typing.

## Providers and models

Each agent CLI is one `ChatProvider` value (`@adecore/agents/providers/provider.ts`). The daemon's list is `src/providers/registry.ts`, with `terminal-providers.ts` and `apple-provider.ts` beside it: Claude Code, Codex, Gemini, GitHub Copilot and the Apple on-device model (`src/chat/apple-backend.ts`, when the machine turned it on). Gemini and Copilot are terminal only. `provider.list` answers per CLI whether it is installed, its version, its models, its resume template and its capabilities.

The model catalogs are `claude-models.json` and `codex-models.json` in `@adecore/agents/providers`. Adding a model there is a JSON edit. The address book hands out the same files on `GET /v1/models/catalog`, so a model added there reaches every machine without a release. The daemon asks at start and on `provider.list` once the last answer is six hours old, and keeps the answer in `models/catalogs.json`. A catalog older than the one the app shipped with is never taken. `--no-model-fetch` turns the fetch off.

The runtime mode (`supervised`, `auto-accept-edits`, `auto`, `full-access`) is one vocabulary for every provider. Each provider maps it to its own flags: `--permission-mode` for Claude Code, an approval policy plus a sandbox for Codex.

### NanoGPT

NanoGPT's subscription API is a chat with no CLI (`src/providers/nanogpt-provider.ts`, `src/chat/nanogpt-backend.ts`). A person saves a subscription API key in Settings, Providers, which `nanogpt.configure` checks against `/usage` before it keeps it, since the model list answers any key. The daemon only ever calls `https://nano-gpt.com/api/subscription/v1`: neither a setting nor a redirect can reach pay as you go, and a model slug with a suffix (`:online`) is never offered, because it can pick a paid route.

The key is a 0600 file in `$RUIMTE_HOME/nanogpt` beside the model list, each conversation (the API keeps none, so the thread is a file of its own) and the usage log. No client reads that folder (`MachineHome`), and only the owner of the machine sets or removes a key. The runtime mode decides which tools ask: `supervised` asks for all, `auto-accept-edits` lets reads and edits through and asks for a command, `full-access` asks for none. `auto` is a CLI's own classifier, which a plain API lacks, so it works as `auto-accept-edits`. A chat can ask the person with an `ask_user` tool, which opens a question card in every mode.

How far a chat goes alone is the person's to set per machine in Settings, Providers (`nanogpt/settings.json`, `nanogpt.configure` with `settings`): a run is cut after `roundsPerRun` tool rounds (40 by default, 5 to 200) so a loop that never ends cannot spend the subscription, and with automatic continuing on (the default) the chat goes on by itself for up to `runs` runs (5 by default, 1 to 20) and notes it in the thread. A change holds from the next run. Each model carries a `vendor`, the publisher in its slug under one name (`src/providers/nanogpt-vendor.ts`), which the model picker groups by; with more than eight models the picker shows the picked one and the default behind a row that opens all of them.

The usage page reads two things. Every call appends a line to `nanogpt/usage/<year>-<month>.jsonl`, which the scanner reads like a transcript, so tokens per model and per day show without a price (a flat subscription has none). The plan windows (daily and weekly input tokens) come from `/usage` with the key, on the limits monitor's clock.

### Claude API

The API of Claude, with an API key of a person's own, is a chat with no CLI (`src/providers/anthropic-claude-api-provider.ts`, `src/chat/anthropic-claude-api-backend.ts`), set up beside NanoGPT in Settings, Providers (`anthropic.status`, `anthropic.configure`, owner only). A key is checked with the model list (`GET /v1/models`, a wrong key is a 401) and kept in a 0600 file in `$RUIMTE_HOME/anthropic-claude-api`, with the models, the settings and each conversation. The daemon only calls `https://api.anthropic.com` and never follows a redirect. A model that is retired is not offered, a deprecated one is listed as legacy, and the default is the newest Sonnet.

Unlike a subscription, every call is paid for, so a chat does not go on by itself unless a person turned that on: the settings are the switch (off by default), the tool rounds of a run (40), the runs it may take (3) and the tokens a reply may use (8192, never more than the model allows). The chat has NanoGPT's tools and its approvals by runtime mode, and the `ask_user` question card. What the API needs is done its own way: the results of all the calls of one turn go back in one message, a thinking block goes back with its signature, and every request marks its system prompt, its tools and its last message for the prompt cache, which is what keeps a long loop affordable. A model the list says takes adaptive thinking is asked to think; the newer ones think without being asked.

Every call appends a line to `anthropic-claude-api/usage/<month>.jsonl` in the line every API shares (`apiUsageLine`), with the input, the cache reads, the cache writes and the output apart, so the usage page prices them like the Claude models they name. There is no plan to read: an API key has no plan windows, so the limits page has no card for it.

## Chats

The chat lifecycle, the backends per CLI and the projector that builds the thread live in `@adecore/agents/chat`. `src/chat/chat-manager.ts` binds them to Ruimte, and `src/chat/CLAUDE.md` has the invariants of forks, plans, bookmarks and visuals. What the daemon owns on disk:

- Every event goes to `chats/<id>.log` as it is broadcast, so a daemon that goes down mid-turn keeps everything a client saw. Reading a chat plays the log over the snapshot `chats/<id>.json` and skips a torn last line. The log is folded into the snapshot when it passes 1 MB, on a clear and on shutdown.
- A turn that was running when the daemon went down is resumed at start through a `resume-run` outbox entry, with a note in the thread. One that cannot be resumed ends `aborted` with a note saying why.
- Attachments are any file type, at most 25 MB each and 8 per message, written to `attachments/<chatId>/<id>.<ext>`. The thread keeps only their metadata and path. `GET /attachments/<chatId>/<id>` serves them behind the same access rules as `/ws`, `inline` only for what a browser paints, with `nosniff` and an immutable cache. A chat's own thread says which id belongs to which file, so nothing else is reachable through the route. A visual's page goes through the same route and is always a download, never inline.
- A turn takes a checkpoint when it starts (`src/git/checkpoints.ts`). The chat's folder is written as a git tree through a private index under `checkpoints/`, so the person's own index, stashes and commits are untouched. When the turn settles, the daemon diffs the working tree against it for the turn's diff.
- A hidden agent's chat (one `hidden-agents/` keeps) goes when the daemon starts, never on a clock, once every task it was given settled more than 30 days ago, no view of any project holds it, and no agent it opened still lives (`src/agents/prune-hidden-chats.ts`). It takes its record, log, plans, bookmarks, visuals and attachments, and with its hidden agent record its lineage, outbox entries and the tasks it gave, the way a deleted node does. The task that opened it stays with its parent, and its worktree stays too.
- `chat.handoff { chatId, turnId, remote }` writes the text a chat on another machine reads first: the last whole turns of the chat up to that turn as a transcript, within 12 KiB, under a header that names this machine and the checkout there. Nothing is made here; the client creates the chat on the other machine and seeds the text as its first message.

### Images an agent attaches

`ruimte-context chat attach --file <path>` reads a PNG, JPEG, GIF or WebP image, or a binary glTF, USDZ or STL model, in the agent's own process and sends the bytes, so the daemon never opens a path an agent names. The daemon reads the type off the bytes again and stores the file as `attachments/<chatId>/agent-<uuid>~<name>.<ext>`, at most 10 MiB for an image, 50 MiB for a model and 64 per chat together. The verb route takes a body up to 72 MiB for that, where every other route stops at 24 MiB. The id it prints is what `Image`, `Gallery` and `Compare` take as `attachment` for an image and `Model` for a model, served by the same route as any other attachment. The folder goes with a clear or a deletion of the chat, and a fork copies the files under the same ids.

### Generated images

When a CLI generates an image, the daemon saves it as an attachment before the tool call settles. The thread keeps its metadata, dimensions and revised prompt; the bytes never enter the event log. A fork copies its attachments, so deleting the original leaves the fork's images.

`chat.imageTarget` and `chat.saveImage` copy an image into the project. Both require the client to hold the chat's project. A copy lands inside the project folder, never in `.git`, `.ruimte` or machine state, and a symlink at the destination is refused. Without `replace` an existing name is never overwritten. A replace names the revision `chat.imageTarget` read and is refused when the file changed since, and it publishes a new file, so it never writes through a hard link. The daemon finds the source in the thread's metadata and takes no path or bytes from the request, and the desktop bridge that opens an image never sees a source path.

`chat.search` looks for a word in the messages of every listed chat of a project, one chat after the other, newest sessions first, and `chat.searchCancel` stops it between two chats. `chat.external` lists the Claude and Codex sessions that were started in the project's folder outside Ruimte, from the transcript folders of every account and nowhere else. Both require the client to hold the project. A session the project's own chats, terminals or nodes already run is left out.

## Maps

Ruimte does not look up addresses: the map service is free to use and TomTom's Search API stays off. A `Place` is drawn from its `lat` and `lon`, and the agent help for the `places` group (`ruimte-context help ui places`) tells agents to give both for every `Place`. An address may still be given as text, but a `Place` with only an address has no point, so it reads as not found and nothing is requested. The daemon holds no map ticket and never contacts the map service (`apps/maps-worker`); the client takes tiles from it.

## Language servers

Merged completion answers apply each server's supported list defaults to its own items before concatenation, preserving individual item overrides and resolve ownership. A malformed default edit range is ignored and logged once for that answer; the remaining defaults and the other servers' suggestions survive. Malformed items are dropped.

Completion negotiation advertises snippets, both insertion modes (as-is and adjusted indentation), and the list defaults the client applies: `commitCharacters`, `editRange`, `insertTextFormat` and `insertTextMode`. The shared `applyCompletionDefaults` helper validates edit ranges and uses `textEditText`, then the item label, for a default range. Mode 1 (as-is) is the explicit completion default.

`src/language` runs the language servers of the editor. The daemon is their LSP client (`@adecore/lsp`) and the one owner of every document's text and version, so all clients of a project share what a server sees. The wire is `packages/contracts/src/language.ts`, and `src/language/CLAUDE.md` has the invariants.

| Kind | Package | Serves |
| --- | --- | --- |
| `typescript` | `typescript` 7 (native server), with a TypeScript 6 sidecar for code actions | TypeScript, JavaScript, JSX and TSX |
| `vue` | `@vue/language-server` with a TypeScript 6 tsserver that loads `@vue/typescript-plugin` | Vue, and the scripts of a project that uses it |
| `php-native` | the native server from `basmilius/language-server-php`, shown as PHP | PHP, `.phtml`, Blade, Twig |
| `php` | intelephense, shown as Intelephense | PHP |
| `css`, `html`, `json` | `vscode-langservers-extracted`, one install each | CSS, SCSS and Less; HTML; JSON and JSONC |
| `yaml` | yaml-language-server | YAML |
| `python` | pyright | Python |
| `bash` | bash-language-server | shell scripts (with shellcheck when it is on PATH) |
| `docker` | dockerfile-language-server-nodejs | Dockerfile |
| `eslint` | `vscode-langservers-extracted` | JavaScript, TypeScript and Vue, in a project with an ESLint config |
| `tailwind` | `@tailwindcss/language-server` | HTML, CSS, scripts, Vue and PHP, in a project that uses Tailwind |
| `sql-native` | the native server from `basmilius/language-server-sql`, shown as SQL | `.sql` files, against the project's schema snapshots |
| `rust` | rust-analyzer from the Rust toolchain, never installed by Ruimte | Rust, in a project with a `Cargo.toml` in its folder or up to three folders down |

The pinned npm versions are in `src/language/versions.ts`. A kind is installed only when a person presses Install (`language.install`); no verb, agent or daemon start installs anything.

Each install has its own folder, `$RUIMTE_HOME/language-servers/<kind>/versions/<id>`, and `<kind>/current.json` names the one in use and the one before it. An npm kind gets a `package.json` with exact versions and `bun install --ignore-scripts`, run by the daemon's own executable acting as bun (`BUN_BE_BUN=1` in a compiled daemon). JavaScript servers run the same way, so a person needs no Node. When a pin moves with an update of Ruimte, the kind keeps running what it has and offers Update. `language.rollback` switches back to the previous install. A kind keeps at most two installs.

The native servers install differently (`src/language/native.ts`, `installer.ts`):

- A development daemon builds a checkout with `cargo build --release --locked`. It uses `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE` or `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE` when set, else `../language-servers/php` or `../language-servers/sql` beside Ruimte's source checkout (or beside the primary checkout of a worktree). Discovery reads files only and never touches git. Cargo is found on `PATH` or in `~/.cargo/bin`.
- Without a valid checkout, and always in a compiled daemon, Install downloads the release pinned in `src/language/php-native-release.json` or `src/language/sql-native-release.json`. A pin names the URL, SHA-256, archive format and executable path per platform. The checksum must match before extraction, entries that escape the install folder are refused, and `--version` must answer the pinned version.
- PHP's standard library stubs are downloaded at Install for the commit the server was built against. The server starts with `storagePath` and `stubsPath`, so it never goes to the network.

The `rust` kind is a toolchain's (`src/language/toolchain.ts`): rust-analyzer has to match the toolchain a project builds with, so Ruimte pins and downloads nothing. It runs the `rust-analyzer` found on `PATH` or in `~/.cargo/bin` that answers `--version` (a rustup proxy without the component does not), with `~/.cargo/bin` added to its `PATH` for cargo. Without one the kind is not installed and says to run `rustup component add rust-analyzer`; Install only looks again, and there is no update or previous version. The server is told every `Cargo.toml` of the project that no other one holds (`linkedProjects`, `src/language/manifests.ts`), since it looks only in its folder and one level down by itself.

`$RUIMTE_HOME/language-servers/choices.json` holds which PHP kind the machine uses (`php-native` by default), set with `language.prefer`.

A person can add servers of their own in `$RUIMTE_HOME/language-servers/custom.json` (`src/language/custom.ts`): a command over stdio, its arguments, environment, initialization options, languages, file patterns and project folders. A project file can never name a server and no verb adds one. `language.custom.save`, `remove` and `check` answer the local secret only, since a save approves that exact command, arguments and environment. An entry edited by hand so it no longer matches its saved hash is held and never started until a person saves it again.

One server runs per project per kind. It starts with the first document that needs it and ends when the project closes on the machine or the daemon stops. A server that ends by itself after a minute of being ready is started again once. Any other end leaves it `crashed` until `language.restart`. `language.log` returns the last 500 lines of the install and of the server.

## On-device help for the editor

`src/ondevice` runs one-shot generations on the machine's own model (Apple Foundation Models) for the editor's explanations, rename suggestions and ghost text. The wire is `packages/contracts/src/ondevice.ts`. It starts the same helper the Apple chat provider uses with `--oneshot` and keeps it until the daemon stops. The instructions per purpose live in `src/ondevice/instructions.ts`, so a client sends only the text to read. The helper opens no connection and has no tools, so code stays on the machine. More than four requests at once answer `busy`. A machine that is not an Apple silicon Mac reports itself unavailable without starting anything.

## Files

The file requests (`fs.read`, `fs.write`, `fs.create`, `fs.rename`, `fs.delete`, `fs.grep`, `fs.locate`, `fs.list`, `fs.browse`, `bytes.read`) live in `src/fs`, and the archive requests (`archive.list`, `archive.extract`) in `src/archive`.

- No file request reaches under `$RUIMTE_HOME`, by name or by where a link leads, except the Chats project, the worktrees, the screenshots and the attachments (`src/fs/machine-home.ts`). A client the machine let in is not the owner, and the local secret, the key pair and the approvals there are what tell the two apart. Such a path answers `machine-state`.
- `fs.write`, `fs.create`, `fs.rename`, `fs.delete` and `archive.extract` work only inside a project folder the calling client holds, or a worktree of its repository that the daemon made (under `$RUIMTE_HOME/worktrees`, or where the register says), compared on real paths (`outside-project`). `.ruimte` at the root of such a folder is closed (`ruimte-state`), except `.ruimte/private/consoles`, and `.git` is closed at any level.
- `fs.rename` refuses a move to another volume (`other-volume`) before it touches anything. With `overwrite` the replaced file goes to the trash; on Linux its `.trashinfo` records the path it had, so a restore puts it back there. On macOS the item lands in `~/.Trash` under its own file name; Put Back needs a record only Finder writes, so it is not offered there.
- `fs.read` and `fs.write` treat a file over 2 MB as too large for the socket. `fs.write` checks the mtime it read (`stale`) and never writes over a file that is not text. Agents have no verb for writing; they write with their own CLI.
- `GET /fs/file?path=<absolute>&v=<mtime>-<size>` (`src/fs/file-route.ts`) serves images, video, sound, PDFs, 3D models (GLB and USDZ) and large text files behind the same access rules as the socket. Text always goes out as `text/plain`, so an HTML file never runs in the page's origin. Responses carry `nosniff`, an immutable cache, `Range` support for video and, for an SVG, a policy that allows nothing but its own styles.
- `fs.grep` uses ripgrep when it is on PATH, and a JavaScript search over the cached file list otherwise. The file list of a repository takes in the files of the repositories inside it (submodules, repositories beside its own), so `fs.search` finds them too.
- `fs.locate` says where a path an agent wrote down is, when a person follows the link: the agent's folder, and only when that has no such file the root of every repository in it, then the project's checkout of a worktree. It answers existing paths only and never one of the machine's own state.
- `archive.list` reads a zip (ZIP64 included), a tar (ustar, GNU long names, pax), a tar in a gzip and a gzip of one file, told apart by their bytes. It lists at most 10,000 entries (`truncated`), leaves out a name that is absolute, has a drive letter, a `..` or a NUL (`unsafe` counts them), and never lists a device. A zip is read from its central directory; a compressed tar is unpacked from the start, at most 4 GiB of it. An encrypted zip entry or one packed with a method other than stored and deflate is listed and marked not readable.
- `bytes.read` with an `entry` hands out one entry of an archive, up to 32 MiB, with the mime its own bytes claim; the last two entries unpacked are kept in memory for the pieces after the first. The archive itself is never served whole.
- `archive.extract` never overwrites (`exists`, checked before a byte is written), never makes a link of either kind and skips a name that escapes, an entry under `.git` or `.ruimte` and an unreadable entry, saying which in `skipped`. Every inflate is held to 4 GiB per extract and to a ratio of 200 to 1 once past 8 MiB, counted on the bytes as they come out, never on the sizes a header claims (`src/archive/limits.ts`).

## Remote clients

Where a request comes from never grants anything. Behind a tunnel or reverse proxy every visitor is loopback. A process on this machine presents the local secret from `$RUIMTE_HOME/local.key` (`?token=` or `Authorization: Bearer`, compared in constant time), and is the owner of the machine (`isOwner` in `src/auth/access.ts`). The desktop app hands it to its page over the bridge, and `ruimte login`, `logout`, `status` and scripts such as `bun run smoke` read it from `RUIMTE_HOME`.

Every other client comes in through the account, on a statement from the address book carried in the offer of a direct connection. A direct connection is a WebRTC DataChannel (`src/pulsar/peers.ts`). Its signals arrive over the broker (`src/pulsar/broker-relay.ts`) or through the door on the local network, both through one `SignalGate` (`src/pulsar/signal-gate.ts`). The channel's handshake (`src/pulsar/channel-auth.ts`) binds the client's key to the DTLS fingerprints, so a broker that swaps a fingerprint breaks it. The daemon then hands out a ticket for the HTTP routes. It is good for twelve hours from its last use and lives in memory only. The clients' public keys sit in `auth.json`; `auth.sessions` lists them and `auth.revoke` cuts one off and closes its channels.

A browser upgrade is accepted from the daemon's own origin, the desktop app's (`app://ruimte`) and any loopback origin, and refused from the rest. Credentials ride as a bearer or in the query, never as a cookie. The daemon serves no page of its own.

### The door on the local network

`src/pulsar/lan-door.ts` listens on every IPv4 interface at the daemon's port plus 10 (`--lan-port`). It answers one WebSocket at `/signal` and a 404 for everything else, so the API itself stays on loopback while a client on the same network or tailnet signals without the broker. The machine proves its key before the client says anything about itself. One address opens at most 30 sockets a minute and holds at most 8. `endpoint.info` carries `lan: { port, addresses }` while the door is open, read from the interfaces at the moment they are asked (private ranges first, then a tailnet's `100.64.0.0/10`, never a container or VM bridge). The door is open unless a person closed it (`lanDoor`) or `--no-lan` is set. A port that is not free leaves the door closed with one line in the log.

### Push notifications

A client with a key (the iPhone app) hands the daemon its push subscription with `push.subscribe`, kept with that client in `auth.json` so a revoke takes it along. The daemon decides every push itself (`src/push/service.ts`) and posts it signed and encrypted to the address book, which only relays it to APNs (`apps/pulsar-worker/APNS.md`). Nothing goes to a client while it holds a socket to the machine, and a snoozed node raises nothing until its snooze ends. Each device picks the kinds it hears about (`needs-you`, `turn`, `process`), per project if it likes; without a choice it hears `needs-you` only. A finished turn and a process warning each have a collapse id of their own per node, so they never replace an attention or approval alert.

Read state lives in `push-attention.json`: per node when it last notified and how far it was read. A client acknowledges what a focused window actually shows with `push.read`, and a new turn reads the previous result. The daemon then sends a signed, encrypted read receipt, only to a client that advertises `readSync`, and a late acknowledgment never removes a newer alert. A snoozed node reads its alert, and when the snooze runs out while the node still needs you, a new alert goes out. Apple delivers background pushes when it likes, so connecting to the machine reconciles what was missed.

Each machine has one Live Activity per device, combining its terminals and chats into one signed overview with the active agents, attention first, and the totals. A work round has a generation (its `startedAt`), so a new round starts a new activity instead of reusing the previous token. A finished turn always updates the activity, whatever the device chose.

### One account per machine

A machine is on at most one address book account and is shared only with its owner. It goes on an account only when it signs a registration: `endpoint.signRegistration` (owner only, `forbidden` otherwise) or `POST /machine/registration` for `ruimte login`. The account is written to `auth.json` before the signature leaves the daemon, since anyone holding the signature can post it. The same account signs again as before. Another account is refused with `machine-has-account` until a person on the machine takes it off, with `endpoint.leaveAccount` or `ruimte logout`, both local secret only. `endpoint.info` names the account only to a client on the local secret.

A client the machine does not know gets in on a statement from the address book (`src/pulsar/statement.ts`). A v2 statement signs the key the account lists the machine under and the account. It must name this machine's own key and carry a v2 signature that holds, so an account that lists a known machine id under a key of its own gets nobody in. `AuthStore.admitStatement` decides which account a statement may name:

- On an account, only a v2 statement of that account lets a client in.
- Taken off its account by a person, no statement lets anyone in until the machine signs for an account again.
- On no account yet, a v2 statement of any account lets a client in, since its machine key proves the machine signed a registration for that account. A statement without v2 fields is refused (`account-required`). A statement never puts the machine on an account.

Each client keeps the account it came through. Going on an account cuts off clients another account let in, and leaving the account cuts off every client a statement let in and closes their channels.

## Provenance

Which chat wrote which lines of a file, for the editor's gutter (`src/provenance/`; its `CLAUDE.md` has the invariants). Each file has a record in `$RUIMTE_HOME/provenance/<projectId>/<hash of the path>.json`: the file's line hashes as last read, and per run the chat, the turn, the provider, when, the first 400 characters of the prompt, the lines (`start` and `end`, one-based and inclusive), the lines it replaced (`before`), a review state (`pending`, `kept`, `undone`) and `via`.

`provenance.read { projectId, path }` answers `{ mtime, lines, runs }`, mapped onto the text on disk now. `provenance.review { projectId, path, runIds, state }` sets a review state on every piece of those runs. Both refuse a path outside the project or under `$RUIMTE_HOME`. `provenance.changed` goes to every client that holds the project when a tool call writes a file, when a review changes, and when the turn ends. No verb reaches it and no setting turns it off.

## Git

`src/git` answers the git panel: status, diffs, blame, staging, branches, the log, worktrees and conflicts. A few operational facts:

- Commands run without a shell, with arguments as lists, so a branch name or commit message is one argument however it is spelled. `GIT_TERMINAL_PROMPT=0` keeps a credential prompt from stalling, and a step that talks to a remote gives up after two minutes.
- `git.watch` with `status: true` answers the status read once the watch is up, so a client's first read needs no second request.
- `git.watch` gives up on a repository with more than 5,000 tracked files, or one whose status takes longer than a second. The status then says `live: false` and the client refreshes on focus instead.
- `git.identity { paths }` answers per folder its root commits, the `origin` URL without credentials, the branch and the tips of the local branches, which is how two machines tell they hold the same repository. A folder counts only when it is the top level of its repository, and one that takes more than five seconds answers `timed-out`. Like a file request it refuses a path under `$RUIMTE_HOME` that is the machine's own state.
- `git.bundle { path, from, branch?, haves, name }` writes a checkout as a git bundle under `bundles/` and answers its id, size, sha256, tip and base. `files` is the working tree as it is (uncommitted and untracked files included), `head` is HEAD's tree and `branch` is a branch as it stands; the first two become a commit on HEAD made through the checkpoint index, so the checkout's own index, stashes, branches and files stay as they were. The commits in `haves` that this checkout has are left out of the bundle. The bundle is read with `bytes.read` (`{ kind: 'bundle', bundleId }`), up to 256 MiB; a larger checkout goes through its remote (`bundle-too-large`).
- `git.bundlePut { bundleId, offset, data }` appends a piece (up to 256 KiB, base64) of a bundle that is coming in; the pieces arrive in order, a piece at offset 0 starts over, `total` is the size of the whole bundle, and at most 16 uploads that have not reached it are open at once. `git.fetchBundle { projectId, bundleId, sha256, branch, into, machine? }` then checks the sha256, runs `git bundle verify`, fetches the one handoff ref of the bundle with hooks off into `refs/ruimte/received/<id>` and makes a worktree on a new branch `ruimte/<branch>` at its tip. With `into: 'remote-ref'` the tip is also kept as `refs/remotes/ruimte-<machine>/<branch>`, which is how the work of another machine comes back to be merged.
- `git.discard` stashes the paths as `ruimte-discard-<timestamp>` before it resets them, so `git stash pop` brings them back.
- `create-pr` needs `gh` on the PATH. A suggested commit message runs the agent CLI in its one-shot print mode, with no chat or session.

## Linked machines

Another machine of the account works in a project here only after a person links it: `peer.bind { machineId, label, projectId, ceiling? }` from any client, which is `supervised` unless a ceiling is given. `peer.list` answers every link with the name of its project, `peer.setCeiling` changes the widest mode an agent from that machine may start in, and `peer.unbind` ends the nodes that machine has here, removes the hidden canvas `peer-<machineId>` and the link. `peer.placeNodes { machineId, projectId, nodes, edges }` replaces the hidden canvas `peer-<machineId>` with the nodes that machine draws for this one (ids kept, a folder beyond the project and its worktrees refused as `cwd-outside`, a line with an end off the machine as `edge-off-machine`), and the client that asks holds the project from then on. `peer.changed` goes to every client when the list changes. The design and its rules are in `src/peering/CLAUDE.md`.

Another machine gets in as a peer on a peer statement (`POST /v1/peer-statements` in the address book, ten minutes, `peerStatementMessage`), carried as `access.peer` in the offer of a direct connection. It is kept in `auth.json` with `origin: 'peer'` and the machine it is, so a daemon from before peers drops the record rather than keeping a machine as a client, and `auth.sessions` lists it with a `machineId`. A peer is never an owner and gets no ticket, so no HTTP route opens to it, and it hears no event. The dispatcher refuses everything but the requests registered with `{ peer: true }` (`endpoint.info`, which then answers only who the machine is and those requests, `server.ping` and the `peer.task*`, `peer.result`, `peer.bundle*` and `peer.close` requests below) as `forbidden`, and a request that is owner-only cannot be registered that way. A peer is let in for 30 days after the last statement the address book signed for it; a new one brings it back under the same session. Revoking the session closes its channel and refuses its key for good. A peer request needs a link made here first, or it is answered `peer-not-linked` (`requirePeerLinks`, `src/peering/peer-access.ts`).

The other half sits on the machine whose person works elsewhere: `remote.link { projectId, machineId, remoteProjectId, label, rootCommit }` remembers which project on that machine this one is linked to (under `remote/<projectId>.json`), `remote.list { projectId }` answers them, and `remote.unlink` removes one, refused with `machine-in-use` while a node still runs there. To work in another machine, `endpoint.signPeerAccess { machineId, nonce }` (any client) signs the request twice, with the peer key in `peer-key.json` and with the machine key. The client posts that to the address book and hands the statement it gets back with `remote.connect { machineId, statement }`, which the daemon checks (the address book signed it, for this machine and this account), remembers the other machine's key from (`peer-machines/<machineId>.json`) and keeps in memory until that machine has let it in. It answers once the link is open (`src/remote/remote-connections.ts`: the signals over the broker, then a direct channel) or says why it could not, as `peer-unreachable`. `remote.status` tells every client where each link stands (`open`, `connecting`, `waiting` while work for the machine is owed, `closed`), once for each on subscribe. A link lost or refused while work for the machine is owed is retried through a `connect-peer` outbox entry (`src/remote/connect-peer.ts`): after a minute, doubling to ten, until nothing is owed any more, the machine is unlinked, 7 days have passed since work for it was first owed, or the machine refuses this one. Leaving the account makes this machine forget its peer key (`peer-key.json`), `peer-machines/` and its statements.

### Tasks on another machine

An agent gives a task to an agent on a linked machine with `ruimte-context agent --machine M --task ...` (or `team`). The machine is named by its id or name and has to be one this project is linked to and this machine can work in (`machine-not-linked`); `--task` is required, and `--cwd`, `--reads`, `--model` and `--base` are refused. The node stands on a private canvas, bound to the machine through `ProjectMutation.bindMachines` (the daemon's own path; a verb's content never carries `machine`, and a shared canvas refuses it as `remote-node-shared`), and no line is drawn to it. The task is written with the machine it runs on, and a `start-remote-agent` outbox entry owes the start: it waits for the link and owes the reconnect (`connect-peer`), never fails because the machine is away, and with `--worktree` writes the checkout of the caller as a bundle (uncommitted files included) and sends it with `peer.bundlePut` before `peer.taskStart`. `remote.status` names, in `unstartedNodeIds`, the nodes whose entry still waits, so a window can say the task has not started. A machine with no place for the task yet (`peer-busy` at 4 open tasks, `peer-bundle-limit` at 2 transfers kept) leaves the entry waiting: it runs again when that machine says a task settled, when this machine stopped one there or when the link opens again, never on a clock. Any other refusal (`depth-limit`, `peer-not-linked`, `peer-worktrees-full` at 8 worktrees kept for that machine's tasks, a bundle that does not fit) fails the task with the machine's words. Once the machine took the task a `take-remote-result` entry waits for its result; the machine says when it settled (`peer.taskSettled`, over its link only), and on reconnecting this machine asks `peer.result` anyway. The result is taken in as a remote branch `refs/remotes/ruimte-<machine>/ruimte/<name>` with a worktree on it that the node owns (`worktree merge` brings it in), the task settles from what the machine said (`TaskCoordinator.settleFromElsewhere`, which wakes the parent once), and only then does `peer.result { ack: true }` tell the machine it may forget the result. Ending the node, its opener or its task owes `stop-remote-agent` (`peer.taskStop`) for an agent that started; one that did not start is dropped without asking the machine.

On the machine that does the work, `peer.taskStart` is judged by the link there: the project is the one the link names, the mode is the narrowest of what is asked, what the parent allows and the link's ceiling, the depth is at least 1 and refused above the daemon's own maximum, and the agent starts as an agent of this machine with its launches held for a person. The task is a task of this machine's own store whose parent is the hidden canvas of the machine that gave it; its result is owed in a `deliver-remote-result` entry until the other machine acknowledges. `peer.bundleRead` serves a result bundle to the machine it was made for and to no other, and `peer.close` lets go of the project the machine held.

## Worktrees

A worktree the daemon makes lives under `$RUIMTE_HOME/worktrees/<repo>-<hash>/<branch>`, where `<repo>` is the repository's main checkout. The person on the machine can pick another folder for new ones (`worktreeRoot`, set with `endpoint.setIdentity` by the local secret only, refused for the root of the disk, the home folder and the data folder); worktrees already made stay where they are, and the register keeps knowing them. `worktrees.json` beside those folders (`src/git/worktree-register.ts`) records what git cannot say: the branch, where it was made from, the project, the node, who made it, and whether the daemon made the branch. Git stays the truth about which worktrees exist.

`git.worktree-remove` refuses a worktree with uncommitted, untracked or unmerged work, or a locked one, unless forced. It deletes the branch only when the daemon made it and the worktree is still on it, and answers the tip it had, since no reflog keeps it after removal. Merges run through `src/git/worktree-merge.ts`; root `CLAUDE.md` has their rules.

## Context links

A line on the canvas into a terminal or chat lets that agent read the source. Every shell and chat gets:

- `RUIMTE_CONTEXT_URL` (`http://127.0.0.1:<port>/context`)
- a bearer token: `RUIMTE_HOOK_TOKEN` in a shell, `RUIMTE_CONTEXT_TOKEN` in a chat
- the folder of `ruimte-context` in front of its PATH (`apps/server/bin` in a checkout, the app's `bin` resource when packaged)

`ruimte-context` lists the linked sources and `ruimte-context read <id>` prints one; `--tail N` prints only the last N lines. What each kind reads as is in `ruimte-context help read`. The daemon derives what a node may read from the project documents (`src/projects/project-index.ts`).

No line can run to a chat that is a view of its own. Such a chat names a canvas with `--view` instead, and then reads every node and text on it (`read <id> --view <canvas>`) and drives its browser and device nodes the same way; without `--view` a node of a canvas refuses with `view-required` (`src/canvas/chat-view.ts`).

Exit codes of `ruimte-context`:

| Code | Meaning |
| --- | --- |
| 0 | Success; the answer is on stdout. |
| 1 | The daemon cannot be reached or failed. |
| 2 | Not in a live session: no token, or a token the daemon does not know. |
| 3 | A refusal, on stderr. |

## Agent commands

Agents work with the project through `ruimte-context <verb>` and `ruimte-context <noun> <action>`. The CLI posts `{ argv }` to `POST /canvas/<verb or noun>`, and the daemon parses the words, so a CLI from an older build never disagrees with the daemon.

The registry in `src/canvas/verbs.ts` is the one source. Each verb, noun and action holds its synopsis, help lines and handler. The parser dispatches from it and `ruimte-context help` renders from it, so run `ruimte-context help`, `help <noun>` or `help <noun> <action>` for the current reference. Many actions are adapters over the catalog actions in `@ruimte/actions`, run by the daemon's handlers in `src/actions`, so an agent, a person and Voice run the same action with the same checks.

Answers are `text/plain`, one tab-separated line per result. A refusal is HTTP 422 (404 for an unknown verb) whose first line is `refused\t<code>\t<message>`, followed by what the caller can pick instead where the set is closed. The CLI prints it to stderr and exits 3.

Root `CLAUDE.md` holds the product rules for agents, and `src/canvas/CLAUDE.md` and `src/outbox/CLAUDE.md` hold the invariants of verbs, lineage, tasks and the outbox.

## Usage

`@adecore/agents/usage` answers what the CLIs cost and what is left of their plans. Nothing here calls a vendor API or reads a credential.

- The scanner reads the transcripts of every account (`~/.claude/projects` and `~/.codex/sessions`, honoring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`) and keeps its place per file in `usage/index.json`. Throwing that file away costs one cold scan.
- Prices come from LiteLLM's `model_prices_and_context_window.json`, refreshed every 24 hours and kept in `usage/prices.json`, with a snapshot bundled as the offline fallback. A model the table does not price shows as unknown, never as free.
- The daemon fetches the ECB reference rate from frankfurter.app on the same schedule into `usage/exchange-rate.json`, so the client can show euros.
- `--no-price-fetch` turns off both network calls.
- Plan limits come from the CLIs themselves (`get_usage` over Claude Code's stream-json protocol, `account/rateLimits/read` over Codex's app-server), every five minutes, backing off to an hour after a failure.

## Smoke test

With a daemon running:

```sh
bun run --cwd apps/server smoke            # or: smoke ws://host:port/ws
```

It creates a session, runs `uname`, prints the streamed output and the screen a reattach would receive, then kills the session.

## A remote daemon in Docker

`docker/` runs a second daemon on Linux at `127.0.0.1:4310`, a machine that is really not the client's, for testing remote access. `bun run --cwd apps/server docker:up` starts it; `docker/README.md` has the rest.
