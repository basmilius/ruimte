# Runtime parity

This note records the native terminal, process, provider, chat and device behavior in `apps/server-rust`, synchronized with main at `09fa3976`.
The TypeScript daemon remains the compatibility reference. Evidence below uses temporary homes,
local fake provider executables, real PTYs, and the checked-in Zod contracts. It does not use paid
provider accounts or installed service configuration.

## Terminal sessions

| Behavior | Status | Evidence or limit |
| --- | --- | --- |
| PTY lifecycle | Implemented and tested | `portable-pty` starts a real shell. A bounded writer worker keeps resize, kill, resync, and shutdown responsive when the foreground process does not read. Natural exit releases writer threads and PTY descriptors while the actor keeps attachable history. |
| Output and attach ordering | Implemented and tested | One actor parses output and owns viewers. Attach registers the viewer and captures the screen in one actor turn. The router queues the attach reply before later deltas. Trailing output is drained before `session.exit`. |
| Slow viewers | Implemented and tested | At high water, the shared output queue marks the session stale. When the queue drains, an actor-ordered resync captures the latest screen. Mandatory replies and other events remain ordered; hard overflow disconnects the client. |
| UTF-8 and xterm geometry | Implemented and tested | The decoder retains incomplete UTF-8 suffixes after invalid runs. Ruimte configures the emulator with xterm's Unicode 6 width table and compatibility behavior for saved cursors, soft wrapping, tabs, explicit spaces, and wide-cell edits. |
| Screen serialization | Implemented and tested | ANSI snapshots include scrollback, both screen buffers, attributes, links, cursor state, margins, modes, pending wrap, and later continuation writes. The 15-case checked-in xterm replay covers tabs, wide edits, erase, saved cursors, Unicode, alternate screen, and wrap metadata. |
| Resize and clear | Implemented and tested | Alacritty reflows the grid on live resize. Clear keeps the cursor line as the first row, removes the other visible rows and history, and sends an ordered resync. |
| Snapshot persistence | Implemented and tested | `$RUIMTE_HOME/sessions/<encoded-id>.txt` stays compatible with the TypeScript format. Private unique temporary files are fsynced and atomically renamed. Shutdown flushes the screen before signaling the shell. |
| Signals and shutdown | Implemented and tested | Signals use process groups. Escalation is cancelled when the owned child exits, so PID reuse cannot receive a late signal. The two-phase shutdown gate refuses new children and interrupts blocked writes before request draining. |
| Terminal agents | Implemented and tested | Claude and Codex launch with scrubbed owned hook/context credentials. Model, mode, session identity, and resume arguments survive restart without auto-launch. Hook status, context, approvals, notices, titles, and stopped-agent resumption use native services. |
| Known compatibility boundary | Matches the TypeScript limitation | A leading combining mark cannot be reconstructed exactly by the baseline TypeScript snapshot serializer either. The terminal replay test records that shared limitation separately; the other 14 cases require live and reconstructed xterm state to match. |

Ruimte vendors `alacritty_terminal` 0.26.0 from Alacritty 0.16.1. The patch exposes immutable
serializer state and adds opt-in xterm compatibility settings. Upstream defaults remain unchanged.
The exact source revision, licenses, patch inventory, and differential coverage are in
`vendor/alacritty_terminal/README-RUIMTE.md`.

## Process monitor

| Behavior | Status | Evidence or limit |
| --- | --- | --- |
| macOS sampling | Implemented and tested | Native libproc and Mach calls read bounded process identity, paths, timebase-correct CPU time, footprint, disk counters, host CPU, memory, awake time, and suspended time. Foreign processes remain visible without granting signal authority. |
| Linux sampling | Implemented and tested | `/proc`, `CLOCK_MONOTONIC`, and boot-time counters provide the same model. Parsing covers names with spaces and closing parentheses, avoids guest-time double counting, and distinguishes suspend from awake time. |
| Rates and history | Implemented and tested | PID plus start time identifies a process. Counter differences use awake elapsed time. Fine and coarse histories reset across sleep and never carry counters across PID reuse. |
| Grouping and machine work | Implemented and tested | Native session and chat facts separate terminal, agent, daemon, and other work. Active chat turns count as agent work; an idle shell counts only when it owns foreground child work. Self-update uses these facts. |
| Signals | Implemented and tested | A blocking native operation rechecks start time and UID immediately before sending a signal. PID 1, the daemon, foreign users, and stale identities are refused. |
| Alerts | Implemented and tested | The native stuck judge covers silent or busy agents, memory growth, missing agents, orphaned processes, hung probes, dismissals, and idle sampling. Its 129-call fixture comes from the TypeScript implementation. |
| Process ownership cleanup | Implemented and tested | Chat and terminal processes run in owned groups. Linux integration keeps exited history while returning writer-task and PTY descriptor counts to baseline. |

## Providers and chat

| Behavior | Status | Evidence or limit |
| --- | --- | --- |
| Provider setup | Implemented and tested | Claude and Codex catalogs, selection normalization, command flags, environment scrubbing, version detection, startup handshakes, resume, configure, and process generations run natively. Codex waits for initialize before starting or resuming a thread. |
| Protocol normalization | Implemented and tested | The Claude stream-json and Codex app-server normalizers match the 33-instance, 98-step TypeScript fixture. The projector matches 11 scenarios and 54 steps covering thinking, tools, usage, questions, approvals, compaction, subagents, exit, and limits. |
| Process ownership and bounds | Implemented and tested | Each provider runs in an owned process group. Input has frame and byte bounds. Stdout and stderr drain independently, line readers reject oversized frames before unbounded allocation, and stale process generations cannot mutate a newer turn. |
| Durable event stream | Implemented and tested | Each event is appended before broadcast. A failed append forces a private atomic snapshot before an operation may succeed; if both writes fail, no provider input or workflow settlement is published. Snapshots fold the journal after 64 events or 1 MiB, and also on required non-event state changes and shutdown. |
| Snapshot and journal compaction | Implemented and tested | A successful snapshot records its exact sequence before the actor atomically removes journal records at or below that sequence. Newer records remain. Recovery accepts a valid unterminated record, ignores a torn tail, rebuilds a chat from a contiguous journal without a snapshot, and does not replay folded events twice. |
| Attach, reconnect, and history | Implemented and tested | Attach returns a full thread or a bounded history page. `since` returns an empty item list plus the complete retained event tail when covered. A pre-reset, compacted, missing, or future sequence falls back to a full snapshot. History cursors expire after reset. |
| Turn lifecycle | Implemented and tested | Send, queue, unqueue, send-now interruption, cancel, forced clear, compact, configure, restart resume, and intentional stop are serialized by one actor. Stable operation IDs prevent duplicate start and wake effects after settlement or restart. |
| Inputs and assets | Implemented and tested | Provider prompts preserve effort, preambles, attachments, mentions, context changes, notices, and final skill invocation order. Attachment storage is private and jailed; authenticated GET, HEAD, and range responses use resolved metadata. Skills honor provider root precedence and client collation. |
| Requests and projection | Implemented and tested | Tool progress and output, approvals, questions, streamed text, usage, limits, and compaction produce contract-valid rows and responses. Approval and question replies use the provider's live protocol instead of fabricated success. |
| Forks and checkpoints | Implemented and tested | Claude transcript cuts and Codex thread forks support same-provider and cross-provider continuation. Git checkpoints produce per-turn diffs. Worktree setup rolls back owned effects on failure; unspoken fork cleanup removes only the fork record, plans, and owned transcript while retaining the worktree. |
| Tasks, summaries, and subagents | Implemented and tested | Runtime facts settle durable task rows and wake parents once. Fork summaries reach the original chat. Claude transcript and Codex thread subagents support paging, scoped cursors, client-owned watches, native IDs, stopping, fork ancestry, source timestamps, and orphan settlement. |
| Hooks, identity, and context | Implemented and tested | One live bearer authority covers hooks, chat, terminal, and `/context`. Tokens are generation-checked and revoked on stop or replacement. Launch depth, context notes, notices, task rows, and runtime facts cross typed weak host interfaces without a second token registry. |
| Titles | Implemented and tested | Claude transcript titles and Codex one-shot suggestions update chat names. Terminal hooks read Claude and Codex titles with throttling and bounded retries. One-shot helpers own and clean their process groups. |
| Runtime fact cost | Implemented and tested | Chat facts publish on lifecycle and turn transitions, including durable settlement. Token deltas still update clients and the journal but do not trigger a full workflow thread inspection. |

## Verification

The synchronized macOS checkpoint has 188 passing library tests. Eight opt-in tests pass separately: six xterm oracles and two real device command-process tests. Nine real PTY and fake-provider chat integrations also pass. `cargo build --bins`, `cargo fmt --check`, and all-target
Clippy with warnings denied also pass.

The real-runtime Rust tests use temporary homes and own every child they start:

- `runtime_integration.rs` covers shell execution, live resize, Unicode, trailing output, restart,
  blocked-writer cancellation, shutdown admission, and PID identity signaling.
- `pty_resources_integration.rs` covers Linux writer-thread and PTY descriptor reclamation while
  exited session history remains available.
- `chat_integration.rs` launches the checked-in Claude and Codex fake executables as real process
  groups, validates replies and events with the actual Zod schemas, and reloads their stores.

The Bun integration suites cover the wire behavior that crosses several Rust domains:

- `terminal-replay.integration.test.ts` compares 15 live and reconstructed xterm cases.
- `chat-storage.integration.test.ts` covers failed storage with zero provider input, retained
  `since` replay and fallback, and abrupt restart from the journal. Its three tests and 30
  assertions pass against the final binary.
- `chat-lifecycle.integration.test.ts` covers configure, history, detach, compaction, restart resume,
  and titles.
- `chat-content.integration.test.ts` covers queued turns, prompt framing, skills, attachments,
  subagent paging and watches, and orphan settlement.

The Linux/aarch64 Docker checkpoint uses the pinned Rust 1.98.1 and Bun 1.4.0 image, a read-only
source mount, `--init`, and separate Cargo caches. It has 189 passing library tests, all eight opt-in library tests and ten real PTY, resource reclamation, process and fake-provider chat integrations passing. None of these commands reads the developer's home or provider
accounts.


## Devices

Rust owns simulator/physical discovery, simulator actions/settings, subscriptions and helper lifecycle. Simulator capture/HID uses the packaged standalone simulator helper; physical capture/HID uses the bridge library linked into the server and runs in a child process of that same executable. There is no screenshot fallback in the Rust physical-device backend. Linux has no local iOS backend.

The service covers all eight device RPCs, JPEG/HEVC events and authenticated HTTP streams. Tests exercise shared ownership, input refusal, canceled startup, policy changes while a helper is starting, stream revocation and recovery. Bounded helper output and process-group cleanup prevent a stalled adapter from holding daemon shutdown indefinitely. The TypeScript oracle has 29 settings cases and 24 actions.

A disposable real simulator was exercised against both daemons and the packaged Rust server, including input and accessibility settings, with no Bun on the production daemon’s PATH. A later iPhone 18 Pro Max check passed HEVC capture over HTTP and WebSocket events, with every captured frame decoded by Chromium WebCodecs. Physical HID was not exercised. Full evidence and production build limits are in [VERIFICATION.md](VERIFICATION.md) and [RELEASE.md](RELEASE.md).
