# @ruimte/server

The daemon. It owns terminal sessions and serves them to the UI over one WebSocket. Closing the UI never ends a session; only `session.kill` (or the daemon going down) does.

## Run

```sh
bun run --cwd apps/server start            # ws://127.0.0.1:4210/ws
bun run --cwd apps/server start -- --host 0.0.0.0 --port 4300
bun run --cwd apps/server dev              # same, restarts on file changes
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface to listen on. |
| `--port` | `4210` | Port for `/ws`, `/health` and `/hooks`. |
| `--no-hooks` | off | Do not write the status hooks into the CLIs' settings files at startup. |
| `--serve <dir>` | off | Serve a built client from `dir` next to the socket; unknown paths fall back to its `index.html`. |
| `--label <name>` | hostname | What the daemon calls itself towards clients (`RUIMTE_LABEL` works too). |
| `--allow-origin <origin>` | none | Extra browser origins allowed on the socket, on top of loopback and the daemon's own. Repeatable. |
| `--require-token` | off | Refuse even loopback clients without a paired token. |

`ruimte pair` (in a checkout: `bun src/main.ts pair`) asks the daemon running on this machine for a fresh pairing URL and prints it; tokens never travel as arguments. `ruimte context` is the agent-side CLI behind the `ruimte-context` script.

## Compile

`bun run compile` (`scripts/compile.ts`) builds one executable with `bun build --compile` into `dist/<os>-<arch>/ruimte`, with `ruimte-context` next to it, for this machine or with `--os mac|linux --arch arm64|x64` for another. `RUIMTE_VERSION` stamps a version in; the desktop app packages that folder as its `bin` resource.

`GET /health` answers `{ ok: true, version }`. `POST /hooks/<claude|codex>` takes a hook payload from an agent CLI (see below); a kind the daemon has no normalizer for (`gemini`, `copilot`) answers 404. Everything else goes over `/ws` using the frames in `packages/contracts`.

On the socket, `server.hello` answers the daemon's version, platform and home. `server.ping` takes nothing and answers `{ time }`, the daemon's clock in epoch milliseconds; the client times the round trip itself (two machines never share a clock), which is the ping the connection dot shows.

## `RUIMTE_HOME`

Where the daemon keeps its state. Defaults to `~/.ruimte`. Layout:

```
$RUIMTE_HOME/
  projects.json                    every canvas the daemon knows: id, name, color, folder
  projects/
    <projectId>/project.json       a canvas that is not in a folder
    <projectId>.local.json         camera and focus for one canvas, per machine
  sessions/                        mode 0700
    <sessionId>.txt                serialized screen plus scrollback of one session
    <sessionId>.agent.json         the agent CLI last seen in that session, for a cold resume
  chats/                           mode 0700
    <chatId>.json                  the thread and info of one chat node
  attachments/                     mode 0700
    <chatId>/<id>.<ext>            one file someone attached to a message in that chat
  checkpoints/                     mode 0700
    <repo>-<hash>.index            the private git index a turn's checkpoint is written through
```

File names are the id passed through `encodeURIComponent`, so an id can never name a path outside its directory.

## Projects

A project is a folder; its canvas is `<folder>/.ruimte/project.json`, pretty-printed with a `rev` that goes up on every write, so it diffs and merges like any other file in the repository. Node directories inside the folder are stored relative to it (`./apps/server`), so a clone on another machine resolves them against its own checkout. A canvas without a folder lives under `projects/` in the app data dir. Camera and focus go to `<projectId>.local.json`, never into the shared file.

`project.open` takes an id, a folder (the canvas is created there when the folder has none) or nothing (a fresh canvas without a folder). `project.save` names the `baseRev` the client loaded and answers `rev-conflict` when the file moved on. While a project is open the daemon watches its directory; a write it did not make itself arrives as a `project.changed` event with the document now on disk. A file that does not parse is moved aside as `project.json.corrupt-<timestamp>` and a fresh canvas takes its place; it is never overwritten. Every write is a temp file plus rename, with a short retry for Windows. `project.delete` forgets the project and, when asked, removes the canvas file; a folder's other files are never touched.

### Name and icon

`name` and an optional `icon` sit at the top of the canvas file. An icon there is `{ kind: 'emoji', value }` or `{ kind: 'lucide', value }` with a closed list of 40 names; an image is never a blob in the JSON. Without a chosen icon the daemon asks the folder, in this order: `.ruimte/icon.{svg,png,jpg,jpeg,gif,webp}`, `.idea/icon.{svg,png}`, `.vscode/icon.{svg,png}`, then `favicon.{svg,ico,png}`, `public/favicon.*`, `public/icon.*`, `app/favicon.ico`, `app/icon.*`, `src/favicon.*`, `src/app/favicon.ico`, `src/app/icon.*`, `assets/icon.*` and `assets/logo.*`, and finally the `href` of the first local `<link rel="icon">` in a root `index.html` (tried as `public/<href>`, then `<href>`). A `<name>_dark.<ext>` next to the file it found is the dark theme's variant. Every path is jailed inside the folder and re-checked after `realpath`, the type comes from the magic bytes and not the extension, and a file that is empty, over 256 KB or not an image is skipped. Nothing is left: the summary carries `{ kind: 'initial', value }`, the first letter of the name. The `name` is seeded when a folder gets its first canvas: from `.idea/.name` (first non-empty line, control characters stripped, 64 characters, file at most 4 KB) when it holds one, else the folder's own name. That file is read once and never again, so the canvas file owns the name from there on and only a rename changes it; `nameSource` says whether the name was chosen or is still the folder's own. What the folder says about its icon is cached in memory for five minutes per folder and never written back; `project.open` and `project.setIcon` re-read it, and a folder that could not be read at all is not cached.

`GET /projects/<projectId>/icon?v=<version>&theme=dark` serves the bytes, gated by the same rules as `/ws` (loopback free, any other client sends its session token as `?token=`). It answers with the sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: private, max-age=31536000, immutable` (the URL changes whenever the file does) and, for an SVG, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, so opening the URL directly runs nothing either. `project.list` never carries image bytes.

`project.setIcon { projectId, image: { mime, base64 } | null }` writes `<folder>/.ruimte/icon.<ext>` (PNG, JPEG, GIF, WebP or SVG, at most 256 KB, checked against the bytes' own magic, the other `icon.*` in that directory removed) or, with a null image, deletes it. It answers with the fresh summary and sends `project.summary` to every client. An emoji or a Lucide choice needs no request of its own: the client writes `icon` into the canvas file through `project.save`. The watcher on `<folder>/.ruimte` covers `icon.*` as well as `project.json`, so an icon copied in by hand also arrives as `project.summary`.

## Sessions

- A session is keyed by the id the client chooses. `session.create` on an id that is still running answers `session-exists`; on an id whose shell has ended it starts a fresh shell and shows the old screen above a `[session restored, previous shell ended]` line.
- The shell is `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere), started as a login shell where the shell takes `-l`, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `RUIMTE_SESSION_ID` set.
- Every session runs a headless xterm in the daemon (10000 lines of scrollback). `session.attach` answers with the serialized screen, after which raw output streams in `session.output` events, coalesced per 16 ms.
- Several clients may attach to one session. Attaching with different `cols`/`rows` resizes the session; the last attacher wins.
- A client that cannot keep up does not grow a queue in the daemon. Per socket, once `getBufferedAmount()` passes 1 MB (`HIGH_WATER_MARK` in `src/backpressure.ts`) or a `session.output` frame comes back as dropped or backpressured, output for that client stops and every session that loses bytes is marked. Requests, replies and the other events are small and keep flowing. On Bun's `drain`, under 256 KB queued, each marked session gets a `session.resync` event (`{ sessionId, screen }`) with a fresh serialize and its stream continues; the mark is cleared in the same tick the serialize resolves, so a byte is either in that screen or in the stream after it, never in both.
- A shell that exits on its own stays in `session.list` as `exited` with its `exitCode` so the last screen can still be read. `session.kill` removes it.
- `session.create` takes either `command` (a line typed into the fresh shell) or `agent` (`{ kind, runtimeMode?, model?, resume? }`), never both: with `agent` the daemon builds the line itself (`src/providers/launch.ts`) and types that. So every client starts a CLI the same way, and a flag never travels over the wire. `runtimeMode` becomes `--permission-mode` for Claude Code, `--ask-for-approval` plus `--sandbox` for Codex, `--approval-mode` for Gemini and nothing for Copilot; a `resume` fills the provider's resume template instead. A CLI that is not installed ends as `command not found` in the shell, which is why the menus disable a row the daemon did not find.

## Snapshots

Every 30 seconds, and on `SIGINT`/`SIGTERM`, the daemon writes each session's screen to `sessions/<sessionId>.txt` (temp file, then rename). When the daemon starts again and a client creates a session with an id that has a snapshot, the first attach shows the snapshot, the restored marker and then the fresh shell. `session.kill` deletes the snapshot on purpose: a killed session should not come back. The chats go down first and synchronously (`ChatManager.persistAllSync`), before the handler awaits anything, because a `bun --watch` reload restarts the module during that first await.

## Agent status via hooks

Hooks are per kind: Claude Code and Codex have an event table and a normalizer (`capabilities.hooks: true`), Gemini and GitHub Copilot do not, so they launch in a terminal and show the session's own status (running while attached, error on exit) and nothing more. The installer only visits the kinds with a hook path, and the receiver answers 404 for the others.

Every shell gets `RUIMTE_HOOK_URL` (`http://127.0.0.1:<port>/hooks`) and a per-session `RUIMTE_HOOK_TOKEN`. At startup the daemon puts one command hook per lifecycle event into `~/.claude/settings.json` and `~/.codex/hooks.json` (idempotent merge; hooks of other tools stay). The hook POSTs its stdin to `$RUIMTE_HOOK_URL/<kind>` with the token as bearer and prints the reply, and does nothing outside Ruimte. Codex asks you to trust the new hooks once (`/hooks`).

The reply is empty except on Claude Code's `SessionStart` and `UserPromptSubmit`: when the session has linked context, the daemon answers `{ "hookSpecificOutput": { "hookEventName": ..., "additionalContext": "Ruimte: linked context is available with ruimte-context ..." } }`, which the CLI folds into the turn. That is how a Claude agent inside a terminal, which has no system prompt of ours, learns about `ruimte-context`. The curl runs with `-f`, so an error page never ends up as context.

The daemon folds the events into one status per session: `running`, `needs-you` (permission prompt, `AskUserQuestion`, elicitation), `idle` (turn ended) or `error` (the shell died under a live agent). Every client gets it as a `session.status` event with the CLI's session id and transcript path, and `session.list` carries the same `agent` field.

The record is also written to `sessions/<id>.agent.json`. When the daemon starts again and the session is restored from its snapshot, the agent comes back with `live: false`; the client answers with `agent.resume`, which types `claude --resume <id>` (or `codex resume <id>`) into the shell.

## Providers and models

Each agent CLI is one `ChatProvider` value (`src/providers/provider.ts`, `claude-provider.ts`, `codex-provider.ts`, `terminal-providers.ts`): its kind and name, its model catalog, what it can do, the command to run, the template a terminal resumes it with (`claude --resume {id}`, `codex resume {id}`) and how to make a backend for a chat. `ProviderRegistry` is the list of them plus the detection cache; nothing else in the daemon branches on which CLI a chat is. The catalog is Claude Code, Codex, Gemini and GitHub Copilot, in the order every menu lists them; the last two are terminal only and have no chat backend.

`provider.list` answers, per agent CLI, whether it is installed, its version, the models it offers, its resume template and its capabilities. The catalogs are `src/providers/claude-models.json` and `src/providers/codex-models.json`: a model points at a profile, a profile lists option descriptors (reasoning effort, context window, thinking) with their defaults and the context size per option. Adding a model is a JSON edit; a new profile is only needed for a new combination of options. The Codex catalog mirrors what `codex app-server` answers on `model/list` for 0.153 (six models, each with its own reasoning ladder and default); the context windows were measured per model through `thread/tokenUsage/updated`. A `ModelSelection` is `{ model, options }`; the daemon normalizes it (aliases like `opus` or `astra`, defaults for missing options, unknown options dropped).

The capabilities are the honest list of what a CLI does, so a client never offers what would be dropped: whether it can be opened as a chat, as a terminal or both, whether the daemon understands its hooks, whether it streams partial tool output, how it reports a file change (`unified`, `before-after` or `none`), whether it takes image attachments and `@` mentions, whether a decline carries a reason, whether "always allow" exists, whether it asks questions the person may ignore, how it folds context (`native`, `prompt` or `none`), whether it reports cost, the context window and slash commands. Claude Code and Codex differ on most of them.

One mode travels with every chat: the runtime mode, the permission policy in one vocabulary for every provider (`supervised`, `auto-accept-edits`, `auto`, `full-access`, the default). For Claude it becomes `--permission-mode`, the selection becomes `--model <slug>[1m]` and `--effort`, and `ultrathink` is written into the prompt because the CLI has no flag for it.

For Codex (`src/providers/codex.ts`) the runtime mode becomes an approval policy plus a sandbox on `thread/start`: `supervised` is `untrusted` in a `read-only` sandbox, `auto-accept-edits` is `untrusted` in `workspace-write` (edits inside the workspace pass the sandbox, commands still ask unless Codex knows them as safe; the CLI has no "ask for commands, not for edits" policy), `auto` is `on-request` in `workspace-write` (Codex's own default) and `full-access` is `never` in `danger-full-access`. The reasoning effort travels as `effort` on every `turn/start`. The `approvals_reviewer` from `~/.codex/config.toml` is left alone; with `auto_review` some approvals never reach the person.

## Chats

One chat is three pieces, whichever CLI is behind it:

- `ChatSession` (`src/chat/chat-session.ts`) owns the thread, the turns, the process generation and when a new backend is needed. It is the same class for every provider.
- `ChatBackend` (`src/chat/backend.ts`) is one CLI process and the protocol it speaks. It reports what happened as `BackendEvent`s (`text.delta`, `tool.started`, `approval.requested`, `turn.done`, `exit`, ...) and never touches the thread. `ClaudeBackend` and `CodexBackend` implement it; the frames themselves are mapped in `claude-protocol.ts` and `codex-protocol.ts`, which are pure and unit tested.
- `ThreadProjector` (`src/chat/projector.ts`) is the only place that turns those events into thread items and the `chat.event`s to broadcast. Item ids carry the process generation, since a resumed CLI numbers its messages from the start again.

A third CLI is therefore a provider value, a backend and a protocol mapper; the session, the projector, the manager and the wire stay as they are.

A Claude chat is `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`, spawned on the first `chat.send` and kept alive between turns. The daemon folds the stream into thread items (turn, user, assistant, tool, approval, question, note, compaction), every item tagged with its turn, and broadcasts every change as a `chat.event` to the attached clients; `chat.attach` answers the current thread, so a reload rebuilds the view.

- A `can_use_tool` control request becomes an approval item and `needs-you`; `chat.approve` answers it with `allow`, `allow-always` (the CLI's own suggested rule goes back as `updatedPermissions`) or `deny`.
- An `AskUserQuestion` call becomes a question item instead; `chat.answer` returns the answers keyed by question index, the daemon keys them by question text for the CLI.
- `chat.configure` changes the selection or a mode. A running process keeps its flags until the turn ends; the next send starts a fresh process with `--resume` and the new flags.
- `chat.cancel` sends an interrupt and the turn ends as `aborted`. `chat.compact` follows the provider's capability: Claude Code gets `/compact` as a turn, Codex a call of its own.
- A settled tool item may carry `changes`, the files it touched with the unified diff per file, for a provider that reports one (Codex). Claude Code's edits only carry the text before and after in the tool input, which is why a turn takes a checkpoint of its own.
- A turn takes a checkpoint when it starts: `src/git/checkpoints.ts` writes the chat's folder as a git tree through an index file of ours (`GIT_INDEX_FILE` under `$RUIMTE_HOME/checkpoints`, `git add -A`, `git write-tree`), so the person's own index, stashes and commits are untouched and ignored files stay ignored. The tree id sits on the turn item as `checkpoint`. When the turn settles the daemon diffs the working tree against it and puts the answer on the turn as `checkpointDiff`: one unified diff per file with the added and deleted line counts, at most 100 files (`truncated` says there were more), no body for a binary file or a patch over the cap (`omitted`). `chat.turnDiff { chatId, turnId }` answers the same shape for a turn that has no stored diff yet, which is how a client asks while a turn is still running. A folder outside a repository, or a git that fails, leaves both fields off and the card falls back to what the CLI reported.
- A running tool item may carry `progress`: `startedAt` from the CLI's `tool_progress` frame (`elapsed_time_seconds`, verified on 2.1.266), `description` from its `task_started` frame, and `output` for a provider that streams partial output (a `delta` event on a tool item appends to it). Claude Code sends `tool_progress` for a local Bash only under its remote gate (`CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID`, once per 30 s) and never streams Bash output, so the client counts from the item's own timestamp when nothing came. The result drops `progress`.
- Not every turn starts with a message. Claude Code wakes the agent itself when a background task settles: after the `result` of the turn that launched it, and with no user frame in between, it sends `system/task_notification`, a fresh `system/init`, an assistant message and a new `result`. Content that arrives while no turn is open therefore opens one with `origin: 'agent'`, the notification's summary as its `label`, no user item, status `running` and a checkpoint of its own; the `result` settles it like any other turn. A frame that carries a `parent_tool_use_id` is a subagent talking inside its own row and never opens one. A message sent while such a turn is open is not refused as busy: the daemon settles that turn as stale first, and the `result` still coming for it is dropped instead of closing the turn that took its place. The composer offers stop while the turn runs, like any other.
- The thread is written to `chats/<id>.json` when a turn opens, after every tool call that settles (debounced to 500 ms once the record passes 256 KB) and when the turn ends, so a daemon that goes down mid-turn keeps what was said. A chat whose process ended (or a daemon that restarted) starts the CLI again with `--resume` on the next send.
- `chat.send` takes optional `mentions` (paths the person picked with `@`), which stay `@path` in the text for the CLI to expand itself and are stored on the user item so a client can draw them as chips.
- `chat.send` also takes optional `attachments`, any file type, at most 25 MB each and 8 per message, as `{ name, mime, data }` with base64 bytes. The daemon writes each one to `$RUIMTE_HOME/attachments/<chatId>/<id>.<ext>` (`src/chat/attachment-store.ts`) and keeps only `{ id, name, mime, size, path }` on the user item, so a thread with a video in it is still a small JSON file. The prompt names the files by path under the text ("Attached files: - /path (name)"): both CLIs open a file with their own tools, images included. A thread written before this carried its images inline; the read that opens the chat writes them out once and rewrites the record, before the schema sees it. `GET /attachments/<chatId>/<id>` serves the bytes behind the same access rules as `/ws` and the project icon (loopback free, any other client sends its session token as `?token=`), `inline` for what a browser paints and `attachment` for the rest, with `nosniff`, an immutable cache and, for an SVG, the same `default-src 'none'` policy the icon route uses. The chat's own thread and queue are what say which id belongs to which file, so nothing else can be reached through the route.
- A `chat.send` while a turn runs is not refused: the message joins the chat's queue and the request answers `{ queued: true }`. The queue sits on `ChatInfo.queue` (so it reaches every attached client as an info event and goes to disk with the thread, and a reload or a daemon restart keeps it), and the daemon sends the next message the moment the turn settles. `chat.unqueue { chatId, messageId }` drops one; `chat.sendNow { chatId, messageId }` puts one first and interrupts the turn in its way, so the settle sends it. One queue for both providers: Claude's steer folds into the running turn and Codex's app-server queues a second turn, and two semantics per CLI is harder to reason about than one.
- `skills.list { chatId }` answers the composer's `$` picker with `{ name, description, source }` per skill (`src/skills/skills.ts`). A running Codex answers it itself over the app-server's `skills/list`; otherwise the daemon scans the roots the CLI uses. Claude: `$CLAUDE_CONFIG_DIR ?? ~/.claude/skills` (user), every `.claude/skills` from the chat's folder up to the repository root (project), and the `skills` folder of each entry in `~/.claude/plugins/installed_plugins.json`, named `<plugin>:<skill>` the way the init frame does (plugin). Codex: `~/.agents/skills`, `~/.codex/skills` and the `.agents/skills` folders of the project. A skill is a folder with a `SKILL.md`, named by its front matter's `name` or by the folder, described by its `description` (block scalars folded). The scan is cached for 30 seconds per CLI and folder; there is no watcher. Once the CLI announced its own `skills` in the init frame (`ChatInfo.skills`), the answer is narrowed to that list, so a skill turned off in the CLI's settings drops out.
- `chat.send` takes an optional `skills`, the names the person picked with `$`. The names stay `$name` in the text, which is what Codex expands. Claude Code expands a skill only from a text block that starts with `/name` and is the last block of the message, so the daemon splits the prompt (`src/chat/input.ts`): what came before the last `$name` is the leading text block with the earlier `$x` written as `/x`, then the images, then `/name <rest>` as the last block. A `$word` that names no known skill is left alone.
- `fs.search` answers the composer's `@` picker: a fuzzy search over the files under a folder, through `git ls-files` (tracked and untracked, minus `.gitignore`) inside a repo and a bounded walk (20k files, depth 12, no dot folders or `node_modules`) elsewhere. The file list is cached for ten seconds per folder.

## Files

`fs.list { path, depth?, hidden? }` (`src/fs/list.ts`) answers one directory, or up to three levels of it, as a flat list where a directory is followed by what is under it: name, absolute path, kind (`file`, `directory`, `symlink`, `other`), size for a file, mtime, and the `hidden` and `ignored` flags. Directories come before files, then names compare with `numeric: true`, so `item2` sits before `item10`. A listing stops at 2,000 entries and says `truncated`. Symlinks are never walked into, so a link out of the folder is one entry and the listing stays inside the folder it was given. `hidden` (a leading dot) is left out unless asked for; the Files panel asks for everything and filters in the client, so its eye button costs no request.

`ignored` comes from one `git check-ignore -z --stdin` per level, with the listed directory as the working directory (`src/git/ignore.ts`, on the shared runner in `src/git/run.ts`). Exit code 1 means nothing matched and 128 means there is no repository; both leave every entry unignored. `.git` itself is flagged by hand, since git never reports its own directory, and an ignored directory is not walked into, so a deep listing never wanders into `node_modules`.

`fs.read { path }` (`src/fs/read.ts`) answers one file for the viewer, in one of three shapes. A text file comes back as `{ kind: 'text', text, encoding: 'utf-8', size, mtime, language? }`, where `language` is a highlighter id guessed from the extension (or from a bare name such as `Dockerfile`) and is left off when nothing recognizes it. A file the sniff calls binary comes back as `{ kind: 'binary', mime, size, mtime }` and its bytes never touch the socket: PNG, JPEG, GIF, WebP and PDF come from their magic bytes, an SVG from a head that opens as one (text, reported as an image, since that is how the viewer draws it), and everything else as `application/octet-stream`. A text file over 2 MB comes back as `{ kind: 'too-large', size }`, so the panel can say so instead of pushing megabytes through the socket; the cap is on text alone, and an image of any size is still an image.

The sniff reads the first 8 KB. A NUL byte settles it, so does a head that will not decode as UTF-8, and more than a tenth of the head in control characters other than tab, newline, carriage return, form feed and escape does too (a log full of ANSI is still text). The path must be absolute and free of NUL, and the last component may not be a symlink: `fs.list` never walks into one either, so a link inside a folder cannot hand the viewer a file that folder does not hold.

`GET /fs/file?path=<absolute>&v=<mtime>-<size>` (`src/fs/file-route.ts`) serves the bytes of an image the viewer is drawing, behind the same access rules as the socket, so a client from elsewhere sends its session token as `?token=`. Only an image is served, decided by the same sniff: a route that hands arbitrary bytes to an `<img>` tag is a worse deal than one that does not. Headers match the project icon route: `content-type` from the sniff, `content-disposition: inline`, `x-content-type-options: nosniff`, a year of immutable caching (the URL carries the file's version, so a write moves the URL with it), and for an SVG a `content-security-policy` that allows nothing but its own styles. In dev, Vite proxies `/fs` to the daemon the way it proxies `/projects`.

`fs.watch { path }` and `fs.unwatch { path }` are per client, like a session attach (`src/fs/watch.ts`). A watch is recursive on macOS and Windows, where the platform does that in one call; elsewhere it covers only the directory it names and the client watches the folders it has open. Changes settle for 250 ms and go out as one `fs.changed { root, paths }` naming the directories that moved, so the client re-lists only what it has loaded; every batch also drops the `fs.search` cache. A recursive watch closes the watches below it, and a disconnect drops every watch the client had.

## Remote clients and pairing

A client on the same machine (a loopback address) needs nothing. Any other client needs a session token, sent as `?token=` on the socket URL because a browser cannot set a header on a WebSocket. Tokens come from pairing: the daemon prints `http://<host>:<port>/pair#<token>` when it listens beyond loopback (and on `bun src/main.ts pair`), the client posts that one-time token to `POST /auth/pair` with a label for itself and gets a long-lived session token back. Pairing tokens die after one use or ten minutes; session tokens are stored as hashes in `$RUIMTE_HOME/auth.json`, listed with `auth.sessions` and cut off with `auth.revoke`, which also closes that session's open sockets (code 4001). `auth.pairingToken` mints a fresh pairing URL over the socket for a loopback client only (any other client gets `forbidden`); it is what the settings dialog's "Show pairing link" uses, the same way `ruimte pair` uses `POST /auth/pairing-token`. `endpoint.info` tells a client the daemon's label, platform and how far away it is.

A browser sends its page's origin with the upgrade; the daemon accepts its own origin, any loopback origin (the desktop app, the dev server) and what `--allow-origin` adds, and refuses the rest. Serving over the network in the clear means anyone on the path can read the tokens: put a reverse proxy with TLS in front (nginx, Caddy) that forwards `/ws` as a WebSocket and hands the daemon the `Host` and `Origin` headers, and pair with the proxy's `https://` address. The `Relay` seam (`src/auth/relay.ts`) is where a rendezvous service for daemons behind NAT would go; the default does nothing.

`bun run serve` at the root builds the client and starts the daemon on every interface serving it, which is the Server Edition: open `http://<machine>:4210/` from any browser on the network and pair.

## Worktrees

`git.worktree-add { repo, branch }` answers the worktree for a branch of the repository, making it under `$RUIMTE_HOME/worktrees/<repo>-<hash>/<branch>` when it does not exist (a branch that does not exist yet is created from HEAD). `git.worktree-list` and `git.worktree-remove` do what they say. The repository itself is never touched beyond what `git worktree` records.

## Context links

An edge on the canvas into a terminal or chat node lets that agent read the source. The client tells the daemon what each agent node may read (`context.set`: a text element or a note with its content, a browser node as its address, a terminal or chat by id); the daemon reads terminals and chats live when asked. An edge between two other nodes is a drawing the client keeps to itself; the daemon never hears about it. Every shell and chat gets `RUIMTE_CONTEXT_URL` (`http://127.0.0.1:<port>/context`), a bearer token (`RUIMTE_HOOK_TOKEN` in a shell, `RUIMTE_CONTEXT_TOKEN` in a chat) and the directory of `ruimte-context` in front of its PATH (`apps/server/bin` in a checkout, the app's `bin` resource when packaged), where `ruimte-context` lists the linked sources and `ruimte-context read <id>` prints one.

How an agent hears that the CLI exists depends on where it runs:

- A chat that has links when its process starts gets one sentence about `ruimte-context`: Claude Code in its system prompt (`--append-system-prompt`), Codex in front of the first prompt, since the app-server protocol has no system prompt. When the set of links changes between two turns (added or removed, matched by id), the daemon puts a note in front of the next prompt naming what came and went (`src/context/context-note.ts`, `contextChangeNote`) and shows it in the thread as an info note. A slash command is sent untouched; the note waits for the next real prompt.
- A shell that has links the moment it is created shows one dimmed line above its first prompt (`contextHint`), written to the screen only, never to the PTY. A link made while the shell runs is not announced there; the terminal node's header shows a "context" chip instead, and a Claude Code agent inside the shell hears it through its prompt hooks (above).

A Codex chat (`provider: 'codex'` on `chat.create`) is `codex app-server`, JSON-RPC over stdio (`src/chat/codex-transport.ts`, `codex-backend.ts`, `codex-protocol.ts`). The first send spawns it and handshakes: `initialize`, `initialized`, then `thread/start` with cwd, model, approval policy and sandbox, or `thread/resume` with the stored thread id (a thread Codex no longer has falls back to a fresh one with a warning on the thread). Every message is a `turn/start`; the notifications fold into the same thread items, so the client does not know the difference:

- `agentMessage` items stream through `item/agentMessage/delta` into assistant items; `plan` items are assistant text too. Reasoning items are not shown.
- `commandExecution` is a `Bash` tool item (the `/bin/zsh -lc` wrapper stripped, `aggregatedOutput` as output) whose partial output streams in through `item/commandExecution/outputDelta` while it runs, `fileChange` an `ApplyPatch` tool item with the unified diffs in `changes`, `mcpToolCall` and `dynamicToolCall` tool items under their own names, `collabAgentToolCall` (Codex's own multi-agent calls) a tool item too, named `Agent` when it spawns one, `contextCompaction` a compaction marker.
- `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` are approval items. `allow` answers `accept`, `allow-always` the execpolicy amendment Codex proposed (or `acceptForSession`), `deny` answers `decline`; Codex takes no reason with a decline, so `message` stays on the daemon. `serverRequest/resolved` cancels an approval that Codex withdrew.
- `item/tool/requestUserInput` (blocking) is a question item answered by Codex's own question ids. An agent message that carries `questions` (Codex asking without blocking, it polls with `sleep` until the person answers) is a question item too; `chat.answer` sends the chosen labels with `turn/steer` into the running turn.
- `chat.cancel` is `turn/interrupt` (the turn ends `interrupted`, shown as aborted), `chat.compact` is `thread/compact/start`, which Codex runs as a turn of its own.
- Usage comes from `thread/tokenUsage/updated` (`last.totalTokens` as the context in use, `modelContextWindow` as the window). Codex reports no cost, so `costUsd` stays zero and the turn fold only shows the duration. Slash commands stay empty.
- `item/permissions/requestApproval`, MCP elicitations and any other server request the daemon does not understand are refused with a JSON-RPC error, so Codex never waits on an answer that will not come.
- The thread id is what a terminal resumes with `codex resume <id>`, and "Open in chat" on a terminal that ran Codex opens a chat on the same thread.

## Smoke test

With a daemon running:

```sh
bun run --cwd apps/server smoke            # or: smoke ws://host:port/ws
```

It creates a session, runs `uname`, prints the streamed output and the screen a reattach would receive, then kills the session.
