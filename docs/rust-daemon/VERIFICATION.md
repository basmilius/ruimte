# Verification strategy and evidence

Current baseline: main `09fa3976ddfca4971549deb07ae94efa08fa664b`. See [REVIEW.md](REVIEW.md) for results and limits, and [RELEASE.md](RELEASE.md) for native production builds. The entries below retain the investigation history. The final synchronization section supersedes the earlier `3b46403` scope and exclusions.

The TypeScript daemon at the worktree baseline is the behavioral oracle. Rust tests alone can accidentally prove an incompatible implementation. Use temporary homes and fake vendor executables; do not spend tokens on real agent accounts or touch installed service configuration.

## Contract boundary

Generate a deterministic corpus from the Zod contracts. Include valid minimal inputs, absent optional fields, explicit nulls, unknown properties at each nesting level, union branches, invalid enums and bounds, and malformed frames. Compare the normalized Rust request with Zod's parsed value, not only acceptance. Add explicit cases for refinements and preprocessors that JSON schema cannot represent. Run the same checks on results and events emitted by real operations. Compile validators once at startup.

Signatures must be tested across implementations: generate keys and signed messages on each side and verify on the other. Include challenge replay, invalid signatures spending a nonce, valid pairing tokens surviving a wrong attempt, ticket expiration, revocation of connected clients, forbidden origins and lack of a loopback bypass. Pairing tokens belong in URL fragments.

## Storage compatibility

Create state in TypeScript, stop it, open the same temporary home in Rust, mutate it, stop it, and reopen it in TypeScript. Cover endpoint identity, paired keys, projects and local state, unknown nodes and views, drawings and diagrams, terminal snapshots, chat logs and attachments, plans, tasks, notices and outbox. Read-only opening must not change identity or silently discard optional invalid metadata. Interrupted atomic writes must leave either the old or new valid document.

Project tests include two clients saving from one revision, edits made outside the daemon, release/reopen, orphan cleanup and a failed icon upload preserving the prior icon. Derived icons must obey the existing realpath boundary. Compare error codes and invariant handling as well as content.

## Terminal and process behavior

Feed a deterministic corpus to xterm and the Rust terminal. Serialize the Rust screen into a fresh xterm, then compare visible cells, attributes, cursor, wrapping, normal/alternate buffers and relevant modes. Include Unicode split between PTY reads, combining marks, wide characters, long lines resized narrower and wider, scrollback limits, erase, colors, cursor saves and application modes. Test real PTYs separately from screen-model tests.

Attach a client during output; the snapshot and subsequent stream must reconstruct exactly one copy of every byte effect. Exercise slow consumers and resync, detach/reconnect, child exit with trailing output, repeated kill, persisted snapshots and graceful daemon shutdown. Process signaling must reject PID reuse by checking identity, never infer permission from PID alone.

## Agent and workflow behavior

Use the existing fake Claude and Codex CLI protocols as fixtures, including approvals, questions, tools, usage, malformed frames, process death and stale events from an old generation. Compare sequenced durable history and queued-turn behavior. Exercise interruption recovery, forks and rollback, checkpoints, subagent settlement and summaries.

Canvas commands must enforce creator ownership, depth and permission inheritance. Tasks settle from durable lifecycle facts. Test crashes before and after outbox writes, retry exhaustion, parent busy states, batch settlement and idempotent notice delivery. A restart must not duplicate agent starts or broaden authority. Plan operations must preserve human status and revision semantics.

## Transport, media and lifecycle

Test browser actions against a local fixture page in an isolated Chromium profile, including navigation history, keyboard and pointer input, viewport/DPR changes, screencast ownership and HTTP stream framing. Disabling streaming must terminate existing streams. Authenticate every attachment, icon, file range and live-stream request.

WebSocket and WebRTC share one dispatcher and channel authentication. Exercise channel binding, fragmentation, bounds, reconnect, signed statement replay/revocation, broker changes and TURN policy using local fixtures. Build and service command tests use temporary paths and mocks, never install a real service.

## Development entry point

Run Rust and TypeScript choices separately with the same experimental home and ports. Check that one daemon is launched, Vite and Electron receive the matching endpoint, another main-branch development instance remains independent, and SIGTERM ends all children. Rust is the default in this worktree. Unknown runtime selections must fail clearly. Rust build errors must not silently fall back to TypeScript.

## Completion evidence

Update PARITY.md with implemented, tested and missing distinctions per request and supplementary route. Run formatting, compiler, meaningful native tests, Clippy, existing Bun checks and the differential integration suite. Feature completeness requires the remaining gaps to be closed; a registered method or a plausible response shape is not evidence of behavior.

## First native checkpoint, 18 September 2026

These results cover the implemented foundation, not complete daemon parity.

- Parent independently ran Linux/aarch64 library tests in official `rust:1.98.1-bookworm`, with read-only source and separate Cargo caches: 29 passed, 1 ignored. The ignored test requires Bun/xterm; it is run separately on macOS.
- This includes the 842-case actual-Zod request normalization corpus, native Linux `/proc` parsing, identity persistence/authentication cases, terminal serialization unit cases, and four temporary-project/filesystem/Git tests.
- Runtime implementation agent reports passing real macOS PTY and process-signal tests plus an xterm primary/alternate buffer replay. Parent review found that live PTY resize and output-only exit-tail markers need stronger assertions; broader continuation-state differential cases are still required.
- Core implementation agent reports the shared TypeScript/Rust HTTP and WebSocket test passing before the next transport changes. Expanded identity/ticket tests and shutdown-under-load remain in progress.
- Independent Linux real PTY/process tests are the next checkpoint. No vendor agent account, real service installation or production address book is used for these tests.

Additional deterministic usage-reader oracle prepared outside the repository at `/tmp/ruimte-rust-usage-oracle.ts` and `.json`: 14 Claude cases, 12 Codex sequences with 51 state transitions, deduplication and index-format round trip. Copy with relative imports when implementing native usage; these are expected results from the existing TypeScript implementation, not Rust implementation code.

The Linux real-runtime command completed successfully: 2 passed, 0 failed. These are the first version of the PTY and process-signal integration tests; the live resize and last-output assertions identified above are being strengthened, so this result is not evidence for those expanded checks yet.

A separate plan oracle is at `/tmp/ruimte-rust-plan-oracle.ts` and `.json`: 45 actual TypeScript operation cases, 24 allowed and 21 refused, covering actor permissions, existing human marks, atomic refusal, parent states, next-step transitions, unlock and metadata changes. Successful cases include progress and Markdown output.

## Wire comparison checkpoint

Parent ran `/tmp/ruimte-rust-workspace-wire.ts` against both real daemons using temporary Git repositories and daemon homes. All 18 replies and observed events validate with the current Zod contracts. The fixture exercises text file reads, recursive listings, rename/modified/untracked Git status, worktree/untracked/root-commit diffs, project creation/revision conflict/reopen/close, drawing and diagram persistence, and project settings.

Observed behavioral mismatches were reported to the workspace implementation agent:

- Recursive file listing descended into `.git` and ignored directories, and global sorting differed from the baseline's per-directory traversal.
- Shared worktree paths retained `./ignored` separately from `ignored` rather than normalizing and deduplicating.

The tested Git counts/rename/diffs and project/drawing/diagram operations matched after excluding generated fixture identifiers and timestamps. The harness now isolates Git's global configuration and normalizes its fixture commit identity. Remaining features outside this fixture are still unverified.

`bun run check` passes after the development selection and schema changes. Existing lint warnings remain; no new type errors were reported.

Parent also verified TypeScript → Rust → TypeScript against the same temporary daemon home and project using `/tmp/ruimte-rust-storage-switch.ts`. The original legacy pairing token authenticated after both switches; local.key bytes, endpoint ID and public key stayed identical. Project revisions advanced 1 → 2 → 3, and an unknown node's raw nested payload survived both implementations. Result: `/tmp/ruimte-rust-storage-switch.json`. This does not yet cover chat/agent/task storage, which is still being implemented.

Parent independently reran the three expanded xterm replay/continuation oracles on macOS: all 3 passed. They cover normal/alternate buffer transitions and current tested cell/style/cursor/mode/resize continuation cases. Clear behavior and attach-to-stream ordering have separate review items; passing serializer tests alone does not establish those lifecycle properties.

Parent ran the development process cleanup tests after the descendant fix: 4 unit tests pass, and the integration test passes with a TERM-ignoring grandchild whose group leader exits first. Forced cleanup removes that descendant while an unrelated process group stays alive. Integration command: `bun --config=integration.bunfig.toml test ./scripts/dev-processes.integration.test.ts` (the default Bun configuration excludes integration files even when a filename filter is supplied).


## Media and usage follow-up

Parent compared 25 real HTTP requests per daemon with `/tmp/ruimte-rust-media-wire.ts`. Ordinary SVG content, HEAD, authentication/origin refusal and standard single ranges agree. Differences remain for empty `path`, decimal ranges larger than u64, and extension-only media detection in Rust. Error content-type whitespace is semantically equivalent and is not a parity defect. The extension-only classifier also feeds `bytes.read`; workspace owns its correction. Results are in `/tmp/ruimte-rust-media-wire.json`.

Additional expected results from TypeScript are captured in `/tmp/ruimte-rust-usage-math-oracle.ts` and `.json`: 12 price lookups, 3 cost cases, 20 aggregations and 32 limit cases. Aggregation covers UTC, Amsterdam, New York, Kathmandu, invalid-zone fallback, both DST transitions, date filters, unknown prices and provider-scoped session counting. These are reference fixtures; the native usage service is still pending.


Parent independently exercised the actual WebSocket attach boundary using `/tmp/ruimte-rust-attach-wire.ts` and `/tmp/ruimte-wire-client.ts`. Five sessions per implementation attach during 200 numbered PTY output lines; the returned snapshot plus all later output/resync frames are replayed into a fresh xterm. All ten cases reconstructed every marker exactly once and in order, retained the output-only completion marker, and emitted no session output before the attach reply. Actual Zod schemas validate every reply and observed event. This covers normal-speed attach races; deliberately backpressured recovery and abrupt disconnect remain separate tests.


Parent also tested real network backpressure with `/tmp/ruimte-rust-backpressure-wire.ts`: the viewer's TCP socket is paused for two seconds while a shell emits 180,000 numbered lines (about 18 MiB). Both daemons emit one resync. Reconstructing the client screen in xterm preserves the last 1,000 markers exactly once and in sequence, plus the output-only completion marker; no event fails the actual Zod schema. The terminal retained 10,021 marker lines in each run. This is a correctness test, not a runtime speed or memory benchmark.


At the next stable checkpoint, parent reran the expanded native integrations on macOS: both fake-CLI chat tests and all three PTY/process tests passed. The chat cases now validate their full native replies and chat events against actual Zod schemas, persist their wire transcripts, and reload the stored thread in a fresh service. The three expanded PTY/process tests also pass independently in Linux/aarch64 Docker, including live resize, trailing output and kill responsiveness during a blocked 16 MiB PTY write.

The projector oracle `/tmp/ruimte-rust-projector-oracle.ts` and `.json` captures 11 scenarios and 54 steps from the actual TypeScript ThreadProjector. Each step records all emitted events, info and items, with deterministic time/random inputs and ChatEventSchema validation. It covers thinking deduplication/coalescing, tool progress, approval/question withdrawal, cumulative cost, compaction, foreground/background subagents, idle wakeups and process exit. Runtime will adopt it after separating backend normalization from projection.


The checked-in `browser.integration.test.ts` passes against a real isolated local Chrome with ten assertions. It verifies actual DOM Unicode text insertion, pointer clicks, viewport and DPR values, back navigation, page ownership, detach stopping event frames, 800×480 high-density streaming, stream termination when the endpoint disables streaming, and explicit page teardown.


Parent's latest workspace wire rerun passes all 18 requests with no semantic differences or Zod violations. The expanded media fixture passes 28 of 29 cases after normalizing semantically equivalent header whitespace; the remaining relative-path refusal is assigned to workspace. Magic detection now agrees for extensionless PNG, spoofed image extensions and symlinks.

Parent reran the independent browser behavior fixture after the fixes: actual input/pointer/history/isolation still pass; DPR2 now produces 800×480 and disabling streaming ends the existing stream while new subscriptions return 403. No observed event violates the contract.


Parent independently ran the adopted native ThreadProjector test: all 11 scenarios/54 steps match the actual TypeScript oracle exactly, including every emitted event and subsequent thread state. Provider normalizers are still being connected to this projector.

Parent's repeated actual SIGTERM fixture now confirms the two-phase shutdown correction: the 15 MiB write is pending before the signal and the daemon exits with code 0 within the 3.5-second observation window, without forced shell cleanup.


## Graphics and Unicode checkpoint

Parent independently ran the native library suite: 53 passed, 5 ignored, one known workspace Git rename test failed. Both graphics comparisons passed: 52 drawing cases and 52 diagram cases, including the separately generated 48-case graph corpus. Numeric geometry tolerance is 1e-9. The native push-envelope cross-language verification and ordered delivery/suppression tests also passed.

Parent independently reran terminal replay tests: the four existing primary/alternate/continuation/clear cases pass. A new actual-wire comparison found that Rust emoji wrapping differs from its own live bytes replayed in xterm, while TypeScript reconstructs correctly. The cause includes different Unicode width versions: the client and existing server use xterm's default Unicode 6; upstream Alacritty uses modern widths. A native width provider and generated 158-range Unicode 6 table are being added. The new Unicode/combining replay fixture is not yet green; this remains a compatibility blocker.

Protocol fixture `/tmp/ruimte-rust-protocol-oracle.ts` and `.json` replays 33 real TypeScript protocol instances and 98 method calls: Claude 15 instances/44 calls, Codex 18/54. It captures results, outbound approval/question answers, current turn ID and explicit per-step clock. The fixture was collected while all 34 original protocol tests passed, then independently regenerated with `--check`. Native normalizers must match it before full chat parity is claimed.


After the width/table and trailing-blank correction, parent independently verified all five xterm replay tests and all five macOS PTY/process integrations passing together. `bun run check` also passes with the existing lint warnings. The actual-wire Unicode case now matches cell contents/widths/cursor but still differs on one wrap flag after the login shell prints `logout`. A further 15-case actual-wire corpus (`/tmp/ruimte-rust-terminal-cases-wire.ts/json`) finds three Rust-only visible regressions in tabs, saved cursor at pending wrap, and insert/delete through wide cells; two other cases differ only in cell/wrap metadata. Leading combining marks also fail the TypeScript serializer and are tracked separately from Rust regressions.

The current Linux/aarch64 run passes shell output/resize/restart and process identity signaling, but the three blocked-write cancellation tests time out. This is a real platform-specific follow-up; the passing macOS result does not close it.

Chat-store recovery oracle `/tmp/ruimte-rust-chat-store-oracle.ts/json` has 16 actual TypeScript filesystem cases, including a missing/corrupt snapshot rebuilt from its event log, torn and unterminated lines, reset sequence, duplicate/out-of-order records and pending preambles. Its regeneration check passes.


Parent's actual daemon graphics fixture `/tmp/ruimte-rust-graphics-wire.ts/json` passes all 56 original scenes through real project/view stores and drawing.paths/diagram.layout RPCs. All replies and observed events pass actual Zod validation; numeric path geometry uses 1e-9 tolerance. The renderer's semaphore permit stays inside the blocking closure, including after caller cancellation.

The checked-in `direct.integration.test.ts` uses the production DirectClient over a real local RTCPeerConnection. It validates channel-bound local-secret RPC and idle survival, strict malformed-proof refusal, compatible legacy proof admission, paired-key authentication and DataChannel closure within three seconds of active revocation. Every endpoint result and verdict is parsed with the actual contracts.

Process-alert oracle `/tmp/ruimte-rust-alert-oracle.ts/json` captures 23 real StuckJudge instances/129 calls from the 15 passing existing tests. It preserves observe/reset/dismiss operations, thresholds and process identity maps; its regeneration check passes.

`live_agent_gone_alert_can_be_listed_and_dismissed` adds service-level coverage around that oracle. It starts an owned PTY session, applies a real running Claude hook, samples the process tree through an injected OS sampler, observes `processes.alerts`, lists the alert through RPC, and verifies dismissal clears both the wire state and the session guard cache.

## Broker and lifecycle checkpoint

Parent independently ran the native local-broker integration: 1 pass, 6 assertions. The real broker authenticates the machine, relays a paired-key WebRTC connection, and admits an unpaired client carrying a signed access statement. No external broker or account is used.

The checked-in direct integration preserves the strict-proof and revocation cases from the independent comparison. Missing and malformed proof fields are refused with no invalid null protocol field, a future protocol reports the supported version, and the compatible proof without a protocol is accepted.

The Linux resource-reclamation test caught idle PTY writer threads surviving natural shell exit. Runtime corrected their cancellation wakeup and descriptor release. The follow-up currently exposes loss of retained history when the closed PTY event channel ends the session actor; that remains a blocker until the resource and retained-history checks pass together.

Parent's project race fixture sends twelve saves against one revision from two clients. Both implementations accept exactly one, reject the other eleven with matching revision conflicts, and persist the winner. An atomic external edit emits project.changed and reloads revision 2 without contract violations.

The Linux/aarch64 rerun now passes all six lifecycle integrations together: five real PTY/process cases plus the resource test. Eight naturally exited sessions retain readable screen history while PTY writer-thread and /ptmx descriptor counts return to baseline. Blocked writes, blocked initial creation, kill and daemon shutdown all settle; live resize/restart and PID-identity signaling also pass. This closes the Linux lifecycle issues above (log: `/tmp/ruimte-rust-linux-runtime.log`).

Parent's actual-wire plan fixture passes identically on both daemons: a Unicode/percent-encoded chat filename is listed, twelve concurrent person edits from two clients produce revisions 4–15, every change remains in memory and on disk, and twelve plan.changed events pass Zod validation. Fixture: `/tmp/ruimte-rust-plan-wire.ts/json`.

Parent's next native library checkpoint is green: 70 passed, 0 failed, 5 separately run xterm replay tests. This includes provider protocol/projector fixtures, both graphics oracles, workflow/plan/notice/outbox stores, concurrent persistence and failed-write behavior. The Git rename fixture now has sufficient unchanged content for Git's rename detector and passes. Command: `cargo test --locked --manifest-path apps/server-rust/Cargo.toml --lib`; log `/tmp/ruimte-rust-lib.log`. These tests do not establish completeness of the still-unwired higher-level workflow.

Parent independently ran all three native chat integrations on Linux/aarch64 using the pinned Rust/Bun test image: Claude turn/restart, Codex turn/restart, and Claude approval plus question round trip all pass. Tests use real local fake-CLI subprocesses and validate replies/events against the actual TypeScript Zod contracts. Log: `/tmp/ruimte-rust-linux-chat.log`. Advanced queue, fork, resume, hooks and task workflow are separate pending gates.

With a fresh native binary, parent reran actual paired-key WebRTC revocation: both daemons issue tickets, authenticate contract-valid endpoint.info, and close the channel within three seconds of revocation. The static-file fixture now serves all six GET/HEAD cases correctly, including a filename containing a literal percent-encoded sequence that previously triggered double decoding.

Parent's first actual usage wire comparison reads isolated Claude/Codex logs with duplicate records and an unterminated valid tail. Five timezone requests (UTC, Amsterdam, New York, Kathmandu and invalid-zone fallback) return contract-valid replies. Totals, costs, buckets, pricing and scan fields agree with TypeScript after normalizing test paths and timing. The only observed difference is the known-project display name/ID, which is still being connected. External price/exchange refresh and provider probes are not covered by this test. Fixture: `/tmp/ruimte-rust-usage-wire.ts/json`.

## Parent verification: usage project labels and terminal replay follow-up

Fresh native build: all five actual-wire usage summaries now match TypeScript exactly after normalizing fixture paths, project IDs and scan timings. UTC, Europe/Amsterdam, America/New_York, Asia/Kathmandu and invalid-zone fallback cover duplicate Claude records, incremental Codex tail data, project names, counts, prices and buckets. Both have zero Zod violations. Scratch evidence: `/tmp/ruimte-rust-usage-wire.ts`, `.json`, `.log`.

The broader terminal corpus now matches exactly in 10/15 Rust cases (TypeScript 14/15). Saved-cursor behavior is fixed. Tabs and wide-cell insertion/deletion now display correctly, but empty cells still serialize as explicit spaces; overwrite has the same cell-metadata difference. Erase-after-wrap loses a wrapped-line flag. Leading combining marks differ in both baseline serializers. This is progress, not full terminal parity. Scratch evidence: `/tmp/ruimte-rust-terminal-cases-wire.ts`, `.json`, `.log`.

Coordinator review identified lost scheduler notifications, non-atomic wake-generation/park transitions and retained task handles. Workspace is adding actual asynchronous race coverage and shutdown admission/drain fixes. Development watcher review identified overlapping restart races, direct-child-only cleanup and spawn-error handling; core is hardening these before final dev verification.

Parent reran the full native library suite: **104 passed, 0 failed, 5 ignored** (`/tmp/ruimte-rust-lib.log`). Actual terminal-hook HTTP/WebSocket checks match TypeScript for six lifecycle statuses and active-agent counts, approval choices, allow response and duplicate refusal, with zero contract violations. Rust correctly rejects a killed generation's bearer. A pending permission request still needed release after Stop; runtime is correcting that case. Hook context replies remain under implementation. Evidence: `/tmp/ruimte-rust-hooks-wire.ts`, `.json`, `.log`.

All **29 authenticated media HTTP cases now match** TypeScript, including relative-path refusal (`/tmp/ruimte-rust-media-wire.log`). The parent also reran both development watcher integrations successfully: coalesced serialized builds/restarts and forced cleanup of an owned stubborn descendant while an unrelated process survives. A further source review found an unexpected-daemon-exit cleanup gap, reported to core before closing the dev gate.

## Parent replay after native fork/checkpoint wave

- Fresh binary: canvas corpus completes 25 HTTP operations against both daemons. Final project validates; no event violations. Person-owned deletion remains refused. Generated IDs differ; two refusal/help strings remain under alignment.
- Actual terminal hooks now match SessionStart base context and six status/work-count transitions, approval choices/answer/duplicate refusal, and Stop releasing a held approval. The native daemon rejects a killed generation's bearer (401); baseline returns 204. Default authenticated WebSocket registration was also exercised without `session.attach` or `agent.setApprovals`.
- Actual Claude and Codex queue lifecycle matches semantic thread content, including graceful interrupt output, unqueue, send-now, automatic drain, busy-clear refusal and force-clear. No Zod event/result violations.
- Actual Git checkpoint/fork fixture: two turns write separate files; per-turn diffs match TypeScript. A fork after turn one restores only that turn's files into an owned worktree, leaves the source checkout untouched, keeps the index on HEAD, and records a new turn's diff only in the fork. Claude-to-Codex fork placement as a view and continuation also pass. A turn metadata mismatch (`turnId`/`origin`) was separately reported and corrected by runtime.
- TypeScript selection via the root `bun dev` starts Vite, the daemon and an isolated Electron profile; the existing desktop smoke verifies the preload bridge and capture. Rust's existing smoke can exit before compilation finishes, so this is not accepted as Rust daemon/UI evidence; an explicit live start waiting for health is underway.

Reproducers in the parent session: `/tmp/ruimte-rust-canvas-wire.ts`, `/tmp/ruimte-rust-default-approval-wire.ts`, `/tmp/ruimte-rust-chat-queue-wire.ts`, `/tmp/ruimte-rust-fork-wire.ts`, `/tmp/ruimte-rust-dev-smoke.ts`. These are review evidence; final reusable integration coverage belongs in the repository before claiming the corresponding full parity gate.

## Actual desktop with Rust selected

Parent ran root `bun dev` with Rust selected, a temporary daemon home, temporary provider config directories, unique desktop profile and loopback ports. After native health became ready, the real Electron client connected, created and saved a local project, and automatically reconnected after a watched source rebuild. Through the desktop UI, a Terminal node opened a shell and `printf 'RUST_UI_OK\n'` produced the visible expected output. Quitting that test app stopped both daemon and Vite; both ports were checked closed and the temporary home/profile removed. This verifies the native daemon/client path beyond the shorter preload smoke.

## Remaining behavior review

- Parent headless workflow wire fixture now passes against both TypeScript and Rust: a real fake-provider parent opens a Claude child with `--task`; every WebSocket disconnects and the project is released; the child's authenticated `done` settles the durable task, starts an agent-origin parent turn with the task ID, and drains the outbox. No contract violations.
- Parent's extended fork fixture found a still-open summary settlement gap: the native fork finishes a turn carrying `summaryFor`, but the original chat receives no note and no summary outbox work appears. Workspace/runtime own the correction; a completed summary RPC alone is not accepted as delivery evidence.
- Parent captured real child launch arguments before/after `chat.configure`. The initial native draft changed public info without restarting the provider with the new model/mode/resume arguments. Runtime is correcting this; the regression fixture captures both Claude argv and Codex JSON-RPC frames.
- Latest baseline regression suite: 3,649 passed, 69 skipped, 0 failed; 32,764 assertions across 351 files. This does not replace the native or integration gates.

## Parent integration: provider reconfiguration, teams and views

A rebuilt binary now passes the actual Claude and Codex reconfiguration fixture. The second turn uses the changed effort and permissions, retains the same provider session, and launches a fresh backend. Captured Codex traffic confirms initialize → initialized → thread/resume → model/list → turn/start; Claude receives the expected resume, effort and permission flags. Replies and events have zero Zod violations. Native `running` becomes false while the old idle backend is stopped; the next turn starts it again. Evidence: `/tmp/ruimte-rust-configure-wire.ts/json`.

The team fixture passes on both daemons: invalid role two creates nothing, dry-run changes no project revision, two agents get matching group geometry, a child cannot open a nested team, the first task result does not wake the parent, and the second yields one parent turn containing both task IDs. The outbox drains. Remaining presentation/metadata differences were assigned to workspace; native synthetic Ruimte sub-agent thread items still need integration. Evidence: `/tmp/ruimte-rust-team-wire.ts/json`.

All 55 canvas/view requests finish on both daemons with matching HTTP statuses and zero Zod violations. This includes creation, open and deletion of all eight view kinds, missing files, invalid URLs/kind flags and missing targets. Evidence: `/tmp/ruimte-rust-view-wire.ts/json`.

Attachment replay verifies private storage, metadata, downloads, HEAD, byte ranges, authentication, SVG policy and clear cleanup. Unicode filenames now use a valid RFC 5987 filename plus a sanitized ASCII fallback. This deliberately fixes a baseline TypeScript HTTP 500 on Unicode Content-Disposition rather than reproducing it. Evidence: `/tmp/ruimte-rust-attachments-wire.ts/json`.

The unfinished-work runtime switch remains a blocker: the TS → TS → TS control resumes an interrupted parent at attempt two and delivers its pending task result exactly once. TS → Rust currently leaves that result pending at headless startup. Actor-level resume works in focused tests, but startup discovery/coordinator reconciliation still needs completion. Evidence: `/tmp/ruimte-rust-pending-switch.ts/json`.

Expanded checks found three remaining gaps. The 60-row view corpus now includes strict agent-authored diagram input: native accepted an unknown node field and incremented the revision, while TypeScript refuses it without writing. The worktree CLI corpus found a macOS `/var` versus `/private/var` registry-key mismatch, which duplicated a worktree and lost its owner for merge; branch diffs also omitted untracked files. Both are assigned to workspace.

The next pending-work switch delivers the task result, but aborts the original turn rather than resuming it. The fixture now explicitly requires the original turn ID to finish at attempt two. The cause is a project lookup through workflow lineage, which excludes person-created chats; recovery must use the project index. Do not count task delivery alone as passing interruption recovery.

Skills now match discovered content, source and precedence for user/project/plugin roots in both providers. Ordering still uses byte order rather than the baseline locale collation. The terminal title control fixture passes on both daemons: Claude title/custom title on Stop, Unicode cleanup, clearing on a new session, and a Codex title discovered 14.8 seconds after the final hook, with zero Zod violations. The native injected-interval regression covers the same late-index retry without making the default suite wait fifteen seconds. Evidence: `/tmp/ruimte-rust-title-wire.ts/json`. The Claude subagent control verifies transcript paging, native agent metadata and client-specific watch/unwatch; native environment lookup was corrected, while caching, watch lifecycle and full parity are still being completed.

## Parent additional chat RPC comparison

`/tmp/ruimte-rust-chat-misc-wire.ts` runs the actual TypeScript and native daemons with isolated fake Claude/Codex CLIs. Both reconstruct complete chat history through three-item pages, stop chat events after detach, perform provider-specific compaction and dismiss an asynchronous Codex question while the turn continues. All replies and events validate against Zod. Found and assigned two compatibility differences: direct client `chat.create` incorrectly inherits daemon composer preferences in Rust; missing/dismissed approval/question errors use `chat-request-not-found` instead of baseline `request-not-found`. These findings require fresh verification after correction.

Fresh natural-child completion and fork-summary fixtures still fail despite successful explicit task completion and successful pending-work recovery. Source review found that runtime lifecycle facts were wired for terminal sessions but not chat actor completion. Runtime is adding the weak nonblocking chat sink, with workspace reviewing revision reconciliation. No workflow-completeness claim is made from the earlier explicit-completion tests.

## Parent closure of workflow and chat follow-ups

Fresh native binaries close the preceding natural-completion and summary gaps. `/tmp/ruimte-rust-auto-task-wire.ts` now observes `done`, a result sourced from the child's completed turn, and a pending wake while its parent is busy. `/tmp/ruimte-rust-fork-wire.ts` completes all 23 rows, including summary delivery and cross-provider continuation, with zero Zod violations. The chat lifecycle sink now publishes the latest sequence through the typed runtime seam.

The additional chat RPC fixture now matches TypeScript for direct-create defaults and missing question/dismissal errors. Claude subagent transcript pages retain their source timestamps, native metadata and client-specific watch/unwatch behavior. Actual terminal resume after a complete daemon restart preserves the original agent session, model and permission mode for Claude and Codex; neither launches before `agent.resume`. The fresh Codex terminal command was still missing the baseline developer-instructions flag and was assigned for correction.

`/tmp/ruimte-rust-chat-title-wire.ts` passes against both daemons: a Claude transcript title appearing after the first turn is picked up by the delayed recheck; a Codex one-shot title is published and sent into the backend, where a subsequent `name?` verifies it. All three rows validate against Zod. The one-shot is a local fixture, not a paid provider request.

`/tmp/ruimte-rust-notice-wire.ts` passes both daemons: a plain-shell notice appears in the reconstructed xterm screen; a live terminal agent instead gets the notice in its next UserPromptSubmit hook response; a second hook does not repeat it. `/tmp/ruimte-rust-fork-prune-wire.ts` verifies that removing an unloaded, unspoken Claude fork deletes its snapshot and copied transcript while preserving the original transcript and the worktree. Both have zero contract violations.

The person-facing worktree merge fixture refuses an active child without changing its HEAD, then `stopAgent:true` stops the child and merges the correct files in both implementations. Review found an invalid native `git.progress.phase` and an error status after an intentional stop; these were assigned for correction and require a fresh run.

## Linux/aarch64 native checkpoint

The pinned Docker image passes 166 native library tests, with five xterm replay tests separately ignored by the default command. The explicit integration run passes four chat tests, five real PTY/process tests and the Linux process-resource reclamation test. Workspaces are mounted read-only and build artifacts use the dedicated Docker volume. Commands use `--init` so killed orphan descendants are reaped, and Cargo `-j 1` to bound build memory. The initial parallel compilation exceeded the container memory limit; running without container init also left zombie PIDs that made descendant-exit assertions fail. Neither result is counted as a daemon regression. Logs: `/tmp/ruimte-rust-linux-checkpoint.log` and `/tmp/ruimte-rust-linux-integration.log`.

## Native CLI and service checkpoint

The native CLI suite uses temporary files and a loopback address-book fixture. It does not install a service or contact a live account. Service tests cover launchd and systemd definition ownership, build identifiers, deferred-update notices and Linux linger guidance. Login tests validate every daemon and address-book response before use, retry only network, internal and rate-limit failures, and withdraw an issued code when cancellation arrives during start, polling, registration signing or completion. The full native library suite passes 174 tests with six xterm oracle tests ignored, and `cargo clippy --locked --all-targets -- -D warnings` passes.

`chat-content.integration.test.ts` adopts the queue, prompt and subagent comparisons as four local fake-provider tests. It covers unqueue, send-now interruption and forced clear for Claude and Codex; Claude effort, attachment and final-skill prompt ordering; transcript pagination with original timestamps; client-owned watch and unwatch; and settlement of a stored background subagent from its complete transcript. The test has 35 assertions and no wire-schema violations.

## Parent storage-failure and final compatibility controls

`/tmp/ruimte-rust-chat-diskfail-wire.ts` temporarily replaces its disposable `chats` directory with a regular file. Before correction, both providers received a prompt despite `chat.send` returning `chat-storage`. After the provider-effect gate was added, both return the error with **zero** delivered user/turn-start frames. Restoring the directory allows the next send to complete **without** clearing the chat. All observed frames validate against Zod. This covers a filesystem write failure, not power-loss durability.

The fresh person-worktree fixture now has zero event-schema violations and leaves the intentionally stopped child idle, matching TypeScript. The fresh terminal-resume fixture also verifies the Codex developer-instructions argument on initial launch, no launch before a requested resume, and preserved model/mode/session ID after restart.

Skills discovery order matches the actual TypeScript fixture for both providers, including punctuation and mixed case. The orphan-subagent fixture restores a running background row from its completed Claude transcript with exactly the same result and completion timestamp as TypeScript. The prompt fixture confirms `ultrathink` first, attachment paths in the leading text block, the last Claude skill invocation in its final text block, and equivalent Codex input after normalizing temporary paths.

Source review identified a performance issue in the initial native chat store: full snapshots were rewritten for every event and the journal was not compacted. Runtime is correcting this while retaining the storage-failure gate and replay semantics. No performance gain is inferred from the correctness results.

## Existing TypeScript suite, final baseline checkpoint

`bun test --parallel --only-failures` passes: 3,649 passed, 69 skipped, zero failed, 32,764 assertions across 351 files. This runs against the worktree's fixed baseline and its development-launcher changes. Log: `/tmp/ruimte-rust-final-bun-tests.log`.

## Final shared checkpoint

The final fixed-baseline binary passes macOS library tests (179), all six opt-in xterm oracle tests, and nine native chat/PTY integration tests. Linux/aarch64 passes 180 library tests, the same six xterm tests, and ten native integrations including process-resource reclamation. Native build, formatting and all-target Clippy with `-D warnings` pass. `bun run check` exits successfully with the baseline frontend lint warnings.

The combined checked-in daemon suite passes **28 tests, 357 assertions, zero failures across 16 files**. Its one skipped slow self-update test had already passed separately with a copied binary and a busy-to-idle service-mode transition. This final run includes real local Chrome and WebRTC, auth/storage switching, hooks/workflows, terminal replay and all three new chat-storage tests. Logs: `/tmp/ruimte-rust-final-{lib,xterm,native,linux-lib,linux-xterm,linux-native,wire,check,build,fmt,clippy}.log`.

Snapshot coalescing and journal compaction are complete. The abrupt SIGKILL fixture exposed a journal-only recovery bug; native chat creation now materializes journal state before constructing its public info, and recovery replays the tail once. The checked-in regression passes. Parent disk-failure injection again confirms zero delivered provider prompts and successful retry after restoring the directory, without clearing either provider's chat. The final independent terminal corpus matches TypeScript in all 15 cases: 14 exact reconstructions plus the same known leading-combining serialization limitation.

This closed the original `3b46403` baseline. Device additions and native production bundles were addressed in the later synchronization below; its remaining limits supersede the exclusions at this checkpoint.


## Synchronization with main `09fa3976`

The worktree was fast-forwarded to the clean main commit, preserving the Rust implementation. The request inventory now has 126 RPCs and 31 events. The Zod normalization oracle contains 918 cases. All additions in `3b46403..09fa3976` are inherited; Rust now implements the new device API and preserves the new canvas data.

Device tests use the native service and a local helper over its actual RDEV pipe. They cover JPEG and HEVC framing, shared ownership, all input variants, input refusal, authenticated HTTP RSTM streams, paired-key revocation, cancellation before helper readiness, streaming-policy changes during startup, and recovery after re-enabling. The fake backend and broker trust-key overrides are excluded from release builds.

The simulator settings/action oracle is generated by the actual TypeScript backend: 29 settings cases and 24 actions, including enum rejection, malformed accessibility output, field casing and trimmed app identifiers. Process tests cover bounded command output and a timeout where an exited group leader leaves a TERM-ignoring descendant holding stdout. These tests are opt-in alongside the native process tests.

The parent also created a disposable real iOS simulator and exercised discovery, boot/shutdown, appearance, text size, accessibility, location, pointer, multi-pointer, scroll, buttons, rotation, frame events and authenticated HTTP capture against TypeScript and Rust. The same simulator checks run against the production Rust bundle with no Bun on the daemon's PATH. This does not validate physical iPhone capture/HID.

A TypeScript → Rust → TypeScript persistence test covers device nodes/views, portable device references, text font/bold/italic, connector sides and the devices panel. It verifies that local device identifiers are not written into the project.

Production builds use the checked-in compile script on macOS arm64 and Linux arm64. Each complete bundle is copied outside the checkout and launched with an isolated home. Checks cover embedded version/build metadata, an intentionally mismatched sidecar, authentication, web assets/CSP, contract-valid RPCs, native context startup and release rejection of debug device backend configuration. Six negative compile cases refuse unsafe destinations, a symlink, a cross-platform target and an invalid version before Cargo runs.

Reproduce the combined gates from the repository root:

```sh
cargo build --locked
cargo test --locked --workspace --lib
cargo test --locked --workspace --lib -- --ignored
cargo test --locked -p ruimte_server --test runtime_integration --test pty_resources_integration --test chat_integration -- --ignored
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
bun packages/contracts/scripts/generate-rust-schema.ts --check
bun apps/server-rust/tests/generate-schema-oracle.ts --check
bun --config=integration.bunfig.toml test apps/server-rust/tests
RUIMTE_RUN_SLOW_SELF_UPDATE=1 bun --config=integration.bunfig.toml test apps/server-rust/tests/self-update.integration.test.ts
bun test --parallel --only-failures
bun run check
bun install --frozen-lockfile
```

For Linux, use the pinned image and read-only source mount in the [native README](../../apps/server-rust/README.md), with `--init` for orphan reaping and Cargo `-j 1` to bound compilation memory. Run both default and ignored library tests, then the three native integration targets. Production commands are in [RELEASE.md](RELEASE.md).

No service was installed, no release was published, and main remains unchanged. Distribution signing/notarization, x64 hardware, physical iOS HID, live provider accounts and release runtime performance measurements remain outside this verification.


Final synchronization results:

| Check | Result |
| --- | --- |
| macOS native library | 188 passed; eight opt-in xterm/device-process tests also passed |
| macOS native processes | Four chat and five PTY/process integrations passed |
| Linux arm64 native library | 189 passed; eight opt-in xterm/device-process tests also passed |
| Linux arm64 native processes | Four chat, five PTY/process and one resource-reclamation integration passed |
| Daemon wire suite | 31 passed, 405 assertions, 18 files |
| Slow self-update | One passed, five assertions; waits for busy work before replacing the service-mode process |
| Existing Bun suite | 3,736 passed, 69 skipped, zero failures; 32,961 assertions, 366 files |
| Static/build gates | Native binaries, formatting, macOS all-target Clippy with warnings denied, Linux debug/release checks without warnings, repository checks, schema checks and frozen dependency installation passed |
| Production macOS arm64 | Bundle build, portable launch, auth/web/metadata checks and expanded real simulator flow passed |
| Production Linux arm64 | Bundle build and portable health/auth/web/metadata/context checks passed |

Local logs use `/tmp/ruimte-rust-sync-final-*.log`; the final Linux bundle build and portable smoke use `/tmp/ruimte-rust-sync-final-linux-production.log`. The disposable simulator was shut down and deleted after verification. The old leading-combining terminal serialization limitation remains shared with TypeScript. No speed, CPU or memory improvement is claimed.


## Embedded physical iOS bridge

The Rust server now links the bridge library and starts its own private helper command for native capture. The development path no longer depends on finding a separately compiled bridge binary. Screenshot polling and its `sips` conversion fallback are removed from the Rust physical-device backend. HTTP HEVC frames use an ordered queue bounded by frame count and bytes; slow readers end the stream instead of losing interdependent video frames. HEVC events use reliable delivery. Startup failures return a bounded, sanitized reason to the client.

Read-only capture from an iPhone 18 Pro Max passed through both debug transports and the packaged macOS production server:

| Transport | Frames | Sequence gaps | Chromium decoded frames | Decoder errors |
| --- | ---: | ---: | ---: | ---: |
| Debug HTTP | 90 | 0 | 90 | 0 |
| Debug WebSocket events | 92 | 0 | 92 | 0 |
| Production HTTP | 90 | 0 | 90 | 0 |

All three captures decoded at 1328 × 2896 and also passed FFmpeg decoding. The production bundle contained no standalone physical bridge executable. Frame data remained in memory; the checks did not send phone input or save screen recordings. These checks validate the tested phone and connection, not every iOS version or physical HID behavior.

Before the crate split, the full macOS library suite passed 195 tests with eight opt-in tests excluded, the bridge passed five tests, and the Bun suite passed 3,738 tests with 69 skipped and zero failures. Repository checks, native formatting, focused device and browser integrations, all-target Clippy and the production bundle build passed. Evidence is in `/tmp/ruimte-physical-integrated-{debug-http,debug-events,production}.log` and `/tmp/ruimte-physical-final-*.log`.


## Cargo workspace and Rust-only daemon

The final workspace has eleven crates with underscore package names. `ruimte_ios_bridge` lives under `crates/` and has no standalone CLI. Both `apps/server` and `apps/ios-device-bridge` are removed. Shared TypeScript contracts and the client remain; simulator support uses a small packaged adapter. Provider fixtures now live with the native daemon tests, and shared rendering helpers live in `packages/render`.

| Final check | Result |
| --- | --- |
| macOS Cargo workspace | 199 passed, 17 opt-in tests excluded; all 17 also passed separately |
| Linux arm64 Cargo workspace | 192 passed, 18 opt-in tests excluded; all 18 also passed separately |
| Native daemon wire suite | 33 passed, 69 opt-in skips, zero failed; 395 assertions across 20 files |
| Default Bun suite | 2,300 passed, one skipped, zero failed; 27,417 assertions across 229 files |
| Rust static checks | Formatting and all-target Clippy with warnings denied passed |
| Repository checks | Type checks, lint, formatting and frozen dependency installation passed |
| Native Docker image | Build, health, authentication, machine/work RPCs, native context and seeded Git checks passed; no Bun runtime in image |
| npm packaging | Production packaging integration passed with the complete native bundle |
| Physical iPhone production stream | 90 HEVC frames, zero gaps, 90 Chromium-decoded frames, zero decoder errors; FFmpeg also passed |

The reduced Bun test count reflects deletion of the old TypeScript daemon and its unit tests. It is not a comparison of test coverage. The native suites, shared contracts, retained fixture oracles and wire integrations cover the retained implementation. The Docker remote-daemon suite remains opt-in.

The storage fault-injection fixture exposed a test setup race: the running daemon could recreate its chats directory between the fixture's rename and file replacement. The fixture now suspends only its verified child process during each filesystem swap, checks the kernel process state, and resumes it before exercising RPC behavior. Five consecutive targeted runs passed all 15 tests and 150 assertions. Production behavior was unchanged by that test fix.

Warm schema-plus-build runs took 0.922, 0.362, 0.368, 0.321 and 0.400 seconds. Every run preserved the schema timestamp and reused compiled Rust artifacts. Isolated launcher-to-listening runs took 1.425, 2.492 and 2.201 seconds. These are local warm-build measurements, not full desktop startup or runtime CPU/memory benchmarks. See [BUILD.md](BUILD.md).

The local macOS arm64 production app is installed at `~/Applications/Ruimte Rust.app`, version `0.0.0-rust-local`, bundle id `app.ruimte.rust`. It defaults to the permitted `~/.ruimte` daemon home, has no update feed, and passes deep strict ad-hoc signature verification. The installed native bundle also passed an isolated smoke test for embedded metadata, authentication, static web/CSP, contract-valid RPCs, device discovery and native context startup with no Bun on its PATH. The desktop app was not opened and no service was installed. This local signature is not Developer ID signing or notarization.

Evidence: `/tmp/ruimte-native-final-{mac,linux,mac-ignored,linux-ignored,bun,fmt,clippy}.log`, `/tmp/ruimte-native-final-wire-fixed.log`, `/tmp/ruimte-installed-app-smoke.log`, `/tmp/ruimte-native-docker-smoke.log`, `/tmp/ruimte-native-physical-production.log`, `/tmp/ruimte-native-build-times.json` and `/tmp/ruimte-native-startup-times.json`. Main remains clean and unchanged.
