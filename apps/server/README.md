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

`GET /health` answers `{ ok: true, version }`. `POST /hooks/<claude|codex>` takes a hook payload from an agent CLI (see below). Everything else goes over `/ws` using the frames in `packages/contracts`.

## `RUIMTE_HOME`

Where the daemon keeps its state. Defaults to `~/.ruimte`. Layout:

```
$RUIMTE_HOME/
  sessions/                  mode 0700
    <sessionId>.txt          serialized screen plus scrollback of one session
    <sessionId>.agent.json   the agent CLI last seen in that session, for a cold resume
  chats/                     mode 0700
    <chatId>.json            the thread and info of one chat node
```

File names are the id passed through `encodeURIComponent`, so an id can never name a path outside its directory.

## Sessions

- A session is keyed by the id the client chooses. `session.create` on an id that is still running answers `session-exists`; on an id whose shell has ended it starts a fresh shell and shows the old screen above a `[session restored, previous shell ended]` line.
- The shell is `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere), started as a login shell where the shell takes `-l`, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `RUIMTE_SESSION_ID` set.
- Every session runs a headless xterm in the daemon (10000 lines of scrollback). `session.attach` answers with the serialized screen, after which raw output streams in `session.output` events, coalesced per 16 ms.
- Several clients may attach to one session. Attaching with different `cols`/`rows` resizes the session; the last attacher wins.
- A shell that exits on its own stays in `session.list` as `exited` with its `exitCode` so the last screen can still be read. `session.kill` removes it.

## Snapshots

Every 30 seconds, and on `SIGINT`/`SIGTERM`, the daemon writes each session's screen to `sessions/<sessionId>.txt` (temp file, then rename). When the daemon starts again and a client creates a session with an id that has a snapshot, the first attach shows the snapshot, the restored marker and then the fresh shell. `session.kill` deletes the snapshot on purpose: a killed session should not come back.

## Agent status via hooks

Every shell gets `RUIMTE_HOOK_URL` (`http://127.0.0.1:<port>/hooks`) and a per-session `RUIMTE_HOOK_TOKEN`. At startup the daemon puts one command hook per lifecycle event into `~/.claude/settings.json` and `~/.codex/hooks.json` (idempotent merge; hooks of other tools stay). The hook POSTs its stdin to `$RUIMTE_HOOK_URL/<kind>` with the token as bearer, and does nothing outside Ruimte. Codex asks you to trust the new hooks once (`/hooks`).

The daemon folds the events into one status per session: `running`, `needs-you` (permission prompt, `AskUserQuestion`, elicitation), `idle` (turn ended) or `error` (the shell died under a live agent). Every client gets it as a `session.status` event with the CLI's session id and transcript path, and `session.list` carries the same `agent` field.

The record is also written to `sessions/<id>.agent.json`. When the daemon starts again and the session is restored from its snapshot, the agent comes back with `live: false`; the client answers with `agent.resume`, which types `claude --resume <id>` (or `codex resume <id>`) into the shell.

## Providers and models

`provider.list` answers, per agent CLI, whether it is installed, its version and the models it offers. The catalogs are `src/providers/claude-models.json` and `src/providers/codex-models.json`: a model points at a profile, a profile lists option descriptors (reasoning effort, context window, thinking) with their defaults and the context size per option. Adding a model is a JSON edit; a new profile is only needed for a new combination of options. The Codex catalog mirrors what `codex app-server` answers on `model/list` for 0.153 (six models, each with its own reasoning ladder and default); the context windows were measured per model through `thread/tokenUsage/updated`. A `ModelSelection` is `{ model, options }`; the daemon normalizes it (aliases like `opus` or `astra`, defaults for missing options, unknown options dropped).

Two modes travel with every chat. The runtime mode is the permission policy, one vocabulary for every provider: `supervised`, `auto-accept-edits`, `auto`, `full-access` (the default). The interaction mode is `default` or `plan`. For Claude they become `--permission-mode` (plan wins over the runtime mode), the selection becomes `--model <slug>[1m]` and `--effort`, and `ultrathink` is written into the prompt because the CLI has no flag for it.

For Codex (`src/providers/codex.ts`) the runtime mode becomes an approval policy plus a sandbox on `thread/start`: `supervised` is `untrusted` in a `read-only` sandbox, `auto-accept-edits` is `untrusted` in `workspace-write` (edits inside the workspace pass the sandbox, commands still ask unless Codex knows them as safe; the CLI has no "ask for commands, not for edits" policy), `auto` is `on-request` in `workspace-write` (Codex's own default) and `full-access` is `never` in `danger-full-access`. The reasoning effort travels as `effort` on every `turn/start`. Plan mode does not exist on the app-server protocol of 0.153 (the collaboration mode is only reported, never taken), so it is a `read-only` sandbox plus an instruction at the top of the prompt. The `approvals_reviewer` from `~/.codex/config.toml` is left alone; with `auto_review` some approvals never reach the person.

## Chats

A chat node is `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`, spawned on the first `chat.send` and kept alive between turns. The daemon folds the stream into thread items (turn, user, assistant, tool, approval, question, note, compaction), every item tagged with its turn, and broadcasts every change as a `chat.event` to the attached clients; `chat.attach` answers the current thread, so a reload rebuilds the view.

- A `can_use_tool` control request becomes an approval item and `needs-you`; `chat.approve` answers it with `allow`, `allow-always` (the CLI's own suggested rule goes back as `updatedPermissions`) or `deny`.
- An `AskUserQuestion` call becomes a question item instead; `chat.answer` returns the answers keyed by question index, the daemon keys them by question text for the CLI.
- `chat.configure` changes the selection or a mode. A running process keeps its flags until the turn ends; the next send starts a fresh process with `--resume` and the new flags.
- `chat.cancel` sends an interrupt and the turn ends as `aborted`. `chat.compact` sends `/compact`.
- The thread is written to `chats/<id>.json` after every turn; a chat whose process ended (or a daemon that restarted) starts the CLI again with `--resume` on the next send.

A Codex chat (`provider: 'codex'` on `chat.create`) is `codex app-server`, JSON-RPC over stdio (`src/chat/codex-transport.ts`, `codex-session.ts`, `codex-stream.ts`). The first send spawns it and handshakes: `initialize`, `initialized`, then `thread/start` with cwd, model, approval policy and sandbox, or `thread/resume` with the stored thread id (a thread Codex no longer has falls back to a fresh one with a warning on the thread). Every message is a `turn/start`; the notifications fold into the same thread items, so the client does not know the difference:

- `agentMessage` items stream through `item/agentMessage/delta` into assistant items; `plan` items are assistant text too. Reasoning items are not shown.
- `commandExecution` is a `Bash` tool item (the `/bin/zsh -lc` wrapper stripped, `aggregatedOutput` as output), `fileChange` an `ApplyPatch` tool item with the unified diffs as output, `mcpToolCall` and `dynamicToolCall` tool items under their own names, `contextCompaction` a compaction marker.
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
