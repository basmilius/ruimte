# Integration review

This review covers `feat/rust-daemon`, synchronized with main at `09fa3976ddfca4971549deb07ae94efa08fa664b`. The initial Rust implementation used `3b46403`; the device and canvas additions since then are now included. Main remains clean and unchanged. Sol agents implement the daemon; the parent reviews the architecture and independently exercises it. Earlier migration checks compared running TypeScript and Rust processes. Rust is now the only daemon in this worktree. Read the request inventory in [PARITY.md](PARITY.md) and detailed evidence in [VERIFICATION.md](VERIFICATION.md).

## Verified behavior

- Development: actual `bun dev` launches the isolated Rust desktop, creates a project, executes a terminal command, reconnects after a daemon rebuild and exits cleanly. Watcher tests cover coalesced rebuilds, stubborn owned descendants and an unrelated surviving process.
- Authentication and transport: request normalization has 918 actual-Zod cases. WebSocket pairing, authorization and revocation pass. Actual local WebRTC proof/refusal cases, key revocation and broker signaling pass. Authenticated media, static assets, attachments and push encryption have differential or protocol tests.
- Persistence: TS → Rust → TS preserves identity, credentials, projects and unknown node data. Natural child completion, single wake and fork-summary delivery now pass. The pending-work switch resumes the original interrupted turn at attempt 2, delivers one task result and survives another TS restart without duplication. Failed auth writes preserve the previous effective state.
- Terminals: native macOS/Linux PTYs execute and resize; exit-tail, split Unicode, blocked writes and process reclamation pass. Attach races and a paused TCP consumer reconstruct the final xterm screen after resync. SIGTERM exits while a 15 MiB PTY write is blocked. The broader 15-case terminal corpus now matches TypeScript: 14 cases reconstruct exactly; a leading combining character retains the same serialization limitation in both implementations.
- Chats: local fake Claude/Codex CLIs exercise actual native process transports, approvals/questions, queue ordering, interruption, force-clear and configure/restart. History pagination reconstructs the complete thread, detach removes delivery, compaction works and asynchronous dismissal preserves the running turn. Real temporary Git repositories exercise checkpoints, transcript cuts, worktree restoration and cross-provider continuation.
- Workspace: concurrent project saves accept one current revision and reject stale writers. Plan updates retain every accepted revision. Drawing/diagram differential corpora cover geometry and layout. View creation/open/delete, strict document validation, team preflight/placement, worktree creation/diff/merge and refusal while a child is busy pass against both daemons.
- Integrations: actual local Chrome tests cover input, navigation/history, per-client ownership, DPR2 capture and streaming disable. Usage fixtures match TypeScript across transcript rewrites, deduplication, pricing/limit calculations and five time zones. Process alert judges have a 23-scenario, 129-observation TypeScript oracle. Terminal title updates include a late Codex index entry without a second hook.
- Devices: the eight device requests, JPEG/HEVC frame events and authenticated HTTP streams are implemented. A local helper fixture covers input ownership, policy changes during startup, canceled HTTP startup, disconnects and revocation. Independent tests use a disposable real iOS simulator for discovery, boot/shutdown, image capture, input and settings. Physical iOS uses the bridge library embedded in the Rust server. An iPhone 18 Pro Max passed HEVC capture over HTTP and WebSocket events, including Chromium WebCodecs decoding. Physical HID remains untested.
- New project data: device nodes/views, text font/bold/italic, connector sides and the devices panel survive a TypeScript → Rust → TypeScript switch. Device identifiers remain local, matching TypeScript.
- Production: standalone macOS arm64 and Linux arm64 bundles build and launch outside the checkout, with embedded version/build identity, authentication and bundled web assets. The macOS simulator helper runs without Bun on the daemon’s PATH. See [RELEASE.md](RELEASE.md).

Tests use disposable daemon homes, loopback ports and local fake provider executables. They make no paid model requests and do not install a service. Self-update is exercised with a copied binary and an isolated service-mode process.

## Baseline verification

The subsequent crate split, TypeScript daemon removal and local app installation are recorded in the final section of [VERIFICATION.md](VERIFICATION.md).

These results cover the synchronized baseline. This records tested coverage, not a guarantee against every runtime defect.

| Check | Final result |
| --- | --- |
| macOS native library | 188 passed; eight opt-in xterm/device-process tests run separately and passed |
| macOS native processes | Four chat and five real PTY/process integrations passed |
| Linux/aarch64 native library | 189 passed; all eight opt-in xterm/device-process tests passed |
| Linux/aarch64 native processes | Four chat, five PTY/process and one resource-reclamation integration passed |
| Bun daemon integration suite | 31 passed, 405 assertions, 18 files; slow self-update separately passed with 5 assertions |
| Existing Bun suite | 3,736 passed, 69 skipped, zero failed; 32,961 assertions in 366 files |
| Build and static checks | Native binaries, Rust formatting, all-target Clippy with warnings denied, and `bun run check` passed; existing frontend lint warnings remain |
| Production bundles | macOS arm64 and Linux arm64 build and run; macOS real simulator and both platforms’ health/auth/static/embedded metadata checks pass |
| Development smoke (initial baseline) | Actual isolated Rust `bun dev` desktop launch, terminal execution, rebuild/reconnect and clean exit; TypeScript selection also exercised |

Chat snapshots are coalesced at 64 events or 1 MiB, with forced snapshots where operation state requires them. Successful snapshots compact only the covered journal. The storage fixture tests failed writes before provider input, retry without clearing, retained `since` replay and snapshot fallbacks, and completed-chat recovery after SIGKILL with no snapshot. This establishes process-crash and write-failure behavior, not power-loss durability.

Checked-in chat lifecycle/content/storage and workspace workflow/canvas fixtures retain the regressions found during review. Worktree removal preserves the baseline distinction: direct removal does not stop live agents; merge owns the explicit stop/refuse behavior. The vendor note records the terminal source revision, retained licenses and opt-in compatibility patches.

## Architectural constraints retained

Workspace owns project mutations. Chat and session actors own live runtime state. Lifecycle notifications are weak, nonblocking hints carrying epoch/revision/generation; a missed or superseded hint must cause reconciliation against current durable state. Observers must not call back into an actor from inside its event emission.

Task/outbox writes precede their effects. Stable operation IDs prevent replay from starting duplicate work. Native recovery derives authority from existing project, lineage and runtime records because the TypeScript baseline does not persist a native authority field. A runtime switch cannot widen permissions or require a schema migration.

Accepted durable mutations survive client disconnect. Shutdown first stops new admission and cancels external I/O, then drains accepted work and joins background tasks. Process cleanup targets owned processes and verifies PID identity. A passing success path does not replace failure, revocation and restart coverage.

## Delivery limits

No Rust runtime CPU, memory or latency improvement has been measured. Correctness tests do not predict release CPU, memory or latency. Standalone production bundles are verified on macOS arm64 and Linux arm64; x64 hosts, physical iOS HID, distribution signing/notarization, real service installation and live provider accounts remain untested. Desktop and npm workflows build native Rust bundles on matching hosts. No release was published during this work. The documented terminal serialization limitation matches the TypeScript baseline. Windows is unsupported. Tests use fake provider executables and do not establish compatibility with every future provider CLI release. The worktree remains unmerged and uncommitted.
