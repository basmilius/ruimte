# Rust crates and development builds

Ruimte's Rust code shares one Cargo workspace, lockfile and target directory. `bun dev` builds the server and native context CLI, then starts the server. Cargo decides which dependencies need recompilation. Rust is the only daemon implementation in this worktree.

## Crate layout

| Crate | Responsibility | Ruimte dependencies |
| --- | --- | --- |
| `ruimte_core` | Configuration, RPC types, events, live streams and embedded build metadata | None |
| `ruimte_schema` | Validation against generated contracts | core |
| `ruimte_runtime` | Chats, sessions, terminal processes, providers and titles | core |
| `ruimte_workspace` | Projects, canvas, workflows and worktrees | core, runtime |
| `ruimte_usage` | Usage records, pricing and aggregation | core, workspace |
| `ruimte_browser` | Browser sessions and capture | core |
| `ruimte_devices` | Device discovery, input and stream ownership | core |
| `ruimte_identity` | Authentication, pairing and push | core, schema |
| `ruimte_cli` | Service commands, login and the `ruimte-context` binary | core |
| `ruimte_server` | HTTP/WebSocket routing, broker/direct connections and application composition | All crates above; iOS bridge on macOS |
| `ruimte_ios_bridge` | Native physical Apple device capture and input; library | None |

Chat, sessions and process management currently depend on each other. Keeping them in one runtime crate preserves those relationships without introducing forwarding interfaces. Workspace depends on runtime; runtime does not depend on workspace. The shared attachment asset type belongs to runtime and remains available through the workspace reexport.

The server links the iOS bridge library on macOS. It runs physical capture through a private command of its own executable, preserving process isolation around Apple's native APIs. The bridge has no standalone CLI. Building the server compiles its library on macOS.

## Build only the required package

Run commands from the repository root:

```sh
# Both application binaries, using the workspace's default members.
cargo build --locked

# Server and its dependencies.
cargo build --locked -p ruimte_server --bin ruimte-server

# Context CLI without chat, workspace, device or WebRTC dependencies.
cargo build --locked -p ruimte_cli --bin ruimte-context

# Fast type checking while editing one crate.
cargo check --locked -p ruimte_devices

# Focused unit tests or the complete workspace.
cargo test --locked -p ruimte_devices --lib
cargo test --locked --workspace
```

Crate package names and directories use underscores. The user-facing executable names remain `ruimte-server` and `ruimte-context`.

The default target directory remains `apps/server-rust/target`. `CARGO_TARGET_DIR` can select another location. Share one target directory between development commands to reuse Cargo's compiled dependencies. A different target triple or build profile has its own artifacts.

`cargo build --release` produces native executables, but it does not assemble the web client, simulator assets and release metadata. Use the packaging command in [RELEASE.md](RELEASE.md) for a deployable server bundle.

## Development invalidation

The contracts generator writes its output only when the bytes change. An unchanged schema therefore leaves Rust's embedded input untouched. The launcher watches crate sources, manifests, Cargo configuration, the lockfile and contract inputs. Cargo still checks freshness on each requested build; a successful build that leaves the server executable unchanged does not restart the running daemon. A failed rebuild leaves the last successful daemon running.

A change to a leaf crate can reuse unrelated compiled crates. Changes to core affect most of the workspace, and server changes still require the final executable to link. Splitting crates does not eliminate linking or make a clean dependency build free. The development profile remains unchanged so performance comparisons do not mix the crate split with reduced debug information or different optimization settings.

## Measurements

Before the split, the warm build phase took 0.20 to 0.45 seconds when nothing changed. Running the existing schema generator first increased that to 3.28 seconds because it rewrote an identical embedded file and forced the monolithic server to compile again. These local macOS arm64 measurements cover schema generation and Cargo, not the complete desktop application's startup or runtime performance.

After the split, five unchanged schema-plus-build runs took 0.321 to 0.922 seconds, with a median of 0.368 seconds. None rewrote the schema or recompiled Rust. Three isolated development launcher runs reached a listening daemon in 1.425 to 2.492 seconds, with a median of 2.201 seconds. These include launcher work and daemon startup, but exclude the desktop interface.

The main warm-build gain comes from preserving an unchanged schema. The crate split also isolates dependencies, but no separate timing gain is attributed to that isolation. Verification is recorded in [VERIFICATION.md](VERIFICATION.md).
