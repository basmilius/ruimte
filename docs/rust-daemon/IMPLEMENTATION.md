# Rust daemon architecture and implementation plan

The implementation lives in the `feat/rust-daemon` worktree. Its initial baseline was `3b46403e130bd4846f8e65998e2e35016c98760a`; it has now been fast-forwarded to main at `09fa3976ddfca4971549deb07ae94efa08fa664b`. Main stays untouched. The current synchronization adds the device API and the new persisted canvas fields.

The root agent owns architecture, scope and parity decisions. Sol agents implement assigned modules. Do not describe an unimplemented request, an empty fabricated answer or a TypeScript proxy as parity.

## Architecture decisions

- Keep the native executable under `apps/server-rust` and split domain code into the root Cargo workspace described in [BUILD.md](BUILD.md). Rust is the only daemon in this worktree; the TypeScript implementation and runtime selector have been removed.
- Use Tokio, Axum, serde_json and native modules. Reuse external git, rg, Chrome and agent CLI processes where the existing implementation does; do not forward daemon requests to the TypeScript daemon.
- Keep `packages/contracts` and `packages/pulsar` authoritative for all wire shapes and signing messages. Export JSON schema from them, including defaults and unknown-key behavior needed for request parsing. Validate requests and results in parity tests. Generated files require a deterministic check mode.
- Keep the existing JSON storage formats, permissions, identities and atomic replacement behavior. Do not add a database or migrate user homes for this experiment.
- Development uses the Rust daemon with an isolated development home and selected port. Keep port 4221 and Vite 5183 to coexist with main's 4211/5173, and isolate Electron's dev profile. Overrides remain possible. The root `bun dev` must pass the same settings to all children and launch exactly one daemon.
- Production paths are unchanged. Tests always use temporary homes and loopback port 0. Never start a test against ~/.ruimte or ~/.ruimte-dev. Do not install services or change vendor CLI configuration during tests.
- Errors and security rules match the TypeScript code. Being on loopback never substitutes for the local secret. Do not put tokens in logs or argv.
- Modules have one shared request interface. `crate::rpc::{RequestContext, RpcError, RpcResult}` and `crate::events::EventBus` are implemented by the core agent. `RpcResult = Result<serde_json::Value, RpcError>`. `RpcError::new(code: impl Into<String>, message: impl Into<String>)`.
- `RequestContext` exposes `client_id: String`, `access: ClientAccess` with `reachability: String`, `session_id: Option<String>`, and `events: EventBus`. EventBus is Clone and offers synchronous `send(&self, client_id: &str, event: &str, payload: Value)` and `broadcast(&self, event: &str, payload: Value)`. No unbounded client queues. Overflow must close or resync appropriately, never silently lose mandatory state changes.
- Each domain owns a cloneable service containing Arc-backed state. It provides `pub async fn new(home: PathBuf, events: EventBus) -> anyhow::Result<Self>`, `pub async fn dispatch(&self, method: &str, payload: Value, context: &RequestContext) -> Option<RpcResult>`, `pub async fn detach(&self, client_id: &str)`, and `pub async fn shutdown(&self)`. Return None only for another domain's methods. Root integration calls these services from a central dispatcher. Domain helpers can expose additional necessary internal interfaces; coordinate additions before other domains depend on them.
- Core agent owns Cargo.toml/Cargo.lock, main.rs/lib.rs and shared rpc/events/config/router/schema/auth modules. Other agents request dependency additions rather than racing those files. Native terminal dependencies: portable-pty, alacritty_terminal 0.26, libc. Alacritty owns terminal state and width reflow; a native serializer reconstructs xterm state for existing clients. vt100 is unsuitable as the production screen model because resizing truncates wrapped content. Validate serializer output against @xterm/headless, including normal and alternate buffers, cursor, modes, Unicode and scrollback. Workspace domain dependencies may use notify, regex, walkdir, base64, tempfile, uuid.
- Never hold a standard mutex across await. Serialize state mutations per entity. Spawn blocking OS work away from async executors. Preserve attach/snapshot/output ordering, revisions, sequenced chat events, process identity checks and durable outbox semantics.

The implementation waves below are the original allocation plan. They are complete for the fixed baseline; current evidence and delivery limits are recorded in [REVIEW.md](REVIEW.md).

## Initial independent implementation wave

1. Core: build skeleton, shared interface, schema generation, HTTP/WebSocket authentication, server/endpoint/auth requests, dev selection and isolated lifecycle.
2. Workspace: projects, drawings/diagrams persistence, filesystem, byte reads and git; native workspace module. Preserve revisions, unknown kinds, watcher lifecycle, cancellation and errors.
3. Runtime: native PTY/session module and process monitoring; screen, snapshots, reconnect, output ordering, resize, signals and lifecycle tests.

## Subsequent required work

- Native chat backends, providers, protocols, logs, history, queue, approvals, fork/checkpoints, subagents and summaries.
- Context/canvas commands, agent hooks/lineage, notices, tasks, durable outbox, plans and CLI.
- Usage indexing, model pricing and CLI-derived limits.
- Browser capture/input and authenticated streaming, rendering exports and push.
- Pulsar broker, statement auth, direct WebRTC and service lifecycle.
- Integrate all modules; client/schema-based and differential end-to-end tests against both implementations; real CLI/shell/socket tests separate from unit tests.
- Audit every request, event, HTTP route, CLI verb and persistence format from the baseline. No feature-complete claim until that matrix has concrete passing evidence.

## Verification gates

A compiling skeleton is an intermediate result. Tests need meaningful behavior, not only registrations or schema-shaped dummy responses. Keep a parity matrix with implemented/tested/missing distinctions. Run cargo fmt/check/test/clippy and relevant existing Bun checks. Test switching both development modes, startup conflicts, SIGTERM cleanup and use of the isolated home. Test security failures as well as successful requests. Leave main and production services untouched.

## Remaining domain boundaries

- Workspace remains the sole owner of project writes. Canvas operations use an atomic mutation over current content, never a read followed by an unrelated save. Its index supplies node location, context links and titles even for closed projects. Drawing and diagram stores retain their own revision rules.
- A chat owns one serial actor for its turn state and durable sequence. Provider protocols turn CLI frames into normalized backend events; the projector owns thread item identity. Provider parsing must not write projects, plans or task records. Queues and callbacks must carry a process generation so a retired CLI cannot settle a new turn.
- Composition wires explicit domain methods or narrow host callbacks. Internal calls must not fabricate a remote client context to gain local-secret authority. Keep actor identity explicit for person and agent actions. Do not hold a state lock while awaiting a callback into another service.
- Task coordination observes settled chat/session facts and writes durable outbox work before starting or waking anything. Notifications are hints; durable stores provide recovery. A lagged observer reconciles state rather than silently dropping a settlement. Plan operations distinguish the person from the agent.
- Chromium remains an external browser process. The native browser module speaks CDP directly over a bounded WebSocket, owns an isolated profile under the experimental home, and manages per-client pages and screencast subscriptions. It does not invoke Bun.WebView through a sidecar. Browser-frame replacement is separate from reliable state events.
- Direct networking uses the native `webrtc` 0.20 family with Tokio and the same authenticated dispatcher as WebSocket. Broker WebSockets and CDP may use `tokio-tungstenite`; HTTP integrations may use `reqwest` with Rustls. The application still owns statement validation, channel binding, framing limits and TURN policy. Verify native dependencies against the chosen lockfile, not remembered older APIs.

Dependency references consulted on 2026-09-18: [Alacritty resize implementation](https://docs.rs/alacritty_terminal/latest/src/alacritty_terminal/grid/resize.rs.html), [webrtc 0.20.5 API](https://docs.rs/webrtc/0.20.5/webrtc/), [Tokio Tungstenite](https://docs.rs/tokio-tungstenite/latest/tokio_tungstenite/), [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/).

The Alacritty dependency is vendored under `apps/server-rust/vendor/alacritty_terminal`. Read-only inactive-grid and scroll-region accessors allow serialization without mutating either buffer. An optional character-width provider selects the same Unicode 6 widths as the existing xterm client; the upstream default stays unchanged. Its native lookup table is generated from the exact xterm 6 implementation, with source license retained. Keep one authoritative parser/grid pair, preserve upstream licenses, and document every compatibility patch. Additional control-sequence differences require differential cases before any further vendor change.

## Main synchronization and production build

The native daemon gains the eight device requests and `device.frame`, with the shared contract remaining authoritative. Rust owns discovery, device actions, helper supervision, subscriptions and input authorization. Browser and device HTTP streams share authentication and bounded framing, with JPEG or HEVC content types. Turning machine streaming off closes both kinds of source.

The physical iOS bridge is a reusable Rust library linked into the macOS server. The server runs it through a private helper command of its own executable, isolating native capture without shipping a separate bridge binary. Screenshot polling has been removed from the Rust physical-device backend. Simulator capture and HID keep the existing `serve-sim` module behind a small standalone compiled helper, not a second daemon. Release bundles carry this executable, its addon and accessibility helper; running the production daemon does not require Bun to be installed. Linux has no local iOS backend, matching TypeScript.

Device nodes/views, the devices panel, canvas text styling and explicit connector sides must round-trip across TypeScript and Rust. Agent-created device views remain forbidden because they require a local discovery result.

Production compilation is separate from choosing a development daemon. Release builds embed version and build identity and package the native context binary. Existing published desktop CI continues to select the TypeScript server until that workflow is explicitly changed. Build and release instructions live in `RELEASE.md`.


## Rust-only workspace

Crate package names and folders use underscores. The physical bridge lives at `crates/ruimte_ios_bridge` and has no standalone CLI. The server invokes its own private helper command for physical capture.

Removing `apps/server` also moves shared inputs out of that tree: provider catalogs belong to `ruimte_runtime`, offline prices to `ruimte_usage`, and pure scene generation used by iOS tooling to `packages/render`. The simulator adapter remains a small Bun program around the existing native addon, packaged with the Rust server. It does not implement daemon requests or persistence. Test provider processes and WebRTC clients are test support under the native app.

Frozen JSON oracles retain compatibility evidence from main `09fa3976`; generators that required the removed daemon are no longer active tools. Current contracts and shared-renderer generators continue to run. Packaging, desktop resources, npm bundles and Docker point to the native daemon.
