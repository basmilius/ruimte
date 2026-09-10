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
```

File names are the id passed through `encodeURIComponent`, so an id can never name a path outside its directory.

## Projects

A project is a folder; its canvas is `<folder>/.ruimte/project.json`, pretty-printed with a `rev` that goes up on every write, so it diffs and merges like any other file in the repository. Node directories inside the folder are stored relative to it (`./apps/server`), so a clone on another machine resolves them against its own checkout. A canvas without a folder lives under `projects/` in the app data dir. Camera and focus go to `<projectId>.local.json`, never into the shared file.

`project.open` takes an id, a folder (the canvas is created there when the folder has none) or nothing (a fresh canvas without a folder). `project.save` names the `baseRev` the client loaded and answers `rev-conflict` when the file moved on. While a project is open the daemon watches its directory; a write it did not make itself arrives as a `project.changed` event with the document now on disk. A file that does not parse is moved aside as `project.json.corrupt-<timestamp>` and a fresh canvas takes its place; it is never overwritten. Every write is a temp file plus rename, with a short retry for Windows. `project.delete` forgets the project and, when asked, removes the canvas file; a folder's other files are never touched.

## Sessions

- A session is keyed by the id the client chooses. `session.create` on an id that is still running answers `session-exists`; on an id whose shell has ended it starts a fresh shell and shows the old screen above a `[session restored, previous shell ended]` line.
- The shell is `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere), started as a login shell where the shell takes `-l`, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `RUIMTE_SESSION_ID` set.
- Every session runs a headless xterm in the daemon (10000 lines of scrollback). `session.attach` answers with the serialized screen, after which raw output streams in `session.output` events, coalesced per 16 ms.
- Several clients may attach to one session. Attaching with different `cols`/`rows` resizes the session; the last attacher wins.
- A shell that exits on its own stays in `session.list` as `exited` with its `exitCode` so the last screen can still be read. `session.kill` removes it.
- `session.create` takes either `command` (a line typed into the fresh shell) or `agent` (`{ kind, runtimeMode?, model?, resume? }`), never both: with `agent` the daemon builds the line itself (`src/providers/launch.ts`) and types that. So every client starts a CLI the same way, and a flag never travels over the wire. `runtimeMode` becomes `--permission-mode` for Claude Code, `--ask-for-approval` plus `--sandbox` for Codex, `--approval-mode` for Gemini and nothing for Copilot; a `resume` fills the provider's resume template instead. A CLI that is not installed ends as `command not found` in the shell, which is why the menus disable a row the daemon did not find.

## Snapshots

Every 30 seconds, and on `SIGINT`/`SIGTERM`, the daemon writes each session's screen to `sessions/<sessionId>.txt` (temp file, then rename). When the daemon starts again and a client creates a session with an id that has a snapshot, the first attach shows the snapshot, the restored marker and then the fresh shell. `session.kill` deletes the snapshot on purpose: a killed session should not come back.

## Agent status via hooks

Hooks are per kind: Claude Code and Codex have an event table and a normalizer (`capabilities.hooks: true`), Gemini and GitHub Copilot do not, so they launch in a terminal and show the session's own status (running while attached, error on exit) and nothing more. The installer only visits the kinds with a hook path, and the receiver answers 404 for the others.

Every shell gets `RUIMTE_HOOK_URL` (`http://127.0.0.1:<port>/hooks`) and a per-session `RUIMTE_HOOK_TOKEN`. At startup the daemon puts one command hook per lifecycle event into `~/.claude/settings.json` and `~/.codex/hooks.json` (idempotent merge; hooks of other tools stay). The hook POSTs its stdin to `$RUIMTE_HOOK_URL/<kind>` with the token as bearer and prints the reply, and does nothing outside Ruimte. Codex asks you to trust the new hooks once (`/hooks`).

The reply is empty except on Claude Code's `SessionStart` and `UserPromptSubmit`: when the session has linked context, the daemon answers `{ "hookSpecificOutput": { "hookEventName": ..., "additionalContext": "Ruimte: linked context is available with ruimte-context ..." } }`, which the CLI folds into the turn. That is how a Claude agent inside a terminal, which has no system prompt of ours, learns about `ruimte-context`. The curl runs with `-f`, so an error page never ends up as context.

The daemon folds the events into one status per session: `running`, `needs-you` (permission prompt, `AskUserQuestion`, elicitation), `idle` (turn ended) or `error` (the shell died under a live agent). Every client gets it as a `session.status` event with the CLI's session id and transcript path, and `session.list` carries the same `agent` field.

The record is also written to `sessions/<id>.agent.json`. When the daemon starts again and the session is restored from its snapshot, the agent comes back with `live: false`; the client answers with `agent.resume`, which types `claude --resume <id>` (or `codex resume <id>`) into the shell.

## Providers and models

Each agent CLI is one `ChatProvider` value (`src/providers/provider.ts`, `claude-provider.ts`, `codex-provider.ts`, `terminal-providers.ts`): its kind and name, its model catalog, what it can do, the command to run, the template a terminal resumes it with (`claude --resume {id}`, `codex resume {id}`) and how to make a backend for a chat. `ProviderRegistry` is the list of them plus the detection cache; nothing else in the daemon branches on which CLI a chat is. The catalog is Claude Code, Codex, Gemini and GitHub Copilot, in the order every menu lists them; the last two are terminal only and have no chat backend.

`provider.list` answers, per agent CLI, whether it is installed, its version, the models it offers, its resume template and its capabilities. The catalogs are `src/providers/claude-models.json` and `src/providers/codex-models.json`: a model points at a profile, a profile lists option descriptors (reasoning effort, context window, thinking) with their defaults and the context size per option. Adding a model is a JSON edit; a new profile is only needed for a new combination of options. The Codex catalog mirrors what `codex app-server` answers on `model/list` for 0.153 (six models, each with its own reasoning ladder and default); the context windows were measured per model through `thread/tokenUsage/updated`. A `ModelSelection` is `{ model, options }`; the daemon normalizes it (aliases like `opus` or `astra`, defaults for missing options, unknown options dropped).

The capabilities are the honest list of what a CLI does, so a client never offers what would be dropped: whether it can be opened as a chat, as a terminal or both, whether the daemon understands its hooks, whether it streams partial tool output, how it reports a file change (`unified`, `before-after` or `none`), whether it takes image attachments and `@` mentions, whether a decline carries a reason, whether "always allow" exists, whether it asks questions the person may ignore, how it folds context (`native`, `prompt` or `none`), how plan mode works, whether it reports cost, the context window and slash commands. Claude Code and Codex differ on most of them.

Two modes travel with every chat. The runtime mode is the permission policy, one vocabulary for every provider: `supervised`, `auto-accept-edits`, `auto`, `full-access` (the default). The interaction mode is `default` or `plan`. For Claude they become `--permission-mode` (plan wins over the runtime mode), the selection becomes `--model <slug>[1m]` and `--effort`, and `ultrathink` is written into the prompt because the CLI has no flag for it.

For Codex (`src/providers/codex.ts`) the runtime mode becomes an approval policy plus a sandbox on `thread/start`: `supervised` is `untrusted` in a `read-only` sandbox, `auto-accept-edits` is `untrusted` in `workspace-write` (edits inside the workspace pass the sandbox, commands still ask unless Codex knows them as safe; the CLI has no "ask for commands, not for edits" policy), `auto` is `on-request` in `workspace-write` (Codex's own default) and `full-access` is `never` in `danger-full-access`. The reasoning effort travels as `effort` on every `turn/start`. Plan mode does not exist on the app-server protocol of 0.153 (the collaboration mode is only reported, never taken), so it is a `read-only` sandbox plus an instruction at the top of the prompt. The `approvals_reviewer` from `~/.codex/config.toml` is left alone; with `auto_review` some approvals never reach the person.

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
- A settled tool item may carry `changes`, the files it touched with the unified diff per file, for a provider that reports one (Codex). Claude Code's edits keep the text before and after in the tool input until per-turn checkpoints exist.
- A running tool item may carry `progress`: `startedAt` from the CLI's `tool_progress` frame (`elapsed_time_seconds`, verified on 2.1.266), `description` from its `task_started` frame, and `output` for a provider that streams partial output (a `delta` event on a tool item appends to it). Claude Code sends `tool_progress` for a local Bash only under its remote gate (`CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID`, once per 30 s) and never streams Bash output, so the client counts from the item's own timestamp when nothing came. The result drops `progress`.
- The thread is written to `chats/<id>.json` after every turn; a chat whose process ended (or a daemon that restarted) starts the CLI again with `--resume` on the next send.
- `chat.send` takes optional `attachments` (base64 PNG, JPEG, GIF or WebP, at most 5 MB each and 8 per message) and `mentions` (paths the person picked with `@`). Attachments become `image` content blocks next to the text in the CLI's `user` frame; mentions stay `@path` in the text, which the CLI expands itself, and are stored on the user item so a client can draw them as chips.
- `fs.search` answers the composer's `@` picker: a fuzzy search over the files under a folder, through `git ls-files` (tracked and untracked, minus `.gitignore`) inside a repo and a bounded walk (20k files, depth 12, no dot folders or `node_modules`) elsewhere. The file list is cached for ten seconds per folder.

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
- `commandExecution` is a `Bash` tool item (the `/bin/zsh -lc` wrapper stripped, `aggregatedOutput` as output) whose partial output streams in through `item/commandExecution/outputDelta` while it runs, `fileChange` an `ApplyPatch` tool item with the unified diffs in `changes`, `mcpToolCall` and `dynamicToolCall` tool items under their own names, `contextCompaction` a compaction marker.
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
