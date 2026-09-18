# Implementation wave archive

This is the historical implementation allocation, retained to explain the module boundaries. Current verification and delivery limits live in [REVIEW.md](REVIEW.md).

Root owns these scope and architecture decisions. Sol agents implement them. A wave is an allocation of work, not a reduced definition of feature completeness.

## Chat and providers

Own native provider detection/catalog/launch arguments, Claude stream-json and Codex app-server transports, protocol normalization, per-chat turn actor, thread projector, durable log/store, attachments, input and queue, skills and title handling. Implement all ordinary chat requests and event sequence semantics first, with explicit remaining dependencies for fork/summary/context/tasks. Do not answer unsupported paths with an empty result.

Use existing fake CLI fixtures and transcript tests as behavioral references. Read model catalogs from existing checked-in JSON as build-time data; no runtime TypeScript execution. Child process command injection belongs in a test configuration object, not an unauthenticated RPC option. Read bounded lines/frames, drain stdout/stderr independently, kill owned process groups, and preserve late-generation rejection. Never log credentials or whole environments.

The public service needs native internal operations for retrieving info/items, creating and starting an agent-owned chat, reading bearer identity, adding an idempotent note/preamble, waking an idle parent, interrupt recovery, stopping owned work, reading process roots and observing lifecycle facts. Wire external context/lineage/task/limits behavior through explicit host interfaces. Observers do not mutate a chat from inside its event emission; schedule a separate actor command. Do not hold locks through host calls.

Forks/checkpoints/summaries are a required follow-up after ordinary turns work: native transcript cuts, same/cross-provider branches, optional worktree creation and rollback, plans copy, durable lineage, summary outbox and idempotent delivery. Reuse workspace's owned Git/project operations.

## Graphics, browser and usage

Drawing and diagram render results must use the same algorithms and seeded geometry as `packages/drawing`, `packages/diagram` and `apps/server/src/render/scenes.ts`. Port deterministic algorithms to Rust, with differential fixtures covering every element/shape/style and layout. A layout-shaped empty result is not rendering. Run CPU-heavy geometry in a bounded blocking pool/semaphore so terminal and network actors remain responsive under large scenes.

Browser owns a native CDP client and Chromium process under the daemon home. Preserve client/page ownership, URL policy, history, input, resize and DPR, navigation errors, favicon bounds, capture acknowledgments and one-frame backpressure. Live streams retain authenticated binary framing and begin/end their source with subscription count. Disabling streaming stops existing streams. A local fixture page is sufficient for tests; do not use personal browser profiles.

Usage owns incremental transcript indexes, exact aggregation/pricing/exchange behavior, provider probes and live limit normalization. Preserve cache invalidation, cursor/truncation handling and unreadable-file behavior. The committed byte offset and Codex parser state stop before an incomplete trailing line; retain a separate provisional tail and reparse it on append or restart. Deleted transcripts remain counted. Serialize scanner mutations without holding a lock across project lookups or event delivery. Use bounded incremental reads and drain oversized lines without retaining their full payload. Preserve the existing index JSON so a runtime switch can reuse it. Timezone bucketing needs an IANA timezone database (including DST and non-hour offsets), with invalid zones falling back to UTC. Do not implement it with fixed numeric offsets. External exchange/pricing data needs a local test server or injected source; do not treat network unavailability as fabricated zero usage.

## Workflow and agent integration

Port hook installation/normalization, approvals, agent sessions and resume, pending prompts, lineage, context, notices, canvas verbs, plan operations, task coordinator and durable outbox. Reuse the TypeScript limits and authority boundaries exactly. Agent status comes from hooks, never terminal output parsing.

Agent HTTP bearer tokens resolve to a real owned session/chat and retain depth/mode across restart. Context reads only linked sources; canvas mutation reaches the caller's project with the existing creator and permission checks. Native sessions launch the correct provider command and receive context/hook environment without leaking inherited session identity into an unrelated daemon.

Task state and outbox entries are durable before a side effect. A parent busy when a child settles receives the result when eligible; team batches wait for all children. Retry and crash tests must prove no duplicate starts or widened permissions. Plans distinguish person and agent edits and preserve human-owned status. Do not invent a scheduler.

## Transport, CLI and deployment

Implement broker selection, signed announcements, reconnect, statement admission/replay/revocation, WebRTC offer/answer/candidates, channel binding, fragmentation and bounded queues. Use native webrtc 0.20 Tokio APIs and the same dispatcher. Test direct local peers and a local broker fixture; do not register this experiment in a real address book.

Preserve serve/pair/login/context/service/version commands, flags/environment, local-only administrative routes, startup conflict behavior, work counts and graceful shutdown. Service install/status/uninstall and self-update need temp-path fixtures and platform behavior tests; do not install or restart a real service during verification. Keep the experiment selected only by development commands; production selection needs an explicit packaging decision after parity is proven.

## Parent verification fixtures

These scratch fixtures are generated by calling the existing TypeScript implementations. They are not native implementations and do not replace behavioral tests. When adopting them, put a deterministic generator with repository-relative imports next to the checked-in fixture and support check mode.

| Domain | Generator and expected output prefix | Coverage |
| --- | --- | --- |
| Request normalization | `/tmp/ruimte-rust-schema-oracle` | Already adopted into core tests; 842 cases |
| Drawing/diagram geometry | `/tmp/ruimte-rust-render-oracle` | 56 scenes, actual renderer + Zod results |
| Usage | `/tmp/ruimte-rust-usage-oracle` | 14 Claude lines, 12 Codex sequences/51 state transitions, dedupe/index |
| Usage scanner lifecycle | `/tmp/ruimte-rust-usage-scan-oracle` | 14 real filesystem scans: incomplete lines, append, truncation, equal-size rewrite, dedupe, deletion and restart |
| Usage calculations | `/tmp/ruimte-rust-usage-math-oracle` | 12 price lookups, 3 cost cases, 20 timezone/DST aggregations, 32 limit normalization/merge cases |
| Authenticated media HTTP | `/tmp/ruimte-rust-media-wire` | 25 real requests per daemon: SVG, HEAD, auth/origin, invalid methods and byte ranges |
| Direct-channel framing | `/tmp/ruimte-rust-direct-oracle` | 6 UTF-16 fragmentation cases, 8 assembler sequences, 16 channel bindings/signature messages |
| Diagram layout | `/tmp/ruimte-rust-diagram-oracle` | 48 additional scenes: seeded cyclic graphs, groups, manual positions, empty/self-edge and Unicode |
| Process alerts | `/tmp/ruimte-rust-alert-oracle` | 23 judges/129 calls: silent, busy, memory, disappeared agents, orphans, hung probes and dismissal |
| Chat recovery | `/tmp/ruimte-rust-chat-store-oracle` | 16 disk cases: missing/corrupt snapshot, log replay, reset, preambles, torn and duplicate lines |
| Provider protocols | `/tmp/ruimte-rust-protocol-oracle` | 33 protocol instances/98 calls: inbound normalization, outbound approvals/questions, turn IDs and clock |
| Chat projector | `/tmp/ruimte-rust-projector-oracle` | 11 scenarios/54 steps: complete event stream and thread state, tools/questions/approvals/thinking/subagents/exit |
| Agent hooks | `/tmp/ruimte-rust-hook-oracle` | 35 normalizations, 128 permission mappings, 14 installer merges plus idempotence/commands |
| Workflow authority/results | `/tmp/ruimte-rust-workflow-oracle` | 20 mode choices, 72 depth/team/cap combinations, 24 task results |
| Plans | `/tmp/ruimte-rust-plan-oracle` | 45 actor/operation cases, results/progress/Markdown |
| Canvas CLI help | `/tmp/ruimte-rust-canvas-help-oracle` | 13 registry entries and 50 help/refusal cases |
| Actual workspace wire | `/tmp/ruimte-rust-workspace-wire` | 18 requests against both daemons, real temp Git/files/project stores |
| Shared disk formats | `/tmp/ruimte-rust-storage-switch` | TS → Rust → TS identity/auth/project/unknown-node continuity |

Each prefix has `.ts` and `.json` files. Canvas help metadata may be emitted as build-time JSON to prevent prose/flag inventories drifting, while the native verbs still implement all behavior and authority checks. The daemon must never execute these TypeScript fixtures at runtime.

## Native WebRTC API note

The verified `webrtc` 0.20.5 API differs from older examples using a concrete `RTCPeerConnection`. Use `PeerConnectionBuilder`, `PeerConnection` and `PeerConnectionEventHandler`; the default `runtime-tokio` feature runs the background driver over the Sans-I/O core. DataChannel exposes async send/try_send and buffer backpressure. Official references: [crate architecture and current quick start](https://docs.rs/webrtc/0.20.5/webrtc/), [peer connection API](https://docs.rs/webrtc/0.20.5/webrtc/peer_connection/), [data channel API](https://docs.rs/webrtc/0.20.5/webrtc/data_channel/).

Preserve application limits from the TypeScript implementation: 32 opening attempts, 30-second attempt timeout, 5-second gather timeout, 15-second channel authentication timeout, 4,096-character unauthenticated frames and the authenticated 16 MiB ceiling. The contract fragment encoder/assembler is authoritative; test supplementary Unicode at fragment boundaries. Authenticated signaling does not replace channel proof bound to both SDP fingerprints. A reliable event/reply cannot disappear because a send buffer fills.


## Runtime/workflow seam

Runtime owns bearer resolution and live process identity. `RuntimeIdentity` identifies node, target, provider and mode; workspace joins durable lineage/depth/mode ceilings. Typed internal start/stop/resume/wake/note/preamble operations and read snapshots replace fabricated RPC contexts. Workflow owns durable tasks, plans, notices and outbox entries.

Install a Weak, nonblocking RuntimeFactSink after composition and before accepting work. A sink only queues workflow actor work. Runtime facts are hints, with epoch/revision/generation and reconciliation after restart or queue lag. Terminal updatedAt is not a unique revision. A full queue must mark reconciliation dirty instead of silently losing settlement. Stable outbox operation IDs must make start/wake/note/preamble idempotent across the crash window between performing an effect and acknowledging it.
