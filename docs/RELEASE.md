# Releasing the desktop app

`bun run dist` builds the client, compiles the daemon for this machine and packages the Electron
shell into `apps/desktop/release`. A `v*` tag runs the same thing on GitHub Actions and uploads a
draft release. macOS is built for Apple silicon only: `minimumSystemVersion` is 26.0, and the four
Intel Macs that reach macOS 26 are frozen there, because 27 is Apple silicon only. Linux is built
for x64 and arm64 on Ubuntu 22.04 runners, as AppImage, deb and rpm; see `docs/LINUX.md`.

## Windows

Windows 11 x64 is built but not shipped yet (`docs/WINDOWS.md`). The `windows` job in `release.yml`
runs only when the repository variable `WINDOWS_RELEASE` is `true`; otherwise it is skipped and the
release goes out for macOS and Linux as before. With the variable on, it builds the client and
compiles the daemon on `windows-latest` (NSIS needs Windows; the daemon itself would cross-compile),
then `electron-builder --win --x64 --publish always` uploads `Ruimte-<version>-x64-setup.exe`, its
blockmap, `latest.yml` and a zip into the same draft. `publish` waits for it, so a failed Windows build
keeps the whole release a draft. `after-pack.cjs` refuses a Windows package without `bin/ruimte.exe`,
`bin/ruimte-context.cmd` and `bin/native/adecore-database.exe`. The site sends `/download/windows` to
the installer of the latest release.

npm reads the same variable: without it `build.ts --skip win32-x64` leaves `@ruimte/win32-x64` out of
the release and out of the launcher's dependencies. The launcher refuses Windows either way, until
`WINDOWS_REFUSAL` comes off.

The build is unsigned: SmartScreen warns on the installer, and electron-updater has no publisher
to check an update against. Before `WINDOWS_RELEASE` goes on, Bas decides:

- How to sign: an OV or EV certificate (electron-builder reads `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD`, or a hardware token), or a cloud signing service, which needs a signing step
  in the `windows` job. The job marks where it goes.
- Whether an unsigned first Windows release is acceptable.
- Publishing the `@ruimte/win32-x64` placeholder once and setting Trusted Publishing on it, as below.
  Without that the npm publish fails on Windows before the launcher goes out.

## Build caches

CI's `packaged (macOS)` job, the macOS desktop release and the macOS npm build share the native build
caches through `.github/actions/cache-native-builds`. CI on `main` fills them: GitHub lets a release
tag restore `main`'s caches, but isolates caches written under different tags.

Rust caches its dependencies and recompiles the helpers. Swift release products are reused only
when the helper sources, manifests, build scripts, macOS, Xcode and SDK match exactly. A missing
product is built again. The daemon is always compiled with the current release version, and the
computer use app is assembled with that version before signing and notarization.

## npm

Publishing a release also publishes `ruimte` and its platform binary packages at the application
version: three, and `win32-x64` once Windows ships. Shared libraries come from Adecore at the version pinned in the manifests and
`bun.lock`; Ruimte's application version moves on its own.

`.github/workflows/npm.yml` runs on `release: published`, on the dispatch sent by `release.yml`, or
by hand (`gh workflow run npm.yml -f version=0.2.0`, for an existing tag). The dispatch from
`release.yml` names its own run in `release_run`, and npm.yml publishes the daemons that run
compiled for the desktop builds, kept as artifacts for 7 days. Without `release_run` it compiles
the daemon itself, for `darwin-arm64` on macOS and `linux-x64`, `linux-arm64` and `win32-x64` on
Ubuntu. Either way
`packages/npm/scripts/build.ts` prepares the packages. `publish.ts` publishes the platform binaries before the
launcher, skips versions already on npm and uses `next` for prereleases.

This repository no longer publishes libraries: the `libraries-v*` trigger, the library jobs, their
build script and their placeholders are gone. Adecore owns its library builds and the Trusted
Publishing of its npm names.

There is no npm token. Every package trusts the workflow through Trusted Publishing, set on
npmjs.com per package under Settings, Trusted publishing: GitHub Actions, owner `basmilius`,
repository `ruimte`, workflow `npm.yml`, environment `npm`. npm only offers that setting for a
package that exists, which is what the `0.0.0` folders in `packages/npm/placeholders` were published
for, by hand and once. A new platform package needs the same two steps before its first release:

```sh
npm login
cd packages/npm/placeholders/linux-x64
npm publish --access public
```

A macOS binary is compiled on macOS: Bun writes the bundle after it signs, and a darwin binary that
`codesign` did not sign again is killed at launch with an invalid signature.

To try the packages without publishing:

```sh
RUIMTE_VERSION=0.0.0-local bun apps/server/scripts/compile.ts --target darwin-arm64 --outdir /tmp/npm/binaries/darwin-arm64
bun packages/npm/scripts/build.ts --version 0.0.0-local --binaries /tmp/npm/binaries --out /tmp/npm/out --only darwin-arm64
bun packages/npm/scripts/publish.ts --out /tmp/npm/out --dry-run    # wants every platform the launcher names
```

`bun run test:package` does the first two and runs `node <launcher> --version` against the result. It also runs as part of `bun run test:integration`; CI checks it in a separate job alongside the core integrations.

## The icon

`assets/AppIcon.icon` is the Icon Composer document, and the only source. `bun run --cwd apps/desktop icon`
compiles it with `actool` into `apps/desktop/build/icon`:

- `Assets.car` is what macOS 26 reads. It carries the light, dark, tinted and clear renderings, so
  the icon follows the system the way a native app does.
- `AppIcon.icns` serves whoever asks for a file instead. It tops out at 256px, which is all actool
  writes for a 26.0 deployment target.

Both are committed, because actool only understands `.icon` from Xcode 26 on and the runner that
builds a release may carry an older one. Run the script again whenever the document changes.

`electron-builder.yml` ties them together: `mac.icon` points at the icns, `mac.extraResources`
copies the catalog into `Contents/Resources`, and `mac.extendInfo` sets `CFBundleIconName`, the key
that sends macOS to the catalog. `minimumSystemVersion` is `26.0`, so there is no older system to
fall back for.

## Signing

A Developer ID Application certificate in the login keychain is enough; electron-builder finds it
by itself. The app is signed with the hardened runtime and the entitlements in
`build/entitlements.mac.plist`, which open up JIT for Electron and for the Bun runtime inside the
daemon.

The daemon is not a helper Electron knows about, so `mac.binaries` names it. Without that line it
ships unsigned inside a signed app and Apple refuses the notarization.

The computer use helper is an app of its own in `Contents/Helpers` (`apps/computer-use/README.md`).
electron-builder finds and signs it by itself, but through `build/sign.cjs`, which gives it the empty
entitlements in `apps/computer-use/Resources/entitlements.plist` instead of the shell's. Its signature
should read `flags=0x10000(runtime)`, a `Timestamp` and no entitlements:

```sh
codesign -dv --entitlements - "apps/desktop/release/mac-arm64/Ruimte.app/Contents/Helpers/Ruimte Computer Use.app"
```

After a build, three commands say whether it is sound:

```sh
codesign --verify --deep --strict --verbose=2 apps/desktop/release/mac-arm64/Ruimte.app
codesign -dv --entitlements - apps/desktop/release/mac-arm64/Ruimte.app/Contents/Resources/bin/ruimte
spctl -a -vvv -t exec apps/desktop/release/mac-arm64/Ruimte.app
```

The daemon should report `flags=0x10000(runtime)`, a `Timestamp` and the five entitlements,
`com.apple.security.device.audio-input` among them. macOS attributes a microphone request from an
app started in a Ruimte terminal to this bundled daemon, so the daemon needs the entitlement as well as
the Electron shell. `spctl` answers `rejected / source=Unnotarized Developer ID` until the app has
been through notarization, which is the expected answer for a local build.

## Notarization

Apple needs an App Store Connect API key: a `.p8` file, its key id and the issuer id of the team.
Create one under Users and Access, Integrations, App Store Connect API, with the Developer role. The
`.p8` downloads once.

electron-builder reads three environment variables and hands them to `notarytool`:

```sh
export APPLE_API_KEY=~/keys/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
bun run dist -- -c.mac.notarize=true
```

Notarization uploads the zip, waits for Apple's answer and staples the ticket to the app. A first
pass takes a few minutes. `xcrun stapler validate` on the `.app` and a clean `spctl` say it worked.

`spctl` judges the DMG around the app `rejected, source=no usable signature`, because electron-builder
notarizes and staples the `.app` and then builds the disk image around it. That verdict is stricter
than the policy macOS applies when someone opens a downloaded DMG: a quarantined one opens on the
drag-to-Applications window without a warning, and the app it hands over carries its own ticket.
Notarizing the image itself would change its bytes after `latest-mac.yml` records their hash, so
leave it alone.

A published release does not reach the app at once. electron-updater reads
`https://github.com/basmilius/ruimte/releases.atom`, and GitHub serves that feed from a cache: for
a few minutes after publishing, a check still answers that the app is up to date. The same cache is
why the feed can answer 404 just after a repository is made public. Wait and check again before
going looking for a bug in the updater.

The notes ride on the tag. `git tag -a v<version> -F <file> --cleanup=verbatim` puts them in the tag
message and the `draft` job reads them back, so the draft carries its notes from the moment it
exists. `--cleanup=verbatim` is not optional. Git cleans a tag message the way it cleans a commit
message, and every `## Features` in the notes is a comment to it. A lightweight tag leaves the notes
empty.

The app reads the notes from the GitHub API and shows them in About and behind the toast after an
update from the moment the release is published, so a release published with empty notes reads
"No notes for this version." until someone fills them in and the app asks again. The draft itself
stays out of the app, but not out of the feed: a pushed tag whose release is still a draft already
appears in `releases.atom`.

The `publish` job publishes the draft once `verify` (every job of `ci.yml`, run on the tagged commit)
and every build succeed. It publishes as Latest, or as a prerelease for a tag with a `-` in it, and
it does not download the build to try the daemon in it first. If a release does turn out broken
on start, look there: start `Contents/Resources/bin/ruimte` from the arm64 zip with a temporary
`RUIMTE_HOME` and another port, wait for `/health`, then open a socket with
`?protocol=N&token=<local.key>` and check that `endpoint.info` carries `protocol`. A client refuses
a machine whose `endpoint.info` lacks it.

## The secrets in CI

`.github/workflows/release.yml` signs and notarizes every release, and stops before building when
one of these five repository secrets is empty, so the draft stays a draft:

| Secret             | What it is                                      |
| ------------------ | ----------------------------------------------- |
| `CSC_LINK`         | the Developer ID certificate as a base64 `.p12` |
| `CSC_KEY_PASSWORD` | the password of that `.p12`                     |
| `APPLE_API_KEY_P8` | the contents of the `.p8`, newlines and all     |
| `APPLE_API_KEY_ID` | the key id                                      |
| `APPLE_API_ISSUER` | the issuer id                                   |

The workflow creates the draft release before electron-builder starts. Left to itself, two artifacts
that finish at the same moment both see no release, both create one, and the upload behind the race
it loses disappears without an error in the log.

Export the certificate and its private key from Keychain Access, then encode it with
`base64 -i cert.p12 | pbcopy`. The workflow writes the `.p8` to a file under `RUNNER_TEMP`
for the length of the job, because notarytool reads the key from disk, and removes it afterwards.

Two things can go wrong with that `.p12`.

Apple's `security import` reads only the old PKCS12 ciphers. A file written by OpenSSL 3 with its
defaults comes back as `MAC verification failed during PKCS12 import (wrong password?)`, which is
about the algorithm, not the password. Rebuild one with `-legacy -macalg sha1` and
`-certpbe pbeWithSHA1And3-KeyTripleDES-CBC -keypbe pbeWithSHA1And3-KeyTripleDES-CBC`.

Electron-builder before 26.16.1 unlocked its own keychain with the wrong password
(electron-builder#10172), and the manifest pins `^26.16.1`. A release that fails with
`SecKeychainUnlock: The user name or passphrase you entered is not correct` has an older
electron-builder again.

Crash reports go to Observatory (`ingest.bmnw.nl`, product Ruimte). `OBSERVATORY_UPLOAD_TOKEN`, an
upload token of that product, lets the `error-tracking` job report the deploy of `ruimte@<version>`,
the release the daemon, the shell and the page report their crashes under, once the release is
published. That job may fail without holding up the release. `RUIMTE_TELEMETRY=1` is what turns crash reports on: the compile steps stamp it into
the daemon (see "Crash reports" in `apps/server/README.md`), `build:main` into the shell, and the
client build into the page (`apps/client/README.md`).

The client build of a release writes hidden source maps. `.github/actions/client-source-maps` gives
the build debug ids, uploads the maps with the same token and deletes them,
and electron-builder leaves out any `.map` that is still there. Without the token the maps are only
deleted and the page's stack traces stay minified. The station deploy does the same under
`ruimte@station-<commit>` and reports that deploy, and `.assetsignore` keeps a map out of its assets.

A native crash of the shell arrives as a minidump in an envelope, without Electron's symbols: the
module, the process and the crash reason say whether it is ours, and the shell has no native module of
its own. Electron's symbols take hundreds of MB per platform and are more than Observatory's ingest
takes in one request; a crash that keeps coming back is symbolicated locally with the symbols of its
Electron version.
