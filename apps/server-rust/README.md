# Native daemon

The Rust daemon implements the features tracked in [the parity ledger](../../docs/rust-daemon/PARITY.md). [The integration review](../../docs/rust-daemon/REVIEW.md) records the evidence and remaining limits.

## Development

Run these commands from the repository root:

```sh
bun install
bun dev
```

The default settings keep development data separate from installed builds:

| Setting            | Default              | Override              |
| ------------------ | -------------------- | --------------------- |
| Daemon data        | `~/.ruimte-rust-dev` | `RUIMTE_DEV_HOME`     |
| Daemon port        | `4221`               | `RUIMTE_PORT`         |
| Vite port          | `5183`               | `RUIMTE_VITE_PORT`    |
| Electron profile   | `Ruimte Rust Dev`    | `RUIMTE_DEV_PROFILE`  |
| Rust build profile | `dev`                | `RUIMTE_RUST_PROFILE` |

Rustup uses the toolchain pinned in `rust-toolchain.toml`. The launcher also finds Cargo under `~/.cargo/bin` when that directory is absent from `PATH`. Git, ripgrep, Chrome and provider CLIs remain external programs where the corresponding feature needs them. On macOS the physical iOS bridge is linked into `ruimte` and runs through a hidden subprocess of that binary; simulator capture uses its packaged Bun helper and native addon. The native production bundle is documented in [RELEASE.md](../../docs/rust-daemon/RELEASE.md).

The Rust launcher watches the workspace members, vendored terminal source, Cargo files and contract sources. It regenerates the Rust request schema after contract changes, coalesces changes while a build or restart is in progress, and restarts the daemon only after a successful build. A failed rebuild leaves the last good daemon running. The launcher stops its Cargo and daemon process groups when development exits.

The Rust code is a Cargo workspace rooted at the repository `Cargo.toml`. Cargo keeps its target directory under `apps/server-rust/target` by default. Set `CARGO_TARGET_DIR` to move it. The supervisor asks Cargo to build the server and context packages; Cargo skips crates outside each changed dependency chain, and the supervisor leaves the daemon running when the server executable did not change.

For timing or memory measurements, use an optimized build and record the workload:

```sh
RUIMTE_RUST_PROFILE=release bun dev
```

Passing correctness tests does not establish a performance improvement. No measured Rust speedup is claimed yet.

## Verification

```sh
cargo build --locked -p ruimte_server --bin ruimte-server -p ruimte_cli --bin ruimte-context
cargo test --locked -p ruimte_server --lib
cargo test --locked -p ruimte_server --lib -- --ignored
cargo test --locked -p ruimte_server --test runtime_integration --test pty_resources_integration -- --ignored
cargo test --locked -p ruimte_server --test chat_integration -- --ignored
bun --config=integration.bunfig.toml test apps/server-rust/tests
RUIMTE_RUN_SLOW_SELF_UPDATE=1 bun --config=integration.bunfig.toml test apps/server-rust/tests/self-update.integration.test.ts
bun run check
```

The integration configuration is necessary because the default Bun configuration excludes integration test files. PTY tests launch real temporary shells; chat tests use local fake provider CLIs and need Bun. Browser tests use an isolated local Chrome profile. Broker tests use a local fixture server. The self-update test takes about 70 seconds, so it runs only when `RUIMTE_RUN_SLOW_SELF_UPDATE=1` is set. It copies the debug binary into a temporary directory and sets `RUIMTE_SERVICE=1`; it does not install a service. Tests use temporary daemon homes and loopback ports, without registering accounts.

The TypeScript Zod contracts remain authoritative. Checked-in schema and differential fixture generators compare native parsing, provider events, terminal replay, graphics and storage against the existing implementations. See [architecture decisions](../../docs/rust-daemon/IMPLEMENTATION.md) for ownership, persistence and compatibility boundaries.

For Linux verification on a macOS host, `tests/Dockerfile` combines the pinned official Rust and Bun images. Keep the workspace read-only and put Cargo's registry and build output in Docker volumes:

```sh
docker build -t ruimte-rust-test -f apps/server-rust/tests/Dockerfile apps/server-rust/tests
docker run --rm --init \
  -v "$PWD:/workspace:ro" \
  -v ruimte-rust-cargo-registry:/usr/local/cargo/registry \
  -v ruimte-rust-linux-target:/build \
  -e CARGO_TARGET_DIR=/build \
  ruimte-rust-test \
  cargo test -j 1 --locked --manifest-path Cargo.toml -p ruimte_server \
    --test runtime_integration --test pty_resources_integration --test chat_integration -- --ignored
```

The resource-reclamation assertion uses Linux `/proc`; it checks that exited terminals release their worker threads and PTY handles while screen history remains available.

Use `--init` for Linux fixtures that intentionally orphan descendants: the container init reaps killed processes. `-j 1` bounds compile-time memory when building the large native test targets in Docker.
