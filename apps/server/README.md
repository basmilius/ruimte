# @ruimte/server

The daemon. It owns terminal sessions, chats and everything a project keeps on this machine, and serves them to clients over one WebSocket. Closing a client never ends a session. A session ends on `session.kill`, when the last client holding its project sends `project.close`, or when the daemon goes down.

This file covers running and operating the daemon: flags, the CLI, what it writes on disk and where its security lines sit. Architecture, the wire protocol, invariants and product rules are in the root `CLAUDE.md` and in a `CLAUDE.md` beside the code of each area.

## Run

```sh
bun run --cwd apps/server start            # ws://127.0.0.1:4210/ws
bun run --cwd apps/server start -- --host 0.0.0.0 --port 4300
bun run --cwd apps/server dev              # ws://127.0.0.1:4211/ws, home ~/.ruimte-dev, restarts on file changes
```

The `dev` script runs on port `4211` with `RUIMTE_HOME` from `RUIMTE_DEV_HOME` (default `~/.ruimte-dev`), so a checkout runs beside an installed Ruimte (`4210`, `~/.ruimte`) without sharing its id, projects or sessions. Its door on the local network listens on `4221`. `bun src/main.ts status --port 4211` says how clients reach it.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface the API listens on. Leave loopback only for a container that publishes the port; only the local secret or a ticket from a direct channel gets in. |
| `--port` | `4210` | Port for `/ws`, `/health`, `/hooks` and the other HTTP routes. |
| `--no-hooks` | off | Write nothing into the CLIs' settings and remove nothing: no status hooks, no Codex or Antigravity rule for `ruimte-context`. The app cannot change this. |
| `--label <name>` | hostname | What the machine calls itself until someone names it from a client (`RUIMTE_LABEL` works too). |
| `--no-price-fetch` | off | Never fetch the LiteLLM price table or the exchange rate; the bundled snapshot prices everything. |
| `--no-model-fetch` | off | Never ask the address book for newer model catalogs. |
| `--stun <url>` | `stun:turn.ruimte.app:3478` | A STUN server for direct connections. Repeatable; given once, it replaces the default. |
| `--no-stun` | off | Use no STUN server, so a direct connection announces the interfaces only. |
| `--direct-ports <first-last>` | any | The UDP ports a direct connection binds (`43100-43109`, or one port). |
| `--direct-host-address <ip>` | none | An extra address to announce as a candidate, such as the one a container is published on. Repeatable. |
| `--broker <url>` | the machine's setting | Announce the machine to this Pulsar broker (`RUIMTE_BROKER_URL`; `off` turns it off). `wss://`, or `ws://` for a broker on this machine or the local network. Without it, the broker set under Settings, Machines, default `wss://broker.ruimte.app`. |
| `--no-broker` | off | Announce the machine to no broker, whatever else says otherwise. |
| `--broker-advertise <url>` | the broker | The broker URL clients are told in `endpoint.info`, when they reach it under another name (`RUIMTE_BROKER_ADVERTISE_URL`). |
| `--lan-port <port>` | `--port` plus 10 | The port of the door on the local network; `0` lets the system pick one. |
| `--no-lan` | off | Keep the door on the local network closed, whatever the machine's setting says. |

`GET /health` answers `{ ok: true, version, build, service }`, where `service` says whether the daemon runs as the background service. `POST /hooks/<claude|codex|grok|copilot|antigravity>` takes a hook payload from an agent CLI; other kinds answer 404. Everything else goes over `/ws` in the frames of `packages/contracts`.

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

`bun run compile` (`scripts/compile.ts`) builds one executable with `bun build --compile` into `dist/<os>-<arch>/ruimte`, with `ruimte-context` and `ruimte.build` beside it. For Windows it adds `ruimte-context.exe`, a launcher (`apps/context-launcher`) that starts `ruimte.exe context` with the arguments untouched, so cmd and PowerShell never pass an agent's words through a batch file. That takes cargo, plus the MinGW target and linker off Windows.

It builds for this machine, or for another with `--os mac|linux --arch arm64|x64`. `--target darwin-arm64` names the target the way the npm packages do, and `--outdir` picks the folder. A macOS binary compiles only on macOS, since `codesign` has to repair the signature Bun leaves. `RUIMTE_VERSION` stamps a version in. The desktop app packages the folder as its `bin` resource.

## Crash reports

A release build always reports crashes and errors, and nothing else (`src/telemetry`). `scripts/compile.ts` stamps `RUIMTE_TELEMETRY=1` only when CI compiles a release, so `bun dev`, the tests and a local compile send nothing. A report goes out for:

- an uncaught exception or rejection, before the process exits (two seconds at most)
- a helper that ends while the daemon still needs it (the database helper, the Apple Foundation Models helper, a language server Ruimte ships), with its exit code or signal and last stderr lines; not after SIGTERM, SIGINT or SIGHUP, and nothing once shutdown began
- an event loop stuck for five seconds, seen from a worker thread, without a stack. A worker that missed its own ticks was suspended with the process (machine sleep) and does not report. Stall and recovery also write a log line, release build or not.

Under the same stamp and scrubber (`src/telemetry/reporter.ts`) go a session per run without a user, every `console.warn` line (first line only), up to 30 breadcrumbs of fixed words (`DAEMON_MOMENTS`), and four metrics: `daemon.request.duration` by request area, `daemon.loop.lag`, `daemon.memory` (resident MB) and `daemon.clients` by kind. Metrics gather in a quarter-hour window (`startQuarterMeter` in `@ruimte/telemetry`), sent every 15 minutes and on shutdown.

Each report carries the version, platform, architecture and launcher (`service`, `desktop` or `standalone`). The binary ships without a source map: its frames point into the bundle, and Observatory maps them back with the map `scripts/compile.ts` keeps in `dist/<os>-<arch>.symbols` under the build's debug id (`src/telemetry/debug-id.ts`), which a release uploads (`scripts/upload-source-map.ts`). The same error goes out at most once a day (`telemetry/sent.json`).

An allow-list in `@ruimte/telemetry` builds every payload: stack frames without source lines or variables, the error type, the first line of its message, and fixed tags. The scrubber strips home, user and host names, project names and folders, the local secret, anything shaped like a credential, e-mail and IP addresses, URL paths, SQL, paths and quoted text. Never sent: wire traffic, prompts and chats, file contents, terminal output, environment variables, cookies, the machine's name or address.

The serving daemon prefixes every log-file line with an ISO timestamp; terminal output stays as is.

## Usage statistics

A release build also counts how the machine is used and sends daily totals (`src/stats`), apart from crash reports and under the same stamp. The machine setting `usageStats` turns it off: nothing is counted, and unsent days are deleted with the last active week and month.

`UsageCounter` counts in memory per UTC day and writes `usage/stats.json` at most once a minute and on shutdown, keeping today and the seven days before. A once-a-day count remembers its keys (project, view, session or machine id) in memory for that day only; they are never written or sent. Every name comes from the allow-list `USAGE_REPORT_COUNTERS` in `packages/pulsar/src/usage-report.ts`. A dotted name is one value of a dimension, with `other` where the set can grow, so nothing a person typed becomes a name.

It counts distinct projects and views opened, terminals, new chats and turns (by provider, model family via `usageModelFamilyOf` and runtime mode), usage limits and resumes, verbs and delegations, launches, worktree merges, clients by kind and peers, files opened and saved, git actions, PR-watches, database queries, device boots, Voice sessions and peer tasks, plans and visuals. The app hands over dictations, connections, startup time and timings with `usage.count`, `usage.startup` and `usage.timing` (local secret only). Each count is one call at its site (`countUsage` in `src/stats/usage-stats.ts`).

`packages/pulsar/fixtures/usage.json` is a batch the daemon's own serializer made (`src/stats/usage-fixture.test.ts`), the contract Observatory builds against. A change to what goes out changes it, and Observatory takes the new one before the release that sends it.

Finished days go to Observatory (`usageIngestUrl` in `packages/telemetry`), up to 32 KB per batch, at daemon start and whenever a client lists the providers; nothing runs on a clock. A day is dropped after a 204 or a 400. After any other failure it waits for the next try, at most every ten minutes or after `Retry-After` (up to a day), until it is seven days old. A day carries version, platform, arch, launcher, whether the machine was on an account, and the counts; no id, key, name, path or content. `--no-model-fetch` does not stop usage.

## The `ruimte` CLI

A machine without the desktop app runs the same binary from npm (`packages/npm`), with Node or Bun:

```sh
npx ruimte                                # the daemon, with every flag above
npx ruimte login                          # onto an account with a code
npx ruimte status                         # how clients reach it (--check, --json)
npx ruimte logout                         # off its account again
npx ruimte service install [flags]        # the background service for this user
npx ruimte service status
npx ruimte service uninstall
npx ruimte closed-lid install             # let keep awake hold a closed lid on a Mac (asks for sudo)
npx ruimte closed-lid remove
npx ruimte notify [--node <id>] <text>   # a notification from a script, which opens that node
npx ruimte voice key set|clear|status     # the OpenAI key of Voice run by the daemon
npx ruimte --version
```

A bare `ruimte` at a terminal prints its address and the commands; under the service or the desktop app it logs one `listening on` line. It tries the port before reading its home, so a second start leaves no trace. A taken port exits 1, naming the Ruimte that holds it when that answers `/health`.

`ruimte login` puts the machine on a Pulsar account. Run it as the user and with the `RUIMTE_HOME` of the daemon (and `--port` when it is not `4210`). It prints `https://station.ruimte.app/link?code=BCDF-GHJK`, the code and the machine's key fingerprint. A person opens the page, signs in, checks name and fingerprint and presses "Add to my account"; the daemon then signs a registration and the command exits 0. A denied, expired or withdrawn code exits 1, and Ctrl+C withdraws the code and exits 130. A machine on another account refuses (see "One account per machine").

`ruimte logout` takes the machine off its account. `ruimte status` asks the daemon on the local secret (`GET /machine/status`) for its version, service state, name, account, broker, door addresses, keep awake, and whether other devices reach it. The reach check runs when the broker takes the machine, after a network change, and on request (`--check`, or `endpoint.reach`); `src/pulsar/reach-classify.ts` names one cause with a fix. `--json` prints the whole answer. It exits 0 when the daemon answers, else 1.

`ruimte notify` raises a notification like `ruimte-context alert`: on every window and as a push, under the node's title. It needs the local secret (`POST /machine/notify`). It names a node with `--node <id>`, or else the Ruimte terminal it runs in (`RUIMTE_SESSION_ID`). The text is at most 500 characters. It exits 0 once queued, and 1 without a secret, a node, a daemon or a project that holds the node.

`ruimte service install` copies `ruimte` (on Windows `ruimte.exe` and `ruimte-context.exe`), `ruimte-context` and `ruimte.build` to `$RUIMTE_HOME/bin` and writes the LaunchAgent or systemd user unit the desktop app writes, pointing at that copy, never the npx cache. The unit carries the flags after `install`, the shell's PATH (without npx's folders) and `RUIMTE_SERVICE=1`. A newer version replaces the copy and the service moves to it once idle; different flags restart it. It refuses a service that runs another program, such as the desktop app's. On Linux it prints `loginctl enable-linger <user>` when lingering is off. `uninstall` removes the service, definition and copy, leaving the rest of `$RUIMTE_HOME`. `status` exits 0 only when installed and answering on `--port`.

`ruimte voice key set` saves the OpenAI key for Voice in `$RUIMTE_HOME/voice/openai.json` (0600 in a 0700 folder). It reads the key without echo at a terminal, else from stdin (`pbpaste | ruimte voice key set`), and refuses it as an argument. `status` says whether a key is set; `clear` removes it. The daemon reads the file at each Voice start, so no restart is needed. The desktop app hands over its key with `POST /machine/voice-key` on the local secret.

`ruimte context` is the agent-side CLI behind `ruimte-context` (see "Context links").

## Machine settings

`endpoint.json` holds the machine's settings beside its id and key pair. Clients read them through `endpoint.info` and `endpoint.changed`, and any client the machine let in changes them with `endpoint.setIdentity`, unless noted.

| Setting | What it does |
| --- | --- |
| `name`, `icon` | The machine's name and Lucide icon. A null name falls back to `--label`, `RUIMTE_LABEL`, else the hostname. |
| `agentsDeleteAnyView` | Lets an agent's `view delete`, `node delete` and `link delete` remove what it did not make. Off by default. |
| `reachOpenProjects` | Lets an agent's `--project` read the other projects open on this machine, message their terminals and chats, and start agents there. Off by default. |
| `resumeAtReset` | Resumes a chat that stopped on a limit, on a clock. Off by default; a chat's own switch can say no. |
| `visualReplies` | Lets an agent in a chat show a page above its reply. On by default; written only as `false`. |
| `streamingAllowed` | Browser pages and device screens stream to clients. On by default. |
| `appleFoundationEnabled` | Offers the Apple on-device model as a chat provider. |
| `keepAwake`, `keepAwakeOnBattery`, `keepAwakeDisplay` | Block sleep `off`, `working` (while an agent works) or `always`; on the adapter only unless battery is allowed; the display only under `always`. |
| `keepAwakeLidClosed` | Also hold with the lid closed (below). |
| `broker` | The broker this machine announces itself to, or off. |
| `lanDoor` | Whether the door on the local network is open. |
| `worktreeRoot` | The folder new worktrees go in; absent is `worktrees` in the data folder. Local secret only. |
| `usageStats` | Sends the daily usage counts of a release build. On by default; written only as `false`. Local secret only. |
| `nodeSizes` | The size a new node starts at, by kind, for people and agents alike. Missing kinds take `NODE_SIZE` in `packages/contracts`. Set one kind at a time with `endpoint.setNodeSize`; no verb changes it. |

Keep awake is the daemon's own (`src/power/keep-awake.ts`), so it holds with no window open. On macOS it is a `caffeinate -w <daemon pid>` child, so a dead daemon never leaves the Mac awake. Elsewhere `keepAwakeAvailable` is false.

`endpoint.json` stays at `version: 1` and gains only optional fields, since a bump would make an older daemon mint a new id. A field that will not read is dropped and the id and key pair survive. A file that will not read at all becomes `endpoint.json.corrupt-<time>` before a new id is minted, so the old key pair can be put back by hand.

### With the lid closed

macOS sleeps on a closed lid whatever assertion is held, so `keepAwakeLidClosed` runs `pmset -a disablesleep 1` while the block holds (`src/power/closed-lid.ts`). The daemon never holds root. A person installs a sudoers rule once, `/etc/sudoers.d/ruimte-closed-lid-<uid>`, that lets this user run exactly `/usr/bin/pmset -a disablesleep 1` and `/usr/bin/pmset -a disablesleep 0` (no dot in the name, since sudo skips such files). `ruimte closed-lid install|remove` does this from a terminal and prints the rule; the app uses `endpoint.closedLidRule`, local secret only. While sleep is off the daemon keeps `power/closed-lid-held` and a detached watchdog that turns sleep back on once the daemon is gone. A start that finds sleep disabled with that marker turns it back on; without the marker it leaves it alone. `src/power/CLAUDE.md` has when it holds.

### Updates of the desktop app

`endpoint.info` carries `update`, where the desktop app on this machine stands with its next version, reported by the app with `endpoint.reportUpdate` (local secret only). Any client may call `endpoint.installUpdate`: `confirm: false` lists the terminals and agents a restart would end, `confirm: true` hands the install to the app. Without an app connected it answers `update-no-app`.

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
  pr-watches.json                  the PR-watches a person turned on, per chat
  launch-after-settle.json         per project, the task a person chose to run after a worktree chat settles, and the last turn each chat ran it for
  push-attention.json              the alerts pushed in the last 30 days, which clients mark nodes from
  apple-mcp.json                   optional, written by a person: the MCP servers the Apple chat provider may use
  telemetry/sent.json              0600, hashes of the errors a release build reported in the last day
  bin/                             the copy of the binaries `ruimte service install` runs
  projects/<projectId>.local.json  camera, focus, grid and panels, where a client that never saw the project starts
  scratch/                         the Chats project (see "Projects")
  worktrees/
    <repo>-<hash>/<branch>/        a worktree the daemon made, unless `worktreeRoot` sends new ones elsewhere; nothing removes it on its own
    worktrees.json                 what git cannot say about them: branch, from, project, node, who made it (stays here either way)
  bundles/<id>.bundle              0700, a git bundle for another machine to read with `bytes.read`; cleared at start, each file gone once read to the end (a client holds at most 4, the machine 16 unread)
    incoming/<id>.bundle           0700, a bundle another machine is sending with `git.bundlePut`; removed after `git.fetchBundle`
    peers/<hash>/                  0700, the same two folders per peer machine, so no machine reaches another's bundles; cleared at start
  peer-worktrees/                  folders made from another machine's work, recorded as untrusted (src/peering/CLAUDE.md)
  oneshot/                         the empty folder a one-shot CLI run in an untrusted folder works in
  hidden-agents/<id>.json          agents a chat view started outside the canvas, with their placement
  sessions/                        0700
    <sessionId>.txt                serialized screen plus scrollback of one session
    <sessionId>.agent.json         the agent CLI last seen in that session, for a cold resume
  shell-integration/zsh/.zshenv    the shim a zsh session loads first; it keeps a person's own startup files
  prompts/<nodeId>.json            0700, the first prompt of an agent node until its session or chat exists
  outbox/<id>.json                 0700, work the daemon still owes (src/outbox/CLAUDE.md)
  tasks/<taskId>.json              0700, a task a chat gave a node it opened
  lineage/<nodeId>.json            0700, who opened a node, its depth, its mode ceiling and when it was ended
  start-claims/                    what a retried agent start with the same `--request-id` answers, for a day
  peers/<machineId>.json           0700, a machine that works in a project here: its label and, per project, the ceiling of its agents
  remote/<projectId>.json          0700, which node of the project runs on another machine, as node id to machine id
  command-approvals/<hash>.json    0700, a command, launch or routine a person approved for a node, or a task for the project's worktrees
  editor-templates.json            0600, a person's live and postfix templates and template switches (src/templates/CLAUDE.md)
  routine-runs/<runId>.json        what each run of a routine did here (src/routines/CLAUDE.md)
  routine-authors/<hash>.json      the agent chat that last made or changed a routine, for the approval card
  mode-approvals/<hash>.json       0700, the permission mode a person's save gave a terminal agent
  notices/<nodeId>.json            0700, messages left for a node until its agent picks them up
  database-access/<projectId>.json 0700, what agents may do with each connection (see "Databases")
  secrets/<hash>.json              0700 folder, 0600 files: the secrets of a project's launches (see "Launch secrets")
  voice/openai.json                0700 folder, 0600 file: the OpenAI key of Voice run by the daemon (`ruimte voice key`)
  voice/preferences.json           the language and voice Voice speaks on this machine (`voice.setPreferences`)
  database-snapshots/<projectId>/<connectionId>/<database>.json
                                   schema snapshots the SQL language servers read, gone with their connection or project
  chats/                           0700
    <chatId>.json                  the thread and info of one chat, with the seq it holds
    <chatId>.log                   every event since that snapshot, one `{ seq, at, event }` per line
    <chatId>.payloads/<sha256>.gz  the whole of a large tool output or turn diff whose beginning the record keeps
    <chatId>.bookmarks.json        bookmarked messages
    <chatId>.plans.json            the chat's plans (src/chat/CLAUDE.md)
    <chatId>.visuals.json          the pages agents showed in that chat
    <chatId>.visuals/              editable HTML sources and preview pngs of those pages
  chat-moves/                      a move of a chat out of Chats under way, finished or undone at the next start
  attachments/<chatId>/            0700, files attached to messages, generated images and visual pages
  artifacts/                       Output: published files and their versions (src/artifacts/CLAUDE.md)
  checkpoints/<repo>-<hash>.index  0700, the private git index a turn's checkpoint is written through
  provenance/<projectId>/<hash>.json
                                   0700, which chat wrote which lines of a file
  computer-use/                    0700, shared with the computer use helper
    settings.json                  whether computer use is on, and the language it speaks
    grants.json                    apps let in for always, and apps seen running shells
    overlay.json                   the words of the helper's cursor, session bar and menu
    agent.sock, screenshots/       the helper's own (apps/computer-use/README.md); captures swept after an hour
  browser/                         the profile of the pages the daemon runs for clients without a browser
  screenshots/                     pngs `browser shot` and `device shot` wrote, swept after a day
  device-captures/                 a person's screenshots and recordings of a device, read over `bytes.read`, swept after a week
    placed/                        the screenshots a person placed on a canvas (`device.importCapture`), never swept
  anthropic-claude-api/            0600 key, model list, settings and conversations of the Claude API provider
  nanogpt/                         0600 key, model list, settings, conversations and usage log of NanoGPT
  agent-servers/antigravity/       Google's ACP server for Antigravity chats, put here by a person's Install
  agent-registry/                  the agents of the ACP registry (see "Providers and models")
    registry.json                  the last registry document read, shown when the registry cannot be reached
    agents/<id>/                   one folder per agent a person installed
      installed.json               the verified version and how it starts, written last
      <version>/                   the unpacked server and its helper
  language-servers/
    choices.json                   which server this machine uses where kinds are alternatives (none are today)
    custom.json                    a person's own language servers
    <kind>/                        one folder per installed kind (see "Language servers")
    packages/<setId>/              shared, immutable npm package sets the installs link to
  usage/                           0700
    scan-state.json                a cache of where the scanner left each transcript
    history.jsonl                  the usage of every transcript ever read, which cannot be rebuilt (see "Usage")
    stats.json                     0600, the usage counts of the last eight days (see "Usage statistics")
    prices.json                    the last LiteLLM price table
    exchange-rate.json             the last euro rate for a dollar
    copilot/<session>.jsonl        0600, the usage of every Copilot chat turn, which its CLI keeps nowhere the scanner reads
  models/catalogs-v2.json          0700, the last model catalogs from the address book
  models/catalogs.json             0700, the same from `/v1`, read only until the first v2 answer
  models/agents/<kind>.json        0600, the models, effort and commands an ACP agent (Grok, Copilot, Antigravity) last reported
  power/closed-lid-held            0700 folder, present while sleep is off for a closed lid
```

The desktop shell and helpers add `speech.json` and the speech models under `models/`, and `apple-foundation/` for the Apple helper's sessions, which go with their chat. The shell removes the obsolete `models/coreml-cache` at start.

Disposable files expire on the rule of their writer: `screenshots/` after a day, `device-captures/` after a week (never `placed/`), the computer use helper's captures after an hour, and a temporary write in `chats/` (`<file>.<pid>-<n>.tmp`) after a day. Each folder is swept on a new write, and by a maintenance pass at start and every hour while no agent is in a turn (`src/maintenance`). A pass reads at most 5000 entries and removes at most 1000 files per folder, only regular files whose name or time says they expired, and stops between files on shutdown.

File names are the id through `encodeURIComponent`, so an id never names a path outside its directory. One home belongs to one daemon: two daemons on one `RUIMTE_HOME` are two machines a client cannot tell apart.

## Projects

Root `CLAUDE.md` and `src/projects/CLAUDE.md` cover the two project files, sharing, revs, holds and closing. For an operator:

- Both files put every node, text, line and arrangement on its own line, so two added nodes do not collide in a diff. Every write is a temp file plus rename.
- A project file that does not parse moves aside as `project.json.corrupt-<timestamp>` and a fresh canvas takes its place.
- `project.open` refuses a folder whose canvas uses node ids another open project uses (`project-ids-taken`), as two checkouts of one repository do. Close the other first.
- `project.delete` forgets the project and, when asked, removes the canvas file, never other files.
- The Chats project lives in `$RUIMTE_HOME/scratch`, one folder per chat that nothing removes. A home inside a git checkout answers `scratch-unavailable`.
- An agent in Chats suggests making its chat a project with `ruimte-context project propose`. The daemon raises one card per chat (`chat.proposals`) and holds the chat at `needs-you`; a person moves the chat (`chat.move`) or declines (`chat.proposalDecline`). The verb answers `waiting` at once and reports `declined` with the next suggestion. A card lapses after a day without a new suggestion, or when the chat stops or leaves Chats.
- Without a chosen icon the daemon looks in the folder (`.ruimte/icon.*`, IDE icons, favicons), jailed to it, sniffed by magic bytes, at most 256 KB. `GET /projects/<projectId>/icon` serves it behind the `/ws` access rules, with `nosniff` and, for an SVG, a policy that runs nothing.
- An inline edit in the editor runs in a hidden chat view in the private project file (`src/projects/inline-chat.ts`). The client asks to remove old ones after seven days.

## Drawings

A drawing or diagram lives in `.ruimte/drawings/<viewId>.json` while its view is shared and `.ruimte/private/drawings/<viewId>.json` while not. Both folders are watched. An untouched drawing leaves no file. Broken JSON is set aside as `<viewId>.json.corrupt-<timestamp>`; valid JSON that is no drawing stays and answers `drawing-invalid`. A view removed by an outside edit of `project.json` never takes its file along, since a pull can drop a view whose file is still on its way.

## Databases

A project's connections live in `.ruimte/databases.json` (shared) and `.ruimte/private/databases.json` (this person's, with `rev` and order), through `src/database/connection-store.ts`. A connection is private until a person's save shares it, and a SQLite file outside the project cannot be shared. No password lands in either file: a save drops `config.password`, since the desktop app keeps passwords in its own secret store.

`database.request` carries one message of `@adecore/database`'s protocol to a native helper: `native/adecore-database` beside a compiled daemon, else `RUIMTE_DATABASE_HELPER`, else what `helperPath()` of `@adecore/database` finds (`ADECORE_DATABASE_HELPER`, the platform package in `node_modules`, or a linked checkout's release build). Without one every request answers `helper-unavailable`. It runs with the daemon's `PATH`, so `ssh` and `docker` resolve, and logs its stderr as `[database] <line>`. Requests are never logged, since `open` and `test` carry the password. A SQLite file under `$RUIMTE_HOME` never opens. Export and import are local secret only.

Passwords reach the daemon only through `database.passwords` from a project client, kept in memory and bound to where the connection pointed (`src/database/agent-passwords.ts`). Agent access per connection lives in `$RUIMTE_HOME/database-access/<projectId>.json` (`off` or `write`; unlisted is `read`). Any project client may set `off` or `read`; only the local secret sets `write`. Schema snapshots for the SQL servers go to `database-snapshots/` from a read-only session, with no credential or row (`src/database/schema-snapshots.ts`). `src/database/CLAUDE.md` has the rules for agents.

## Launch secrets

An agent in an AI chat asks for a secret a launch needs with `ruimte-context secret request` (`src/canvas/secret-verb.ts`). The daemon raises a card in that chat (`secret.requests`, `src/secrets/secret-requests.ts`) and holds the chat at `needs-you`. One card stands per chat, launch and variable; it goes when the turn ends, the chat stops, or 15 minutes pass without a new ask. The verb answers only `saved`, `declined`, `cancelled`, `timed-out` or `waiting`, never the value.

A person answers with `secret.save` or `secret.decline`. The value goes into `$RUIMTE_HOME/secrets/<hash>.json` (`src/secrets/secret-store.ts`), one 0600 file per project. The launch gets the marker `ruimte:secret` (`LAUNCH_SECRET_REFERENCE`) in this machine's own launch file, and the approval covers the marker, not the value. A new value changes nothing an approval covers; a marker added or removed outside a person's save asks again. Only the started process gets the value (`resolveEnv` in `src/launches/runner.ts`); a marker without a secret leaves the variable unset.

The value is never in a project file, chat log, event, agent reply or log line, and no verb or client file request reaches `secrets/` (`src/fs/machine-home.ts`).

## Sessions

- A session is keyed by the id the client chooses. `session.create` on a running id answers `session-exists`; on an ended one it starts a fresh shell below the old screen and a `[session restored, previous shell ended]` line.
- The shell is `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere) as a login shell, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `RUIMTE_SESSION_ID`.
- Each session runs a headless xterm with 10000 lines of scrollback. A screen over 4 MB as JSON loses its oldest scrollback until it fits (`src/sessions/fit-screen.ts`), since a frame past 16 MB closes the socket.
- Several clients may attach; the last attacher's size wins.
- Past 1 MB buffered on a socket (`src/backpressure.ts`) a client's output stops, and on drain each session that lost bytes sends `session.resync`.
- An exited shell stays in `session.list` as `exited` with its `exitCode` until `session.kill`.
- `session.create` takes `command` or `agent`, never both. With `agent` the daemon builds the launch line (`src/providers/launch.ts`). A line over 1000 bytes goes into `RUIMTE_START_LINE` and `eval "$RUIMTE_START_LINE"` is typed instead, since macOS cuts the tty's input queue at 1024 bytes.
- `session.login` types a CLI's login command for an account, ends with the asking client's socket and writes no snapshot.
- After a restart a restored session's agent comes back with `live: false` (from `sessions/<id>.agent.json`), and the client answers with `agent.resume`, which types the CLI's resume line, or the session's launch line when the transcript is gone. A second `agent.resume` within 15 seconds answers `agent-resuming`.

`session.ports` lists the TCP listeners of a session's process tree, for opening a dev server. macOS reads them with libproc and `/usr/sbin/lsof`; other platforms answer `unavailable`. Only loopback and wildcard bindings are offered, and a port another process could own answers `unknown`. Scans are cached five seconds and bounded. `session.verifyPort` rechecks one port before it opens, local secret only.

## Snapshots

A pass every 10 seconds writes each quiet session's screen to `sessions/<sessionId>.txt` (temp file, then rename), and a busy one every 3rd pass, so a crash loses at most 30 seconds. `SIGINT` and `SIGTERM` write every changed screen. After a restart the first attach shows the snapshot, the restored marker and a fresh shell. `session.kill` deletes the snapshot. On shutdown chats are written first and synchronously (`ChatManager.persistAllSync`), since a `bun --watch` reload restarts the module at the first await.

## Agent status via hooks

Claude Code, Codex, Grok and GitHub Copilot report terminal status through hooks; Antigravity's CLI only reports a finished turn. A chat takes its status from the protocol. The daemon folds hook events into `running`, `needs-you`, `idle` or `error` and sends `session.status`.

The daemon writes into a CLI's global settings only for a provider a person allowed, per provider, in `$RUIMTE_HOME/agent-integrations.json` through `endpoint.setAgentIntegration` (local secret only, `forbidden` otherwise). `src/agents/CLAUDE.md` has the rules. What it writes, at startup and into every other account's config folder at launch:

| CLI | Files |
| --- | --- |
| Claude Code | one command hook per event in `~/.claude/settings.json` (`CLAUDE_CONFIG_DIR`) |
| Codex | the same in `~/.codex/hooks.json` (`CODEX_HOME`), plus `~/.codex/rules/ruimte.rules` so `ruimte-context` runs outside its sandbox, which blocks the loopback port; Codex asks once to trust new hooks (`/hooks`) |
| Grok | `hooks/ruimte.json` in `GROK_HOME` (default `~/.grok`), in Claude Code's shape |
| Copilot | `hooks/ruimte.json` in `COPILOT_HOME` (default `~/.copilot`), one `bash` entry per PascalCase event under `version: 1` |
| Antigravity | a `ruimte` hook on `Stop` in `config/hooks.json` under `GEMINI_HOME`, and `command(ruimte-context)` and `unsandboxed(ruimte-context)` in `permissions.allow` of `~/.gemini/antigravity-cli/settings.json` |

The merge is idempotent, leaves other tools' entries alone and skips a file whose shape it does not expect. Turning a provider off removes only Ruimte's unchanged entries, and a file Ruimte created once it is empty, and answers per file (`removed`, `deleted`, `kept-edited`, `missing`, `refused`, `failed`). The written paths are kept as a ledger in the same file. Two daemons with different homes share these global files with no lock, so turning a provider off in one removes what the other relies on until its next start. Under `--no-hooks` the choice cannot change (`integrations-fixed`).

Grok and Copilot also run Claude Code's hooks; such a hook never counts for Claude Code (`borrowedHook`, `src/agents/hooks.ts`).

Every shell gets `RUIMTE_HOOK_URL` (`http://127.0.0.1:<port>/hooks`) and a per-session `RUIMTE_HOOK_TOKEN`. The hook POSTs its stdin to `$RUIMTE_HOOK_URL/<kind>` with the token as bearer and does nothing outside Ruimte. On `SessionStart` and `UserPromptSubmit` the reply carries `additionalContext`, which tells a terminal agent about `ruimte-context`, its links and messages. A Codex a node launches gets `--no-daemon` when `codex --help` names it, so its shared server does not run hooks with another terminal's environment.

## Permission requests

A terminal agent's permission request is answered in its CLI's prompt; the hook only sets `needs-you`. An AI chat's approvals are answered with `chat.approve`.

## Computer use

An agent operates the apps of this Mac through `ruimte-context computer`, carried out by the helper app in `apps/computer-use` (`src/computer`). `apps/computer-use/README.md` covers the helper and `src/computer/CLAUDE.md` what the daemon enforces.

The helper is `Contents/Helpers/Ruimte Computer Use.app` in Ruimte.app and `apps/computer-use/dist/Ruimte Computer Use Dev.app` in a checkout. The daemon starts it with `open -g <app> --args --home $RUIMTE_HOME` on first need and quits it when the feature is turned off or the daemon stops. A daemon from npm or on Linux has no helper and answers `unavailable`. `computer.restart` relaunches it, since macOS applies a Screen Recording grant only to a fresh launch.

## Devices

A device node shows a simulator, emulator or phone on this machine (`src/devices`). `DeviceManager` keeps one capture session per device, shared by every client and agent. A person starts, stops, restarts and (after confirming) erases a simulator or emulator, and drives it with pointer, keyboard, buttons, fold menu and tools panel. An agent with a line drives it through `DeviceDriver` (`src/devices/agent-driver.ts`, `ruimte-context device`) and reads an Android clipboard, never a simulator's pasteboard, which follows the Mac's. What agents may do is in `src/devices/CLAUDE.md`.

| | iOS simulator | Android emulator |
| --- | --- | --- |
| Needs | macOS with Xcode (`xcrun simctl`) | the Android SDK on macOS or Linux: `adb` from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, PATH or the default folder, the `emulator` package to start one, AVDs in `ANDROID_AVD_HOME` or `~/.android/avd` |
| Start and stop | `simctl boot` and `shutdown` | `emulator -avd <name> -no-window` on a free console port, logging to `$TMPDIR/ruimte-emulator-<avd>.log`; `adb emu kill` |
| Screen and touch | the native helper `device-helper`, JPEG or HEVC | the pinned scrcpy server (`src/devices/scrcpy-server.ts`), H.264, pushed to `/data/local/tmp` per session |
| Shot | `simctl io screenshot` | `adb exec-out screencap -p` |
| Capture | the shot, written to `device-captures/` | the same |
| Clipboard | `simctl pbpaste` and `pbcopy` | scrcpy `GET_CLIPBOARD` and `SET_CLIPBOARD`, only while the device is open |
| Status bar | `simctl status_bar override` (9:41, full bars, charged); `clear` | SystemUI demo mode (`sysui_demo_allowed`, `com.android.systemui.demo`); `exit` |
| Battery | `status_bar override --batteryLevel --batteryState`, status bar only | `adb emu power capacity` and `power ac` on an emulator, `dumpsys battery set` and `reset` on a phone |
| Biometrics | `notifyutil`: `com.apple.BiometricKit.enrollmentChanged`, `BiometricKit_Sim.pearl` (Face ID) and `fingerTouch` (Touch ID) `.match` or `.nomatch` | `adb emu finger touch 1` (match) or `99` (no match), emulator only |
| Shake, memory warning | `notifyutil -p com.apple.UIKit.SimulatorShake`; memory warning through the native helper, only while open | none |
| Install | `simctl install` of a simulator `.app`; an iPhone takes `.app` or `.ipa` through `devicectl device install app` | `adb install -r` of an `.apk` |
| Media | `simctl addmedia` of png, jpg, jpeg, heic, gif, mp4 or mov | `adb push` to `/sdcard/Pictures` or `/sdcard/Movies`, then a media scan |
| Fold | iPhone Duo with Xcode 27.1 and the iOS 27.1 runtime: five poses and a free angle through `serve-sim-duo-hid` (`src/devices/fold-panel.ts`) | an AVD with `hw.sensor.hinge = yes`: `adb emu fold` and `emu unfold`, hinge read from `cmd device_state state` |
| Camera | per named app: `serve-sim-camera-helper` feeds a pattern, picture or video, the app relaunched with `libSimCameraInjector.dylib` (`src/devices/simulator-camera.ts`); never the Mac's camera | none |
| Erase | `simctl erase` on a shut-down simulator | restart with `-wipe-data`; a phone is never erased |
| Record | `simctl io recordVideo --codec=h264`, ended with SIGINT, stops itself after 10 minutes | `screenrecord --time-limit 180`, ended with `pkill -INT screenrecord`, then pulled and removed |
| Elements | the device bridge (`apps/ios-device-bridge`) | `uiautomator dump` |
| Typing | pasted through the simulator pasteboard and Cmd+V | pasted through the device clipboard over scrcpy |
| Keyboard | HID usages through the native helper | Android key codes with meta state over scrcpy |
| Settings | `simctl ui` and the accessibility helper of `serve-sim` | `settings`, `cmd uimode`, `setprop` and `pm` |

The clipboard tools use the clipboard of the client a person sits at, not the machine's. Typing replaces the device's clipboard; newline is Return and tab is Tab. Nothing is installed on an Android device.

An Android phone on USB or Wi-Fi debugging is listed by serial with the same tools, but cannot be started, stopped or given a location. An iPhone streams through the device bridge and takes touch, shots, captures and `devicectl` installs, but no text or elements.

An Android emulator also cannot clear a location, receive a local push, rotate to a chosen side, read elements of a screen that never stands still (`tree none`), record past 3 minutes, switch its camera while running or enroll a fingerprint. Typing on Android needs version 7 or later.

A path to install or add is a file on the machine, never an upload; one that is not absolute or lies under `$RUIMTE_HOME` answers `device-path-refused`. A checkout downloads the scrcpy server on first use into `.native`, checked against its pinned checksum; a build carries it in `native/`, and without it a device has no screen, touch or typing.

## Providers and models

Each agent CLI is one `ChatProvider` (`@adecore/agents`). The daemon's list is `src/providers/registry.ts`, ordered by `src/providers/kinds.ts`: Claude Code, Codex, Antigravity, GitHub Copilot, Grok, the Apple on-device model (when turned on), NanoGPT and the Claude API. `provider.list` answers per CLI whether it is installed, its version, models, resume template, capabilities and install instructions. Detection is cached a minute; `provider.detect` clears it (at most every ten seconds), which a client asks on window focus and when the Providers pane or an agent menu opens.

A kind is an open word on the wire (`AgentKindSchema`, lowercase, at most 32 characters), so an older client draws an unknown kind with a neutral mark. A kind this daemon does not offer starts nothing and is not counted in usage.

Copilot and Grok chat over the Agent Client Protocol (`createAcpProvider`). The daemon starts `copilot --acp --stdio --no-auto-update --allow-tool=shell(ruimte-context:*)` and `grok --no-auto-update agent stdio`, keeps the models, effort and commands they report in `models/agents/<kind>.json`, and sends `provider.changed` when that changes. Only `supervised` maps to a session mode (`agent` for Copilot, `default` for Grok); the backend answers permission requests a wider mode allows. Grok signs in with `XAI_API_KEY`, else the login `grok login` left in `GROK_HOME` (default `~/.grok`), and checks it with `grok --no-auto-update models`. Copilot keeps its login in the system credential store (`copilot login`, or `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`) and has only its default account. Install Copilot with `npm install -g @github/copilot` (or Homebrew `copilot-cli`) and Grok with `curl -fsSL https://x.ai/cli/install.sh | bash`.

Antigravity's terminal is `agy`, installed with `curl -fsSL https://antigravity.google/cli/install.sh | bash` into `~/.local/bin` (Windows: `irm https://antigravity.google/cli/install.ps1 | iex`); it signs in through the browser on first start. Runtime modes map to `--mode=accept-edits` (`auto-accept-edits`, `auto`) or `--dangerously-skip-permissions` (`full-access`); a first prompt is `-i`, a resume `--conversation <id>`.

Its chat runs on Google's ACP server, pinned with per-platform sha256 in `src/providers/antigravity-acp-release.json`. Only a person's Install (`provider.installServer`, local secret only; `provider.server` reports it) fetches it into `$RUIMTE_HOME/agent-servers/antigravity/<version>`, verified before unpacking, with `installed.json` written last. Modes map to `default`, `auto_edit` (`auto-accept-edits`, `auto`) and `yolo` (`full-access`). Login uses `oauth-personal` in the browser and lives under `GEMINI_HOME` (`~/.gemini` for the default account, a folder per other account). Add account makes a folder; the first chat signs it in.

Any other agent of the public ACP registry (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`) is added from Settings, Providers, Add provider (`provider.registry`, read at most hourly, cached in `agent-registry/registry.json`). Only a person's Install (`provider.installAgent`, local secret only) fetches it into `agent-registry/agents/<id>/<version>`, checked against the registry's sha256 where given, or through `npm install --prefix` or `uv tool install`. Each is a chat-only provider of its own kind; `provider.removeAgent` removes one.

`provider.versions` says how each CLI and server was installed and whether a newer version exists, without starting it (`src/providers/cli-versions.ts`); `provider.update` (local secret only, never on a clock) upgrades through the same route.

Ruimte no longer offers Gemini: a node with `provider: 'gemini'` keeps it and opens a plain shell saying the CLI is unavailable.

A release ships model catalogs as `<kind>-models.json` in `@adecore/agents/providers`. The address book serves the live ones on `GET /v2/models/catalog` (`apps/pulsar-worker/README.md`). The daemon asks at start and on `provider.list` once the last answer is fifteen minutes old, keeps it in `models/catalogs-v2.json`, and never takes a catalog older than the bundled one. `--no-model-fetch` turns this off.

The runtime mode (`supervised`, `auto-accept-edits`, `auto`, `full-access`) is one vocabulary that each provider maps to its own flags. `ruimte-context` runs without a prompt in every mode, since the daemon checks each verb itself: Claude Code gets `--allowedTools=Bash(ruimte-context *)`, Copilot `--allow-tool=shell(ruimte-context:*)`, a Grok terminal `--allow=Bash(ruimte-context *)`, and Codex and Antigravity their rule files.

### Claude API

A chat provider with no CLI. Save an Anthropic API key in Settings, Providers, Claude API. `anthropic.configure` validates it against the model list before saving it or its settings; `anthropic.status` reports whether a key exists without returning it. Only the machine's owner configures it. Requests go only to `https://api.anthropic.com`, redirects refused. Everything lives under `$RUIMTE_HOME/anthropic-claude-api`.

Tools follow the runtime modes as with NanoGPT; there are no attachments, MCP, subagents, forks or compaction. Settings: tool rounds per run (40), maximum runs (3 when continuing is on; it is off by default since it spends credits) and output tokens per request (32000, capped by the model, thinking included). A request fails only after two minutes without data.

### NanoGPT

NanoGPT's subscription API is a chat with no CLI (`src/providers/nanogpt-provider.ts`, `src/chat/nanogpt-backend.ts`). `nanogpt.configure` checks a key against `/usage` before keeping it. The daemon only calls `https://nano-gpt.com/api/subscription/v1`, so no setting or redirect reaches pay as you go, and slugs with a suffix (`:online`) are never offered.

The key is a 0600 file in `$RUIMTE_HOME/nanogpt`, which no client reads; only the owner sets or removes it. `supervised` asks for every tool, `auto-accept-edits` and `auto` ask only for commands, `full-access` for none. An `ask_user` tool opens a question card in every mode. Settings (`nanogpt/settings.json`): `roundsPerRun` (40 by default, 5 to 200) and, with continuing on by default, `runs` (5 by default, 1 to 20). Models group by `vendor` (`src/providers/nanogpt-vendor.ts`). Every call appends to `nanogpt/usage/<year>-<month>.jsonl`, which the scanner reads without prices; plan windows come from `/usage` on the limits monitor's clock.

## Voice for a phone

`src/voice`, `src/wiring/voice.ts` and `src/handlers/voice.ts`; `src/voice/CLAUDE.md` has the invariants. A phone opens its own WebRTC peer to OpenAI for audio. The daemon mints the GPT-Live session with the key it holds, attaches to its sideband (`wss://api.openai.com/v1/live/sessions/<id>/attach`) and runs every tool call. A phone offers Voice only when `voice.keyStatus` says a key is set.

- `voice.start` answers once the sideband is attached, within 20 seconds. `voice.stop` by `startId` cancels a pending start for good. A reused start id with other fields is `voice-start-conflict`. One session per scene, four per machine.
- Preferences `{ language, voice }` live in `voice/preferences.json`, read with `voice.preferences` and set with `voice.setPreferences` by any client but another machine. Default is English with marin.
- `projectId` in `voice.start` is only where a session starts; `project.switch` moves it within this machine. `voice.status` names the current project.
- The model hears the projects and phone time at start, the time every minute, and a new context 250 ms after a project change.
- A client event on the sideband the daemon never sent ends the session (`voice-foreign-client`).
- `setKey`, `clearKey` and `POST /machine/voice-key` are local secret only. No `voice.*` request is on a peer's list.

A dev daemon keeps its key in its own home; without `RUIMTE_HOME` the CLI writes into `~/.ruimte`:

```sh
cd apps/server && RUIMTE_HOME=~/.ruimte-dev bun src/main.ts voice key set   # asks for the key without echo
```

## Chats

The chat lifecycle and backends live in `@adecore/agents/chat`; `src/chat/chat-manager.ts` binds them, and `src/chat/CLAUDE.md` covers forks, plans, bookmarks, visuals and agent attachments. On disk:

- Every broadcast event goes to `chats/<id>.log`. Reading plays the log over `chats/<id>.json` and skips a torn last line. The log folds into the snapshot past 1 MB, on a clear and on shutdown.
- A tool output or checkpoint diff past 8 KiB goes gzipped to `chats/<id>.payloads/<sha256>.gz`; the record keeps the first 2 KiB. `chat.toolOutput` and `chat.turnDiff` answer the whole.
- A chat no client reads, without a CLI and with nothing under way, leaves memory after ten minutes and keeps only its status for `chat.list`. Opening it loads it from its record.
- A turn running when the daemon went down resumes at start through a `resume-run` outbox entry, or ends `aborted` with a note.
- Attachments are any type, at most 25 MB each and 8 per message, in `attachments/<chatId>/<id>.<ext>`. `GET /attachments/<chatId>/<id>` serves them behind the `/ws` access rules, `inline` only for what a browser paints, with `nosniff` and an immutable cache; a visual's page is always a download.
- An agent's `ruimte-context chat attach` reads the file in its own process. The verb route takes bodies up to 72 MiB; every other route stops at 24 MiB.
- A turn checkpoints the chat's folder as a git tree through a private index under `checkpoints/` (`src/git/checkpoints.ts`), leaving the person's index, stashes and commits alone.
- A hidden agent's chat is pruned at daemon start once its tasks settled over 30 days ago, no view holds it and no agent it opened lives (`src/agents/prune-hidden-chats.ts`). Its worktree stays.
- `chat.imageTarget` and `chat.saveImage` copy a generated image into the project, never into `.git`, `.ruimte` or machine state, refuse a symlink target and overwrite only with `replace` against the revision read.

## Maps

The daemon looks up no addresses, holds no map ticket and never contacts the map service (`apps/maps-worker`); the client takes tiles. A `Place` is drawn from `lat` and `lon`, and `ruimte-context help ui places` tells agents to give both.

## Language servers

`src/language` runs the editor's language servers as their one LSP client (`@adecore/lsp`), owning every document's text so all clients share what a server sees. The wire is `packages/contracts/src/language.ts`; `src/language/CLAUDE.md` has the merging, save, message, show-document, workspace-problem and trace rules.

| Kind | Package | Serves |
| --- | --- | --- |
| `typescript` | `typescript` 7 (native server), with a TypeScript 6 sidecar for code actions | TypeScript, JavaScript, JSX and TSX |
| `vue` | `@vue/language-server` with a TypeScript 6 tsserver that loads `@vue/typescript-plugin` | Vue, and the scripts of a project that uses it |
| `php-native` | the native server from `basmilius/language-server-php`, shown as PHP | PHP, `.phtml`, Blade, Twig |
| `css`, `html`, `json` | `vscode-langservers-extracted`, one install each | CSS, SCSS and Less; HTML; JSON and JSONC |
| `yaml` | yaml-language-server | YAML |
| `python` | pyright | Python |
| `bash` | bash-language-server | shell scripts (with shellcheck when it is on PATH) |
| `docker` | dockerfile-language-server-nodejs | Dockerfile |
| `eslint` | `vscode-langservers-extracted` | JavaScript, TypeScript and Vue, in a project with an ESLint config |
| `tailwind` | `@tailwindcss/language-server` | HTML, CSS, scripts, Vue and PHP, in a project that uses Tailwind |
| `sql-native` | the native server from `basmilius/language-server-sql`, shown as SQL | `.sql` files, against the project's schema snapshots |
| `rust` | rust-analyzer from the Rust toolchain, never installed by Ruimte | Rust, in a project with a `Cargo.toml` in its folder or up to three folders down |

Intelephense (kind `php`) was removed, and nothing removes a `language-servers/php` install left on disk.

Pinned npm versions are in `src/language/versions.ts`. A kind installs only on a person's Install (`language.install`). Each install has its own folder, `$RUIMTE_HOME/language-servers/<kind>/versions/<id>`, and `<kind>/current.json` names the current and previous one; a kind keeps at most two. An npm kind runs `bun install --ignore-scripts` with exact versions, through the daemon's own executable (`BUN_BE_BUN=1` in a compiled daemon), so no Node is needed. A moved pin offers Update; `language.rollback` switches back.

npm packages live in shared, immutable sets under `language-servers/packages/<setId>/` (`src/language/package-store.ts`, rules in `src/language/CLAUDE.md`), which an install links its `node_modules` to; on Windows an install keeps its own. `bun apps/server/scripts/measure-language-storage.ts [folder]` prints bytes and entry counts per folder without changing anything.

The maintenance sweep holds the PHP server's indexes in `language-servers/php-native/storage/cache` to 512 MiB, with no setting (`src/language/php-cache.ts`). It removes pruned stubs, checkouts gone for seven days (sightings in `language-servers/php-native/cache-sightings.json`), abandoned temporary files and, over budget, the least recently used caches. A pass reads at most 5,000 names and removes at most 200 files. Caches of servers before language-server-php 0.8.0 have no owner manifest and go only by age.

Native servers (`src/language/native.ts`, `installer.ts`):

- A development daemon builds a checkout with `cargo build --release --locked`: `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE` or `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE`, else `../language-servers/php` or `../language-servers/sql` beside Ruimte's checkout (or a worktree's primary checkout). Cargo comes from `PATH` or `~/.cargo/bin`.
- Without a valid checkout, and always in a compiled daemon, Install downloads the release pinned in `src/language/php-native-release.json` or `src/language/sql-native-release.json` (URL, SHA-256, format, executable per platform). The checksum must match before extraction, escaping entries are refused, and `--version` must answer the pin.
- Install downloads PHP's stubs for the server's commit; the server starts with `storagePath` and `stubsPath` and never goes online.

The `rust` kind runs the `rust-analyzer` on `PATH` or in `~/.cargo/bin` that answers `--version` (`src/language/toolchain.ts`), with `~/.cargo/bin` on its `PATH`. Without one it says to run `rustup component add rust-analyzer`; Install only looks again. It is told every `Cargo.toml` no other one holds (`linkedProjects`, `src/language/manifests.ts`).

`language-servers/choices.json` holds the kind in use where kinds are alternatives, set with `language.prefer`; none are today, so a pick an older Ruimte stored is ignored. `language-servers/custom.json` holds a person's own servers (`src/language/custom.ts`): command, arguments, environment, initialization options, languages, patterns and folders. `language.custom.save`, `remove` and `check` are local secret only; an entry edited by hand so it no longer matches its saved hash never starts until saved again.

One server runs per project per kind, from the first document that needs it until the project closes or the daemon stops. A server that ends by itself after a minute of being ready restarts once; any other end leaves it `crashed` until `language.restart`. `language.log` returns the last 500 lines of install and server, each with `source` (`stderr`, `log`, `message`, `trace`) and `level` (`error`, `warning`, `info`, `log`, `debug`). `language.trace` sets `$/setTrace` (`off`, `messages`, `verbose`) per server, in memory.

## On-device help for the editor

`src/ondevice` runs one-shot generations on Apple Foundation Models for explanations, rename suggestions and ghost text (wire: `packages/contracts/src/ondevice.ts`). It starts the Apple chat helper with `--oneshot` and keeps it until the daemon stops. Instructions per purpose live in `src/ondevice/instructions.ts`. The helper opens no connection and has no tools. More than four requests at once answer `busy`. A machine that is not an Apple silicon Mac reports itself unavailable.

## Files

File requests (`fs.read`, `fs.write`, `fs.create`, `fs.rename`, `fs.delete`, `fs.grep`, `fs.locate`, `fs.list`, `fs.browse`, `bytes.read`) live in `src/fs`, archive requests (`archive.list`, `archive.extract`) in `src/archive`.

- No file request reaches under `$RUIMTE_HOME`, by name or link, except the Chats project, worktrees, screenshots and attachments (`src/fs/machine-home.ts`); such a path answers `machine-state`.
- `fs.write`, `fs.create`, `fs.rename`, `fs.delete` and `archive.extract` work only inside a project folder the client holds or a worktree the daemon made of its repository, compared on real paths (`outside-project`). `.ruimte` at its root is closed (`ruimte-state`) except `.ruimte/private/consoles`, and `.git` at any level.
- `fs.rename` refuses a move across volumes (`other-volume`). With `overwrite` the replaced file goes to the trash (`~/.Trash` on macOS, with a `.trashinfo` on Linux).
- `fs.read` and `fs.write` refuse files over 2 MB. `fs.write` checks the mtime it read (`stale`) and never overwrites a non-text file.
- `GET /fs/file?path=<absolute>&v=<mtime>-<size>` (`src/fs/file-route.ts`) serves images, video, sound, PDFs, GLB and USDZ models and large text files behind the socket's access rules. Text goes out as `text/plain`; responses carry `nosniff`, an immutable cache and `Range` support, and an SVG gets a policy that allows only its own styles.
- `fs.grep` uses ripgrep when on PATH, else a JavaScript search.
- `archive.list` reads zip, tar, tar.gz and gzip. It lists at most 10,000 entries (`truncated`), skips unsafe names (`unsafe` counts them) and devices, and unpacks at most 4 GiB of a compressed tar.
- `bytes.read` with an `entry` hands out one archive entry up to 32 MiB.
- `archive.extract` never overwrites (`exists`), never makes a link, and skips escaping names, entries under `.git` or `.ruimte` and unreadable ones (`skipped`). Inflation stops at 4 GiB per extract and at a 200 to 1 ratio past 8 MiB, counted on actual output (`src/archive/limits.ts`).

## Remote clients

Where a request comes from never grants anything; behind a tunnel every visitor is loopback. A local process presents the local secret from `$RUIMTE_HOME/local.key` (`?token=` or `Authorization: Bearer`, compared in constant time) and is the owner (`isOwner` in `src/auth/access.ts`). The desktop app hands it to its page over the bridge; `ruimte login`, `logout`, `status` and `bun run smoke` read it from `RUIMTE_HOME`.

Every other client comes in through the account, on an address book statement carried in the offer of a direct connection: a WebRTC DataChannel (`src/pulsar/peers.ts`) whose signals arrive over the broker (`src/pulsar/broker-relay.ts`) or the door on the local network, both through `SignalGate`. The handshake (`src/pulsar/channel-auth.ts`) binds the client's key to the DTLS fingerprints. The daemon then hands out a ticket for the HTTP routes, valid twelve hours from last use and kept in memory. Client keys sit in `auth.json`; `auth.sessions` lists them and `auth.revoke` cuts one off.

A browser upgrade is accepted from the daemon's own origin, `app://ruimte` and loopback origins only. Credentials ride as a bearer or in the query, never a cookie. The daemon serves no page.

### The door on the local network

`src/pulsar/lan-door.ts` listens on every IPv4 interface at the daemon's port plus 10 (`--lan-port`). It answers one WebSocket at `/signal` and 404 for the rest, so the API stays on loopback. The machine proves its key first. One address opens at most 30 sockets a minute and holds at most 8. `endpoint.info` carries `lan: { port, addresses }` while open (private ranges first, then a tailnet's `100.64.0.0/10`, never a container or VM bridge). The door is open unless `lanDoor` is off or `--no-lan` is set; a busy port leaves it closed with a log line.

### Push notifications

A client with a key (the iPhone app) registers with `push.subscribe`, kept in `auth.json` so a revoke takes it along. The daemon decides every push (`src/push/service.ts`) and posts it signed and encrypted to the address book, which relays it to APNs (`apps/pulsar-worker/APNS.md`). Nothing goes to a client holding a socket, and a snoozed node raises nothing until its snooze ends. Each device picks the kinds it hears (`needs-you`, `turn`, `process`), per project if it likes; default is `needs-you`. A finished turn and a process warning have their own collapse ids, so they never replace an attention alert.

Read state lives in `push-attention.json`; a client acknowledges what a focused window shows with `push.read`.

### One account per machine

A machine is on at most one account. It joins one only by signing a registration: `endpoint.signRegistration` (owner only) or `POST /machine/registration` for `ruimte login`. The account is written to `auth.json` before the signature leaves. Another account gets `machine-has-account` until a person leaves the first with `endpoint.leaveAccount` or `ruimte logout`, both local secret only. `endpoint.info` names the account only on the local secret.

A client the machine does not know gets in on a v2 statement (`src/pulsar/statement.ts`) that names this machine's own key and holds its signature. `AuthStore.admitStatement` decides:

- On an account, only a statement of that account lets a client in.
- Taken off its account by a person, no statement lets anyone in until it signs again.
- On no account yet, a v2 statement of any account lets a client in; one without v2 fields answers `account-required`. A statement never puts the machine on an account.

Joining an account cuts off clients another account let in; leaving cuts off every client a statement let in.

## Provenance

Which chat wrote which lines of a file, for the editor's gutter (`src/provenance/CLAUDE.md`). Each file has a record in `$RUIMTE_HOME/provenance/<projectId>/<hash of the path>.json`: line hashes as last read, and per run the chat, turn, provider, time, the first 400 characters of the prompt, the lines (`start`, `end`, one-based inclusive), the replaced lines (`before`), a review state (`pending`, `kept`, `undone`) and `via`.

`provenance.read { projectId, path }` answers `{ mtime, lines, runs }` mapped onto the text on disk. `provenance.review { projectId, path, runIds, state }` sets a review state. Both refuse a path outside the project or under `$RUIMTE_HOME`. `provenance.changed` goes to the project's clients on a write, a review change and a turn's end. No verb reaches it and no setting turns it off.

## Git

`src/git` answers the git panel; `src/git/CLAUDE.md` has its rules.

- Commands run without a shell, arguments as lists. `GIT_TERMINAL_PROMPT=0` keeps a credential prompt from stalling, and a remote step gives up after two minutes.
- `git.watch` with `status: true` answers the first status at once. It stops watching a repository with more than 5,000 tracked files or a status slower than a second (`live: false`); the client then refreshes on focus.
- `git.identity { paths }` answers per top-level folder its root commits, `origin` without credentials, branch and local branch tips, so two machines can tell they hold the same repository. A slow folder (over five seconds) answers `timed-out`.
- `git.bundle` writes a checkout (working tree, `head` or a branch) as a bundle under `bundles/`, read with `bytes.read` up to 256 MiB (`bundle-too-large` beyond). `git.bundlePut` takes an incoming bundle in pieces of up to 256 KiB, at most 16 open uploads, and `git.fetchBundle` verifies it and makes a worktree on `ruimte/<branch>` (`src/peering/CLAUDE.md` has the bundle rules).
- `git.clone` takes HTTPS, SSH or git URLs (never a local path, `file://` or `ext::`) into a missing or empty folder, and leaves no folder when it fails. SSH runs in batch mode unless `GIT_SSH_COMMAND` or `GIT_SSH` is set. `git.ignoredFiles` lists up to 2,000 ignored files. `git.identity` and `git.clone` refuse paths in machine state.
- `git.discard` stashes the paths as `ruimte-discard-<timestamp>` first, so `git stash pop` brings them back.
- `create-pr` needs `gh` on the PATH. Suggested commit messages and chat titles run a CLI's one-shot mode: the chat's own CLI first, then `claude -p`, `codex exec` (read-only sandbox), `copilot -p -s`, `grok -p`, `agy -p`.

## Linked machines

Another machine of the account works in a project here only after a person links it. `src/peering/CLAUDE.md` has admission, what a peer may ask, limits, bundles and untrusted folders. The requests:

- `peer.bind { machineId, label, projectId, ceiling? }` (ceiling `supervised` by default), `peer.list`, `peer.setCeiling` and `peer.unbind`, which ends that machine's nodes here and removes its hidden canvas `peer-<machineId>` and the link. `peer.changed` goes to every client.
- `peer.placeNodes { machineId, projectId, nodes, edges }` replaces that hidden canvas (`cwd-outside`, `edge-off-machine` refuse bad entries).
- A peer comes in on a peer statement (`POST /v1/peer-statements` in the address book, valid ten minutes), kept in `auth.json` with `origin: 'peer'` and listed by `auth.sessions` with a `machineId`. Without a link here it gets `peer-not-linked`.

On the machine whose person works elsewhere, `remote.link`, `remote.list` and `remote.unlink` (`machine-in-use` while a node runs there) keep the linked projects in `remote/<projectId>.json`. `endpoint.signPeerAccess` signs an access request with `peer-key.json` and the machine key; the client trades it at the address book and hands the statement to `remote.connect`, which stores the other machine's key in `peer-machines/<machineId>.json` and answers once the link is open, or `peer-unreachable`. `remote.status` reports each link (`open`, `connecting`, `waiting`, `closed`). A lost link with work owed is retried by a `connect-peer` outbox entry after a minute, doubling to ten, for at most 7 days. Leaving the account forgets `peer-key.json`, `peer-machines/` and the statements.

### Tasks on another machine

`ruimte-context agent --machine M --task ...` (or `team`) gives a task to a linked machine (`machine-not-linked` otherwise); `--task` is required and `--cwd`, `--reads`, `--model` and `--base` are refused. The node stands on a private canvas (`remote-node-shared` on a shared one). A `start-remote-agent` outbox entry waits for the link, sending the checkout as a bundle first with `--worktree`. `peer-busy` (4 open tasks) and `peer-bundle-limit` (2 transfers) keep it waiting; other refusals fail the task. The result comes back as `refs/remotes/ruimte-<machine>/ruimte/<name>` with a worktree that `worktree merge` brings in.

## Worktrees

A worktree the daemon makes lives under `$RUIMTE_HOME/worktrees/<repo>-<hash>/<branch>`. `worktreeRoot` (local secret only; refused for the disk root, the home folder and the data folder) moves new ones elsewhere. `worktrees.json` (`src/git/worktree-register.ts`) records the branch, origin, project, node, maker and whether the daemon made the branch; git stays the truth about which exist.

`git.worktree-remove` refuses a worktree with uncommitted, untracked or unmerged work, or a locked one, unless forced. It deletes the branch only when the daemon made it and the worktree is still on it, and answers the tip it had. Merges run through `src/git/worktree-merge.ts`; root `CLAUDE.md` has their rules.

## Context links

A line on the canvas into a terminal or chat lets that agent read the source. Every shell and chat gets:

- `RUIMTE_CONTEXT_URL` (`http://127.0.0.1:<port>/context`)
- a bearer token: `RUIMTE_HOOK_TOKEN` in a shell, `RUIMTE_CONTEXT_TOKEN` in a chat
- the folder of `ruimte-context` in front of its PATH (`apps/server/bin` in a checkout, the app's `bin` resource when packaged)

`ruimte-context` lists the linked sources and `ruimte-context read <id>` prints one (`--tail N`, `--json`). See `ruimte-context help read`. A chat view names a canvas with `--view` instead of a line (`src/canvas/chat-view.ts`).

| Exit code | Meaning |
| --- | --- |
| 0 | Success; the answer is on stdout. |
| 1 | The daemon cannot be reached or failed. |
| 2 | Not in a live session: no token, or a token the daemon does not know. |
| 3 | A refusal, on stderr. |

## Agent commands

`ruimte-context <verb>` and `ruimte-context <noun> <action>` post `{ argv }` to `POST /canvas/<verb or noun>`, and the daemon parses the words, so an older CLI never disagrees with the daemon. `src/canvas/verbs.ts` is the one registry; run `ruimte-context help [<noun> [<action>]]` for the reference. Answers are `text/plain`, one tab-separated line per result. A refusal is HTTP 422 (404 for an unknown verb) starting with `refused\t<code>\t<message>`; the CLI prints it to stderr and exits 3. `src/canvas/CLAUDE.md` and `src/outbox/CLAUDE.md` have the invariants.

## Usage

`@adecore/agents/usage` answers what the CLIs cost and what is left of their plans, with no vendor API or credential.

- The scanner reads every account's transcripts (`~/.claude/projects`, `~/.codex/sessions`, honoring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`).
- `usage/scan-state.json` is a cache; deleting it costs one cold scan. `usage/history.jsonl` keeps the usage of every transcript ever read, also after its CLI removed it, so deleting it loses that usage for good.
- Copilot chat turns are logged to `usage/copilot`, a file per session; a Copilot terminal is not counted.
- Prices come from LiteLLM's `model_prices_and_context_window.json`, refreshed every 24 hours into `usage/prices.json`, with a bundled fallback. An unpriced model shows as unknown, never free. The ECB euro rate comes from frankfurter.app on the same schedule into `usage/exchange-rate.json`. `--no-price-fetch` turns off both.
- Plan limits come from the CLIs (`get_usage` over Claude Code's stream-json, `account/rateLimits/read` over Codex's app-server) every five minutes, backing off to an hour after a failure. Agents read them with `ruimte-context provider limits`.

## Smoke test

With a daemon running:

```sh
bun run --cwd apps/server smoke            # or: smoke ws://host:port/ws
```

It creates a session, runs `uname`, prints the output and the screen a reattach would get, then kills the session.

## A remote daemon in Docker

`docker/` runs a second daemon on Linux at `127.0.0.1:4310`, for testing remote access. `bun run --cwd apps/server docker:up` starts it; `docker/README.md` has the rest.
