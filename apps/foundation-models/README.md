# Apple Foundation Models

Ruimte's local Apple provider uses a Swift helper and the on-device
`SystemLanguageModel`. It identifies itself as Apple Foundation Models, with Ruimte as its host application.
It supports streamed conversation, persisted native model
memory, project file tools, approved shell commands, questions, web access and
configured MCP servers. The helper selects tools; the daemon owns execution and
approval cards.

## Enable and build

Requirements: Apple silicon, macOS 26.4 or later, Apple Intelligence enabled and its
model available. Ruimte probes availability; it does not change Apple settings or
force model downloads.

Enable **Settings → Providers → Apple Foundation Models** on the machine running
the chat. The machine setting is off by default. Disabling it withdraws requests
and ends running Apple helpers. Select Apple Foundation Models in a chat's
provider picker. The former experimental environment flag does not enable it.

For a development checkout:

```sh
swift build --package-path apps/foundation-models
apps/foundation-models/.build/debug/ruimte-foundation-models --probe
RUIMTE_HOME="$(mktemp -d /tmp/ruimte-apple-dev.XXXXXX)" bun run dev:server
```

Run `bun run dev:client` separately, connect to the development daemon on port
4211, and enable Apple in that machine's settings. A fresh development home keeps
these tests separate from live state.

Build the arm64 release helper with:

```sh
bun apps/foundation-models/scripts/build.ts
```

This produces `apps/foundation-models/dist/ruimte-foundation-models`. The desktop
and npm packaging paths include it for macOS arm64. A development provider prefers
that release build when present, otherwise its debug build. Override the binary
with `RUIMTE_APPLE_FOUNDATION_HELPER` on the daemon when testing another build.

The client and daemon must understand the `apple` provider kind. Older iOS builds
without that contract update cannot use these chats. Native conversation forking
is not implemented.

## Tools and approval

Every file, command, web and MCP call asks for approval in all current
runtime modes. There is no "allow always" policy. `AskUserQuestion` opens a question card
and returns the person's answer directly to the model.

Replies carry a structured `needsUserInput` decision. If the model requests
input through that response instead of calling the tool, the helper opens the
same question card and resumes after the answer. Normal answers stream as text.
A turn permits at most three questions across both paths and 12 tool calls total.
Exceeding either budget throws before opening another card.

A denial or execution failure is a typed terminal result, not conversational text.
The daemon seals the turn immediately, withdraws other pending requests, aborts
running tools, and ignores late model text or new calls. Denials end as aborted;
operation failures end as errors. This does not undo earlier effects or guarantee
that an external server honors cancellation.

An `Edit` with no unique exact match is a recoverable validation error: the file
has not changed, the failed call stays visible, and the model may read again and
submit a corrected call for approval. Three rejected matches stop the turn. A rejected edit stays unresolved until an
Edit on the same file succeeds. Completion text is withheld while an edit remains
unresolved; bounded follow-up generation asks for a correction.
No operation is replayed automatically. Read results enter model context as text
with original line breaks and pagination metadata, avoiding copied JSON escapes.

Generation is limited to 120 seconds between tool calls. Waiting for a person is
excluded. An approved tool has a 60-second execution deadline; individual tools
may impose a shorter limit. A stopped helper gets five seconds to settle before
it is closed. Failed or interrupted mutations require inspecting the current
state before trying again.

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

The model and chat cards use these names. They follow Claude's naming where the
operations overlap, but retain the behavior listed here: `Grep` is literal search,
`Write` creates only, and `ListFiles` lists one directory. The private helper
protocol keeps its tool identifiers. Protocol version 3 distinguishes recoverable edit validation from terminal errors;
an older helper is refused at startup so it cannot misinterpret an outcome.

File tools accept project-relative paths and reject parent traversal, symlinks,
hidden state and common credential filenames. `.gitignore`, `.gitattributes` and
`.editorconfig` remain readable. Files are limited to 256 KiB; tool results fit
6000 UTF-8 bytes. Search respects conservative `.gitignore` exclusions and skips
build directories. New-file parent directories must already exist.

Shell commands run with the machine account's permissions. Their working
directory is not a sandbox. They can read or change files outside the project,
use the network, or start other programs. The approval card shows the command.
Stop and timeout kill its process group; output is bounded, with truncation and
exit status reported. Commands needing interactive stdin are unsupported.

Web and remote MCP requests send their approved inputs to external services.
MCP tools may change external data or run local programs, according to the server.
All retrieved content is marked in model instructions as untrusted data. The
filename filters cannot identify every secret; review which files and requests
you approve.

## Web and MCP configuration

Use the Apple provider account's environment-variable editor in Settings.
Configure `BRAVE_SEARCH_API_KEY` as a sensitive variable, or `SEARXNG_URL` with a
publicly reachable SearXNG JSON search endpoint. Without either, `WebSearch`
returns a configuration error. `WebFetch` needs no search key. Page fetching
rejects private/local network destinations and bounds redirects, response size
and request time.

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

These are placeholders, not installed servers. Store `MY_MCP_TOKEN` as a sensitive
Apple account variable. MCP supports stdio and Streamable HTTP, with configured
headers. Interactive OAuth discovery and authorization are not implemented.
Connections remain available across calls and close with the chat helper. Use
`allowedTools` to restrict what a configured server offers.

To keep schemas within local context, `MCPListTools` without arguments lists
server names. Passing `server` lists tool names and descriptions. Passing both
`server` and `tool` returns that tool's input schema. Oversized schemas fail with
a bounded error instead of returning incomplete JSON.

## Memory, context and storage

Each chat has a UUID native session. The helper is launched with `--session UUID`
and `--home PATH`; restarting an existing conversation also passes `--resume`.
Completed native transcripts are stored as versioned JSON under
`$RUIMTE_HOME/apple-foundation/sessions`, in private directories and mode-0600
files. Writes use an atomic replacement; an exclusive lock prevents two helpers
from modifying the same conversation. Missing, corrupt, mismatched or unsafe
resume files produce an explicit startup error.

Each successful turn retains its model transcript, including tool results, in an
original history separate from the active context. Checkpoint format 2 stores
both, a SHA-256 fingerprint of the tool definitions, and an interrupted-turn
marker. Version-1 checkpoints migrate without discarding their available history.
Changed tool definitions require a new chat; instruction-only updates refresh
on restore. Checkpoints remain bounded to 2 MiB and an oversized replacement
leaves the previous checkpoint intact.

Before generation, the helper persists a checkpoint marked as interrupted.
Success clears that marker. A process crash leaves a warning on restore: actions
may already have affected files or services and are never automatically replayed.
An ordinary failure restores the previous model context. If a mutation may have
started, the next turn also receives the recovery warning. Clearing a chat starts
a new native session; previous checkpoint files are retained.

Before inference, Apple's tokenizer measures the active transcript, prompt and
structured response schema against `SystemLanguageModel.contextSize`, with 1280
tokens reserved for response and overhead. Fixed components that cannot fit fail
before summarization. At context overflow or 12 native exchanges, a separate
local session without tools summarizes older history while retaining the latest
two exchanges verbatim. Manual compaction uses the same path.

Complete tool exchanges are validated before rewriting history. The candidate
context is measured again before it is installed. Empty summaries, incomplete
exchanges, a summarizer input that does not fit, or an oversized candidate fail
without discarding the saved history. There is no silent truncation fallback.
Summaries can still omit or misstate facts; original history stays on disk and
source files should be reread before edits. A single very large recent exchange
may require a new chat rather than compaction.

User messages are limited to 6000 UTF-8 bytes and each generation to 1024 output
tokens. Tool results can still exhaust context during a native generation; the
failure is reported and the turn is not retried. Use smaller reads or shorter
tasks when needed.

The provider does not load linked nodes, attachments, skills or mentioned files
automatically. There is no agent delegation, durable background task queue,
cross-chat searchable memory, native fork, thinking stream or cloud fallback.
Model quality remains separate from runtime correctness. Our workday evaluation
still catches premature questions, and the user's latest fixture had a created
reply but an unchanged planning file and an unresolved meeting-time conflict.

## Streaming performance

The helper starts prewarming its restored or new session before reporting ready.
Snapshots go straight to the backend; there is no per-character timer in that
bridge. The chat UI still uses its shared reveal animation. Prewarming can prepare
model resources, but cannot guarantee faster text generation.

Run a repeatable three-turn measurement in a temporary session:

```sh
bun apps/foundation-models/stream-benchmark.ts
```

This measures time to first text, streamed characters per second, and delay from
the helper's stdout to backend text events. It does not measure network or browser
rendering. On this Mac, three runs after the naming update took 2.2 to 3.1 seconds
to first text, then 187 to 246 characters per second. The maximum measured bridge
delay was 1.02 ms. There was no clear speedup over the preceding run. These are
single-session observations, not token throughput or performance guarantees.

Apple documents [session prewarming](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:)).

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

The workflow smoke copies the supplied fixture into temporary directories. Its
default checks verify a natural-language question card, the returned answer,
cancellation, and a denied read ending without another question. Add
`--evaluate-workday` to evaluate the complete planning task. This is a model-quality
evaluation: an early question or a missing output fails it, even if transport works.

Native context integration is opt-in so ordinary Swift tests need no model/XPC:

```sh
RUIMTE_TEST_NATIVE_APPLE=1 swift test --package-path apps/foundation-models \
  --filter nativeSummaryPreservesSavedHistoryAndRestoresConversation
```

It seeds completed conversation facts, runs the actual local summarizer, verifies
the original saved history, restores the helper and asks for facts from the summary.
The deterministic tests separately exercise refusal, cancellation, budgets, late
replies, checkpoint compatibility, crash markers, atomic size failures and complete
tool exchanges. The native test remains sensitive to model quality. The separate
`nativeCompactionHandlesSchemaHeavyHistory` test covers the regression where native
checkpoint JSON exceeded the summarizer budget. Its source dropped from 7522 to
632 tokens by excluding repeated response schemas and identifiers, while keeping
all 24 original exchanges on disk.

Current verification: 115 focused backend/tool tests pass, and workspace checks
pass. Natural-language questions, cancellation and final denial pass in the
workflow smoke. Visible tests through Ruimte computer use in Ruimte Dev reproduced premature
clarification, an invalid Edit match, and a native Edit argument missing its path.
The targeted Edit recovery test passed: a rejected match, a fresh Read, then a
successful exact replacement verified on disk. The complete workday evaluation
is still not passing. The latest long native smoke failed on a memory answer, so the
full long-running scenario is not claimed as passing. See the
[recorded evidence](../../docs/reports/2026-09-25-apple-foundation-verification.json).

The real-model smoke creates temporary project fixtures and a separate state
folder. It exercises memory, file listing, reading, search, editing, new-file
creation, a `printf` command, questions, denied reads, cancellation, native resume
and manual summarization. It approves only its scripted fixture operations and removes
its temporary state. `--trim` additionally checks retention after automatic
context summarization. Network/MCP behavior is tested separately with controlled
fixtures; the real-model smoke uses no cloud keys.

Apple's local model service requires XPC access. A command sandbox may permit the
availability probe but reject generation. Run this smoke outside that command
sandbox. In a restricted build environment, Swift may need:

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ruimte-foundation-clang \
  swift test --disable-sandbox --package-path apps/foundation-models
```

Measured September 25, 2026 on macOS 27.2 build 26B5086k, Swift 6.4, macOS 27 SDK
and Apple silicon. The deployment target is macOS 26.4; that version has not been
run here. The model reported an 8192-token context. Instructions, eleven tool
definitions and the structured response schema consume part of that context.
The helper reports instruction and tool token counts at startup; those counts
change as instructions evolve and exclude the per-response schema.

The following timings are from earlier runs, before structured question routing.
They are historical; current evidence is recorded above.

| Real-model check | Earlier observed result | Time |
| --- | --- | --- |
| Follow-up memory | Returns `LANTERN-73` from an earlier turn | 1416 ms |
| Literal search | Finds `notes.txt` | 2568 ms |
| Exact edit | Replaces violet with green in the fixture | 3125 ms |
| New file | Creates `greeting.txt` with verified text | 3102 ms |
| Command | Approved `printf` returns `command-ok` | 3101 ms |
| Question | Question card answered Blue; model repeats Blue | 3174 ms |
| Denied read | Model acknowledges refusal | 2382 ms |
| Stop | Tool approval withdrawn; turn aborted; checkpoint restored | 2407 ms |
| Native restart | New helper recalls saved `CYPRESS-19` | 2820 ms |
| Manual trim | Removes ten old turns and retains the latest two | Completed |

These are individual runs with immediate scripted approval, not latency guarantees.
The transport is JSONL with schemas in `packages/contracts/src/apple-foundation.ts`.
Swift mirrors those frames. Stdout carries protocol only. Per-turn metrics report
elapsed time, time to first answer text, tool-call count, schema tokens and the
native measured retained context. Elapsed time includes approvals and questions;
these are not pure inference timings or generated-token usage. Retained context
feeds the existing chat usage event. No prompt, tool arguments or credentials are
included in the metrics frame. Input frames are capped
at 64 KiB; cumulative Apple text snapshots become suffix deltas or replacements.

References: [Foundation Models](https://developer.apple.com/documentation/foundationmodels)
and [tool calling](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling).
Implementation and availability annotations were checked against the installed SDK.

## Reference implementation

Reviewed FoundationModelsAgent revision
[`4bc5676`](https://github.com/rudrankriyam/FoundationModelsAgent/tree/4bc5676bb25b78d691cbcca4b8c2f98d430eaba7).
Ruimte adapts its typed tool-policy failures, hard budgets, native schema accounting,
validated context transforms, original-history preservation, toolset checks and
repeatable runtime testing to this helper. The MIT notice ships beside the binary.

The upstream package requires macOS 27 and Swift 6.4. We retained macOS 26.4 and
Ruimte's existing approval, web, MCP and persistence interfaces. Its optional
provider routing, long-term memory, child agents and durable task scheduling are
separate capabilities, not enabled by this integration. Retries stay disabled;
no write or external operation is silently replayed.
