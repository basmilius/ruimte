# Apple Foundation Models

The Swift helper behind Ruimte's local Apple provider, on the on-device `SystemLanguageModel`. It identifies itself as Apple Foundation Models with Ruimte as host. It streams conversation, keeps native model memory, and offers project file tools, approved shell commands, questions, web access and configured MCP servers. The helper picks tools; the daemon runs them and owns the approval cards.

## Enable and build

Requires Apple silicon, macOS 26.4 or later, and Apple Intelligence on with its model available. Ruimte only probes availability and never changes Apple settings or forces a download.

Turn on Apple Foundation Models under **Settings > Agents** for the machine running the chat (off by default), then pick it in a chat's provider picker. Turning it off withdraws requests and ends running helpers.

For a development checkout:

```sh
swift build --package-path apps/foundation-models
apps/foundation-models/.build/debug/ruimte-foundation-models --probe
RUIMTE_HOME="$(mktemp -d /tmp/ruimte-apple-dev.XXXXXX)" bun run dev:server
```

Run `bun run dev:client` separately, connect to the development daemon on port 4211 and enable Apple in that machine's settings. The fresh home keeps tests away from live state.

Build the arm64 release helper with `bun apps/foundation-models/scripts/build.ts`, which writes `apps/foundation-models/dist/ruimte-foundation-models`. A development provider prefers that build, otherwise the debug build. `RUIMTE_APPLE_FOUNDATION_HELPER` on the daemon overrides the binary.

How CI, the compiled daemon and the desktop packaging carry the helper is in the root `CLAUDE.md`. The daemon starts it from `apps/server/src/providers/apple-helper.ts` (the provider) and `apps/server/src/ondevice/model.ts` (the editor's help, `--oneshot`).

Older iOS builds without the `apple` provider kind cannot use these chats. Native conversation forking is not implemented.

## One-shot mode

`ruimte-foundation-models --oneshot` runs without a conversation, session store, tools or network. It answers `availability` once, then reads `generate { id, instructions, prompt, maxTokens?, temperature? }` lines and streams `text.snapshot` frames and a `done` per request. `cancel { id }` ends one. The instructions per purpose live in `apps/server/src/ondevice`.

## Tools and approval

Every file, command, web and MCP call asks for approval in every runtime mode. There is no "allow always". `AskUserQuestion` opens a question card and returns the answer to the model. A reply can also ask for input through its structured `needsUserInput` decision, which opens the same card.

| Limit | Value |
| --- | --- |
| Questions per turn (both paths) | 3 |
| Tool calls per turn | 12 |
| Generation between tool calls | 120 seconds, waiting on a person excluded |
| Approved tool execution | 60 seconds, shorter per tool |
| Stopped helper settling | 5 seconds |
| File size | 256 KiB |
| Tool result | 6000 UTF-8 bytes |
| User message | 6000 UTF-8 bytes |
| Output per generation | 1024 tokens |
| Input frame | 64 KiB |

Exceeding a budget throws before another card opens. A denial or execution failure ends the turn at once. The daemon withdraws other pending requests, aborts running tools and ignores late text or calls. Denials end as aborted, failures as errors. Earlier effects are not undone, and an external server may ignore cancellation.

An `Edit` without a unique exact match leaves the file unchanged, and the model may read again and resubmit. Three rejected matches stop the turn. Completion text is withheld while an edit on a file stays unresolved. No operation is replayed automatically. Read results reach the model as text with original line breaks and pagination.

| Tool | Behavior |
| --- | --- |
| `ListFiles` | List one project directory, up to 40 entries |
| `Read` | Read UTF-8 text from a zero-based line offset, default and maximum 100 lines, with continuation for larger files |
| `Grep` | Literal text search with optional filename glob; results include path and line |
| `Edit` | Replace one unique exact text match; returns file-change evidence |
| `Write` | Create a new file; never overwrite an existing file |
| `Bash` | Run `/bin/sh -c` in the project directory, with a 30-second limit |
| `WebSearch` | Query the configured Brave or SearXNG search service |
| `WebFetch` | Read a public HTTP(S) page as bounded text |
| `MCPListTools` | List configured servers, list one server's tools, or inspect one tool's schema |
| `MCPCall` | Call one configured server tool with a JSON-object argument string |
| `AskUserQuestion` | Ask a question with optional choices and await the answer |

The names follow Claude's where operations overlap, but the behavior is as listed. The helper protocol keeps its own identifiers.

File tools take project-relative paths and reject parent traversal, symlinks, hidden state and common credential filenames. `.gitignore`, `.gitattributes` and `.editorconfig` stay readable. Search respects `.gitignore` and skips build directories. A new file's parent directory must exist.

Shell commands run with the machine account's permissions. The working directory is no sandbox: a command can touch files outside the project, use the network and start programs. Stop and timeout kill its process group. Output is bounded, with truncation and exit status reported. Interactive stdin is unsupported.

Web and remote MCP requests send their approved inputs to external services, and MCP tools may change external data or run local programs. Retrieved content is marked as untrusted in the model instructions. The filename filters cannot catch every secret, so review what you approve.

## Web and MCP configuration

Set variables in the Apple provider account's environment editor in Settings. `BRAVE_SEARCH_API_KEY` (as a sensitive variable) or `SEARXNG_URL` (a public SearXNG JSON endpoint) enables `WebSearch`; without either it returns a configuration error. `WebFetch` needs no key. It rejects private and local destinations and bounds redirects, size and time.

Configure MCP in `$RUIMTE_HOME/apple-mcp.json`:

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "/absolute/path/to/your-mcp-server",
      "args": [],
      "env": { "API_TOKEN": "${MY_MCP_TOKEN}" },
      "allowedTools": ["lookup"]
    },
    "remote-tools": {
      "type": "http",
      "url": "https://your-server.example/mcp",
      "headers": { "Authorization": "Bearer ${MY_MCP_TOKEN}" },
      "enabled": false
    }
  }
}
```

These are placeholders. Store `MY_MCP_TOKEN` as a sensitive Apple account variable. MCP supports stdio and Streamable HTTP with configured headers, not interactive OAuth. Connections live as long as the chat's helper. `allowedTools` restricts what a server offers.

`MCPListTools` without arguments lists server names, with `server` that server's tools, and with `server` and `tool` the input schema. An oversized schema fails with a bounded error.

## Memory, context and storage

Each chat has a UUID native session. The helper starts with `--session UUID` and `--home PATH`, plus `--resume` for an existing conversation. Transcripts are versioned JSON under `$RUIMTE_HOME/apple-foundation/sessions`, in private directories with mode-0600 files, written atomically under an exclusive lock. A missing, corrupt, mismatched or unsafe resume file is a startup error.

A checkpoint (format 2) stores the original history beside the active context, a SHA-256 fingerprint of the tool definitions and an interrupted-turn marker. Version 1 migrates. Changed tool definitions need a new chat. A checkpoint is at most 2 MiB, and an oversized one leaves the previous intact.

The helper saves a checkpoint marked interrupted before generation and clears the mark on success. After a crash, restore warns that actions may already have run; they are never replayed. An ordinary failure restores the previous context, with the same warning if a mutation may have started. Clearing a chat starts a new session and keeps the old files.

Before inference, Apple's tokenizer measures transcript, prompt and response schema against `SystemLanguageModel.contextSize`, with 1280 tokens reserved. At overflow or after 12 exchanges, a separate tool-less session summarizes older history and keeps the last two exchanges verbatim. Manual compaction takes the same path. A summary that is empty, incomplete or too large fails without touching saved history; nothing truncates silently. A single huge exchange may need a new chat. The context is small (8192 tokens on macOS 27), and the helper reports instruction and tool token counts at startup.

The provider loads no linked nodes, attachments, skills or mentioned files. It has no delegation, background task queue, cross-chat memory, native fork, thinking stream or cloud fallback. Open model-quality checks are in `docs/ACCEPTANCE.md`.

## Streaming performance

The helper prewarms its session ([Apple's docs](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:))) before it reports ready, and sends snapshots straight to the backend. Measure three turns in a temporary session with:

```sh
bun apps/foundation-models/stream-benchmark.ts
```

It reports time to first text, characters per second and the delay from stdout to backend events, not network or rendering.

## Verification

```sh
swift test --package-path apps/foundation-models
bun test apps/server/src/chat/apple-backend.test.ts \
  apps/server/src/chat/chat-manager.apple.test.ts \
  apps/server/src/providers/apple-provider.test.ts
bun apps/foundation-models/smoke.ts
bun apps/foundation-models/smoke.ts --trim
bun apps/foundation-models/workflow-smoke.ts /path/to/workday-fixture
```

The smokes use temporary fixtures and state, approve only their scripted operations and need no cloud keys. `--trim` also checks retention after summarization. The workflow smoke checks a question card, its answer, cancellation and a denied read. `--evaluate-workday` adds the full planning task, which is a model-quality check.

Native context integration is opt-in, so ordinary Swift tests need no model:

```sh
RUIMTE_TEST_NATIVE_APPLE=1 swift test --package-path apps/foundation-models \
  --filter nativeSummaryPreservesSavedHistoryAndRestoresConversation
```

Recorded runs are in [`verification.json`](verification.json).

Apple's model service needs XPC, so run the smokes outside a command sandbox. In a restricted build environment Swift may need:

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ruimte-foundation-clang \
  swift test --disable-sandbox --package-path apps/foundation-models
```

## Protocol

JSONL on stdin and stdout, schemas in `packages/contracts/src/apple-foundation.ts`, mirrored in Swift. Stdout carries protocol only. The daemon refuses a helper with an older protocol version. Cumulative text snapshots become suffix deltas or replacements.

Per-turn metrics report elapsed time (approvals included), time to first text, tool calls, schema tokens and retained context, which feeds the chat usage event. They carry no prompt, tool arguments or credentials.

References: [Foundation Models](https://developer.apple.com/documentation/foundationmodels) and [tool calling](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling).

## Reference implementation

The helper adapts ideas from FoundationModelsAgent revision [`4bc5676`](https://github.com/rudrankriyam/FoundationModelsAgent/tree/4bc5676bb25b78d691cbcca4b8c2f98d430eaba7): typed tool-policy failures, hard budgets, schema accounting, validated context transforms and original-history preservation. The MIT notice ships beside the binary (`THIRD_PARTY_NOTICES.txt`).
