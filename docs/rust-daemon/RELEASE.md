# Native daemon builds

The native bundle is built on the machine where it will run. macOS and Linux builds contain native code, so the compile script refuses cross compilation instead of producing an incomplete bundle.

## Build a bundle

Run these commands from the repository root after installing the pinned Rust toolchain:

```sh
bun install --frozen-lockfile
bun run --cwd apps/server-rust compile --version 0.1.0
```

`RUIMTE_VERSION=0.1.0` is equivalent to `--version 0.1.0`. The version must be semantic version text. A build without either uses `0.0.0` for local testing. `CARGO_TARGET_DIR` is honored for Cargo output.

The compile script builds the `ruimte-server` and `ruimte-context` binaries from the `ruimte_server` and `ruimte_cli` packages in the Cargo workspace at the repository root. It reads Cargo's artifact messages for the executable paths, including configured targets and custom target directories, instead of assuming a package-local `target` directory.

The default output is `apps/server-rust/dist/<os>-<arch>`. An explicit destination is supported:

```sh
bun run --cwd apps/server-rust compile --version 0.1.0 --outdir /absolute/staging/ruimte
```

The script builds into a temporary sibling and publishes the complete directory only after every binary and helper passes its checks. It inspects the Rust binaries with `otool` or `ldd`. It refuses filesystem roots, repository and home ancestors, Cargo target ancestors, symlink destinations, and replacement of directories without a native bundle marker.

Every bundle contains:

```text
ruimte
ruimte-context
ruimte.build
ruimte.bundle.json
```

macOS also contains `ruimte-simulator-helper` and these files under `native/`:

```text
serve-sim-ax-settings
serve-sim-native.node
```

Physical iOS transport is linked into `ruimte`. The daemon starts a hidden subprocess of its own executable for each physical stream, keeping the private transport isolated without installing a second bridge executable.

The version and unique build id are embedded in the Rust binary. `ruimte.build` carries the same build id for installation and replacement checks. A release build does not trust `RUIMTE_PULSAR_TEST_STATEMENT_KEY` from its environment.

## Target matrix

| Host                | Output        | Device helpers                                         |
| ------------------- | ------------- | ------------------------------------------------------ |
| macOS Apple silicon | `mac-arm64`   | Simulator helper; physical bridge embedded in `ruimte` |
| macOS Intel         | `mac-x64`     | Simulator helper; physical bridge embedded in `ruimte` |
| Linux arm64         | `linux-arm64` | None                                                   |
| Linux x64           | `linux-x64`   | None                                                   |
| Windows             | Unsupported   | Unsupported                                            |

The macOS arm64 and Linux arm64 bundles have been built and launched during this synchronization. Linux verification used Debian 12 (Bookworm). The x64 build paths have not been exercised. Linux binaries inherit the build host’s glibc requirements; build on the oldest supported distribution and test there before distribution.

The requested OS and architecture must equal the build host. Cargo links the physical device bridge into the macOS `ruimte` binary. The compile script verifies the architecture of `serve-sim-native.node` and signs the Bun simulator helper ad hoc so it starts before release signing. Product distribution can replace the ad hoc signatures with its normal signing and notarization process.

## Verify the output

Set `BUNDLE` to the absolute path of the generated directory (for example, `BUNDLE="$PWD/apps/server-rust/dist/mac-arm64"` from the repository root), then check the embedded version:

```sh
"$BUNDLE/ruimte" --version
"$BUNDLE/ruimte" --help >/dev/null
cat "$BUNDLE/ruimte.build"
```

`ruimte-context` is exercised from an authenticated agent terminal because its commands require the context URL and bearer token injected by Ruimte.

On macOS:

```sh
file "$BUNDLE/ruimte" "$BUNDLE/ruimte-context" "$BUNDLE/ruimte-simulator-helper" "$BUNDLE/native/serve-sim-native.node"
otool -L "$BUNDLE/ruimte"
otool -L "$BUNDLE/ruimte-context"
codesign --verify --strict "$BUNDLE/ruimte-simulator-helper"
```

On Linux:

```sh
file "$BUNDLE/ruimte" "$BUNDLE/ruimte-context"
ldd "$BUNDLE/ruimte"
ldd "$BUNDLE/ruimte-context"
```

The Rust binaries use the operating system C library and standard system libraries reported by `otool` or `ldd`. On macOS, the embedded physical bridge reaches Apple's private CoreDevice and XPC entry points through libSystem; there is no separately bundled bridge library. These private protocols may change between operating system releases. The server's TLS stack is Rustls, so no separate OpenSSL runtime is required. Git and `rg` remain external commands for Git and filesystem features. Provider CLIs and Chrome are required only when their corresponding features are used. Simulator support also requires Xcode command line tools and installed Simulator runtimes.

Run a headless smoke test with an isolated home and disabled hook installation. Port zero lets the operating system choose a free port:

```sh
SMOKE_HOME="$(mktemp -d)"
SMOKE_LOG="$(mktemp)"
RUIMTE_HOME="$SMOKE_HOME" "$BUNDLE/ruimte" --no-hooks --no-broker --no-price-fetch --no-stun --port 0 >"$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
for SMOKE_ATTEMPT in $(seq 1 100); do
  grep -q 'listening on ws://' "$SMOKE_LOG" && break
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 0.1
done
if ! grep -q 'listening on ws://' "$SMOKE_LOG"; then
  cat "$SMOKE_LOG"
  kill "$SMOKE_PID" 2>/dev/null || true
  wait "$SMOKE_PID" 2>/dev/null || true
  rm -rf "$SMOKE_HOME" "$SMOKE_LOG"
  exit 1
fi
SMOKE_PORT="$(sed -n 's/.*listening on ws:\/\/[^:]*:\([0-9][0-9]*\)\/ws.*/\1/p' "$SMOKE_LOG" | tail -1)"
```

Verify health, then stop the process and remove the temporary data:

```sh
curl --fail "http://127.0.0.1:$SMOKE_PORT/health"
kill "$SMOKE_PID"
wait "$SMOKE_PID"
rm -rf "$SMOKE_HOME" "$SMOKE_LOG"
```

To serve an existing client build, either build it separately or include it during compilation:

```sh
bun run --cwd apps/client build
bun run --cwd apps/server-rust compile --version 0.1.0 --web-assets "$PWD/apps/client/dist"
"$BUNDLE/ruimte" --serve "$BUNDLE/web" --host 127.0.0.1 --port 4210
```

Keep a service's `--serve` path in a stable absolute location. The service installer copies daemon binaries and macOS device helpers, but it does not copy web assets.

## Install and roll back a service

These are manual operator steps. Building a bundle launches the binaries for validation and applies local ad hoc helper signatures. It does not install a service, start a persistent daemon, sign for distribution, or upload artifacts.

Stop any desktop-managed daemon before installing a standalone service. From the reviewed bundle:

```sh
"$BUNDLE/ruimte" service install --host 127.0.0.1 --port 4210
"$BUNDLE/ruimte" service status --port 4210
```

The installer copies the binaries, build marker, and packaged macOS simulator helpers into the daemon home before it publishes the new build marker. Physical iOS needs no separate installed artifact because its transport is part of `ruimte`. It uses launchd on macOS and a user systemd unit on Linux.

For rollback, keep the previous complete bundle. Run its installer with the same flags, then check status and health:

```sh
"$PREVIOUS_BUNDLE/ruimte" service install --host 127.0.0.1 --port 4210
"$PREVIOUS_BUNDLE/ruimte" service status --port 4210
curl --fail http://127.0.0.1:4210/health
```

To remove only the service and its installed executables:

```sh
"$BUNDLE/ruimte" service uninstall --port 4210
```

Projects, authentication state, and pairings remain in `RUIMTE_HOME` after uninstall.

## Release flow

The [release workflow](../../.github/workflows/release.yml) starts when a `v*` tag is pushed. It creates a GitHub draft, verifies the Cargo workspace and repository, then builds the native daemon and desktop app on macOS arm64, Linux x64 and Linux arm64. Each Linux build runs on its target architecture. Publishing the draft ships the release, so first confirm that verification and every packaging job succeeded. The workflow has no macOS Intel job.

A Rust server release needs the following steps:

1. Select the reviewed commit and semantic version. Run the native tests, daemon integration tests and repository checks described in [VERIFICATION.md](VERIFICATION.md).
2. Build a complete native bundle on each supported host using the same version. Keep the manifest and matching build marker with its binaries and helpers.
3. Verify each staged bundle outside the checkout: version, dynamic libraries, health, authentication and optional web assets. On macOS, also exercise simulator capture and input. Test physical iOS hardware before claiming hardware coverage.
4. If distributing signed macOS artifacts, apply the product signing and notarization process, then recheck signatures and launch the signed output.
5. Archive the complete bundle and generate its checksum. Keep the previous bundle for rollback.
6. Review the native desktop artifacts in the draft release. Publish only after the required targets and checks pass. The compile command itself performs no upload.

## Stage a Rust desktop package

`electron-builder.yml` reads its daemon resources from `apps/server-rust/dist/<os>-<arch>`. For macOS arm64, run these commands from the repository root:

```sh
bun run --cwd apps/client build
bun run --cwd apps/server-rust compile --version 0.1.0
bun run --cwd apps/desktop build:main
(cd apps/desktop && bun x electron-builder --mac --arm64 --publish never -c.extraMetadata.version=0.1.0)
```

The macOS signing list covers `ruimte`, `ruimte-context`, `ruimte-simulator-helper`, `native/serve-sim-ax-settings`, and `native/serve-sim-native.node`. Signing `ruimte` covers the embedded physical bridge code. Review its libSystem and private XPC linkage in the final `otool -L` output. Review the packaged app and notarization results separately from the standalone server checks.

### Build a separate local macOS app

This produces a local `Ruimte Rust.app` with its own application id, package name and single-instance identity. It still uses the production daemon home at `~/.ruimte`. The build has no update feed and cannot replace itself from the public release channel. Run from the repository root:

```sh
LOCAL_VERSION=0.0.0-rust-local
LOCAL_OUTPUT="$(mktemp -d /tmp/ruimte-rust-local-signed.XXXXXX)"

bun run --cwd apps/client build
CARGO_TARGET_DIR=/tmp/ruimte-rust-production-target \
  bun run --cwd apps/server-rust compile -- --version "$LOCAL_VERSION"
bun run --cwd apps/desktop build:main

(cd apps/desktop && bun x electron-builder \
  --mac --arm64 --dir --publish never \
  -c.productName="Ruimte Rust" \
  -c.appId=app.ruimte.rust \
  -c.extraMetadata.name=ruimte-rust \
  -c.extraMetadata.productName="Ruimte Rust" \
  -c.extraMetadata.version="$LOCAL_VERSION" \
  -c.directories.output="$LOCAL_OUTPUT" \
  -c.publish=null \
  -c.mac.identity=-)

LOCAL_APP="$LOCAL_OUTPUT/mac-arm64/Ruimte Rust.app"
codesign --verify --deep --strict --verbose=2 "$LOCAL_APP"
test ! -e "$LOCAL_APP/Contents/Resources/app-update.yml"
```

The `-` identity applies an ad-hoc hardened-runtime signature with the checked-in entitlements. It does not use a Developer ID certificate and does not notarize or publish anything. After reviewing the staged app, install it without changing its bundle layout:

```sh
test ! -e "$HOME/Applications/Ruimte Rust.app" &&
  mkdir -p "$HOME/Applications" &&
  ditto "$LOCAL_APP" "$HOME/Applications/Ruimte Rust.app"
```

Starting the local app uses `~/.ruimte` unless `RUIMTE_HOME` is explicitly set in its environment. The distinct `app.ruimte.rust` id and `ruimte-rust` package name keep its application identity separate from the ordinary Ruimte desktop app.

The synchronization verified standalone macOS arm64 and Linux arm64 production bundles, including a real simulator with no Bun installation on the daemon's `PATH`. Before the crate split, an iPhone 18 Pro Max produced 90 HTTP frames, 92 event frames and 90 production HTTP frames without sequence gaps; FFmpeg and Chromium WebCodecs decoded every captured HEVC frame at 1328 by 2896. Rust physical streaming uses only the embedded bridge subprocess and has no screenshot fallback. Physical HID input, real service installation, distribution signing and notarization remain untested. No release was published.
