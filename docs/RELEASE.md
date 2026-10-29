# Releasing the desktop app

The release rules are in the root `CLAUDE.md` ("Releasing"). This file is the recipe.

`bun run dist` builds the client, compiles the daemon for this machine and packages the shell into `apps/desktop/release`. A `v*` tag does the same on GitHub Actions into a draft release. macOS is Apple silicon only (`minimumSystemVersion` 26.0; the Intel Macs that reach 26 stop there, since 27 is Apple silicon only). Linux is x64 and arm64 as AppImage, deb and rpm ([LINUX.md](LINUX.md)).

## Tag and publish

Tag with `git tag -a v<version> -F <notes-file> --cleanup=verbatim`. Without that flag git strips every `##` line as a comment; a lightweight tag has no notes at all. The `draft` job copies the notes from the tag.

`publish` publishes the draft once `verify` (every `ci.yml` job on the tagged commit) and every build pass: as a prerelease for a tag with a `-`, otherwise as Latest. It never tries the built daemon.

- The app shows the notes in About and the update toast. Empty notes read "No notes for this version." until filled in.
- A draft's tag already appears in `releases.atom`.
- electron-updater reads `https://github.com/basmilius/ruimte/releases.atom`, which GitHub caches for a few minutes. Wait before suspecting the updater.

When a published release fails to start, run `Contents/Resources/bin/ruimte` from the arm64 zip with a temporary `RUIMTE_HOME` and another port, wait for `/health`, open a socket with `?protocol=N&token=<local.key>` and check that `endpoint.info` carries `protocol`. A client refuses a machine without it.

## Secrets in CI

`release.yml` stops before building, leaving the draft, when one of these is empty:

| Secret             | What it is                                      |
| ------------------ | ----------------------------------------------- |
| `CSC_LINK`         | the Developer ID certificate as a base64 `.p12` |
| `CSC_KEY_PASSWORD` | the password of that `.p12`                     |
| `APPLE_API_KEY_P8` | the contents of the `.p8`, newlines and all     |
| `APPLE_API_KEY_ID` | the key id                                      |
| `APPLE_API_ISSUER` | the issuer id                                   |

Export certificate and private key from Keychain Access, then `base64 -i cert.p12 | pbcopy`. The workflow writes the `.p8` under `RUNNER_TEMP` for the job and removes it afterward. It creates the draft before electron-builder starts, since two artifacts finishing together would otherwise each create a release and one upload would vanish silently.

- `MAC verification failed during PKCS12 import (wrong password?)`: OpenSSL 3 wrote ciphers `security import` cannot read. Rebuild with `-legacy -macalg sha1 -certpbe pbeWithSHA1And3-KeyTripleDES-CBC -keypbe pbeWithSHA1And3-KeyTripleDES-CBC`.
- `SecKeychainUnlock: The user name or passphrase you entered is not correct`: electron-builder is older than 26.16.1 again (electron-builder#10172). The manifest pins `^26.16.1`.

`OBSERVATORY_UPLOAD_TOKEN` is an upload token of the Ruimte product on Observatory (`ingest.bmnw.nl`). The `error-tracking` job reports the deploy of `ruimte@<version>` after publishing and may fail without holding up the release. The same token uploads the client's hidden source maps through `.github/actions/client-source-maps`, which then deletes them; without it the maps are only deleted. It also uploads each compiled daemon's source map through `.github/actions/daemon-source-map`; the map is kept beside the binary's folder, never in it. electron-builder ships no `.map`. `RUIMTE_TELEMETRY=1` turns crash reports on, stamped into the daemon by the compile steps (`apps/server/README.md`, "Crash reports"), into the shell by `build:main` and into the page by the client build.

A native shell crash arrives as a minidump without Electron's symbols, which are too large for Observatory. Symbolicate a recurring one locally with its Electron version's symbols.

## Station and bench

After `release.yml` publishes a Latest release it dispatches `station.yml` and `bench.yml` for that tag (by hand: `gh workflow run station.yml -f version=0.2.0`). Each builds the tag, uploads maps under `ruimte@<version>` and deploys; `.assetsignore` keeps maps out. A push, a prerelease or an older line published by hand deploys neither.

## npm

A published release puts `ruimte` and its three platform packages on npm at the app version (`win32-x64` once Windows ships). Shared libraries come from Adecore; this repository publishes none.

`npm.yml` runs on `release: published`, on the dispatch from `release.yml`, or by hand for an existing tag (`gh workflow run npm.yml -f version=0.2.0`). With `release_run` it publishes the daemons that run compiled (artifacts kept 7 days). Without it, it compiles `darwin-arm64` on macOS and `linux-x64`, `linux-arm64` and `win32-x64` on Ubuntu. `packages/npm/scripts/build.ts` prepares the packages; `publish.ts` publishes the platform binaries before the launcher, skips versions already on npm and tags prereleases `next`. A macOS binary must compile on macOS, or `codesign` leaves it with a signature that is killed at launch.

There is no npm token. Every package uses Trusted Publishing (npmjs.com, Settings, Trusted publishing): GitHub Actions, owner `basmilius`, repository `ruimte`, workflow `npm.yml`, environment `npm`. npm offers that only for an existing package, so publish a new platform package's `0.0.0` placeholder once by hand first:

```sh
npm login
cd packages/npm/placeholders/linux-x64
npm publish --access public
```

Try the packages without publishing:

```sh
RUIMTE_VERSION=0.0.0-local bun apps/server/scripts/compile.ts --target darwin-arm64 --outdir /tmp/npm/binaries/darwin-arm64
bun packages/npm/scripts/build.ts --version 0.0.0-local --binaries /tmp/npm/binaries --out /tmp/npm/out --only darwin-arm64
bun packages/npm/scripts/publish.ts --out /tmp/npm/out --dry-run    # wants every platform the launcher names
```

`bun run test:package` runs the first two and `node <launcher> --version`. It is part of `test:integration` and a separate CI job.

## Windows

Built, not shipped ([WINDOWS.md](WINDOWS.md)). The `windows` job runs only when the repository variable `WINDOWS_RELEASE` is `true`. On `windows-latest` (NSIS needs Windows), `electron-builder --win --x64 --publish always` uploads `Ruimte-<version>-x64-setup.exe`, its blockmap, `latest.yml` and a zip. `publish` waits for it, so a failed Windows build keeps the release a draft. `after-pack.cjs` refuses a package without `bin/ruimte.exe`, `bin/ruimte-context.exe` and `bin/native/adecore-database.exe`. `/download/windows` on the site points at the latest installer.

Without the variable, `build.ts --skip win32-x64` leaves `@ruimte/win32-x64` out of npm. The launcher refuses Windows until `WINDOWS_REFUSAL` comes off.

The build is unsigned (SmartScreen warns; electron-updater has no publisher to check). Before `WINDOWS_RELEASE` goes on, Bas decides:

- How to sign. An OV or EV certificate (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, or a hardware token), or a cloud signing service with a step where the `windows` job marks it.
- Whether an unsigned first release is acceptable.
- Publishing the `@ruimte/win32-x64` placeholder and setting Trusted Publishing on it. Without that the npm publish fails before the launcher goes out.

## Build caches

CI's `packaged (macOS)`, the macOS release and the macOS npm build share native caches through `.github/actions/cache-native-builds`. CI on `main` fills them; a tag can restore `main`'s caches but not another tag's. Rust caches dependencies and recompiles the helpers. A Swift product is reused only when sources, manifests, build scripts, macOS, Xcode and SDK all match. The daemon and the computer use app always build with the release version.

## Icon

`assets/AppIcon.icon` is the only source. `bun run --cwd apps/desktop icon` compiles it with `actool` into `apps/desktop/build/icon`: `Assets.car` (what macOS 26 reads, with light, dark, tinted and clear) and `AppIcon.icns` (256px at most for a 26.0 target). Both are committed, because a release runner may have Xcode older than 26. Rerun after changing the document. `electron-builder.yml` points `mac.icon` at the icns, copies the catalog with `mac.extraResources` and sets `CFBundleIconName` in `mac.extendInfo`.

## Signing

A Developer ID Application certificate in the login keychain is enough. The app uses the hardened runtime and `build/entitlements.mac.plist` (JIT for Electron and the daemon's Bun). `mac.binaries` names the daemon; without it Apple refuses notarization.

The computer use helper in `Contents/Helpers` (`apps/computer-use/README.md`) is signed through `build/sign.cjs` with the empty `apps/computer-use/Resources/entitlements.plist`. Expect `flags=0x10000(runtime)`, a `Timestamp` and no entitlements:

```sh
codesign -dv --entitlements - "apps/desktop/release/mac-arm64/Ruimte.app/Contents/Helpers/Ruimte Computer Use.app"
```

Check a build:

```sh
codesign --verify --deep --strict --verbose=2 apps/desktop/release/mac-arm64/Ruimte.app
codesign -dv --entitlements - apps/desktop/release/mac-arm64/Ruimte.app/Contents/Resources/bin/ruimte
spctl -a -vvv -t exec apps/desktop/release/mac-arm64/Ruimte.app
```

The daemon shows `flags=0x10000(runtime)`, a `Timestamp` and five entitlements, `com.apple.security.device.audio-input` among them, because macOS attributes a microphone request from a Ruimte terminal to the daemon. Before notarization `spctl` answers `rejected / source=Unnotarized Developer ID`.

## Notarization

Create an App Store Connect API key (Users and Access, Integrations, App Store Connect API, Developer role); the `.p8` downloads once.

```sh
export APPLE_API_KEY=~/keys/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
bun run dist -- -c.mac.notarize=true
```

`xcrun stapler validate` on the `.app` and a clean `spctl` confirm it. `spctl` rejects the DMG (`source=no usable signature`) because the ticket is stapled to the app inside; macOS opens it without a warning. Never notarize the DMG: that changes its bytes after `latest-mac.yml` recorded their hash.
