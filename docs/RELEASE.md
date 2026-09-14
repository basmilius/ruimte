# Releasing the desktop app

`bun run dist` builds the client, compiles the daemon for this machine and packages the Electron
shell into `apps/desktop/release`. A `v*` tag runs the same thing on GitHub Actions and uploads a
draft release. macOS is built for Apple silicon only: `minimumSystemVersion` is 26.0, and the four
Intel Macs that reach macOS 26 are frozen there, because 27 is Apple silicon only. Linux is built
for x64 and arm64 on Ubuntu 22.04 runners, as AppImage, deb and rpm; see `docs/LINUX.md`.

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

After a build, three commands say whether it is sound:

```sh
codesign --verify --deep --strict --verbose=2 apps/desktop/release/mac-arm64/Ruimte.app
codesign -dv --entitlements - apps/desktop/release/mac-arm64/Ruimte.app/Contents/Resources/bin/ruimte
spctl -a -vvv -t exec apps/desktop/release/mac-arm64/Ruimte.app
```

The daemon should report `flags=0x10000(runtime)`, a `Timestamp` and the four entitlements. `spctl`
answers `rejected / source=Unnotarized Developer ID` until the app has been through notarization,
which is the expected answer for a local build.

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

## The secrets in CI

`.github/workflows/release.yml` notarizes when `APPLE_API_KEY_P8` is set, and only signs when it is
not. Five repository secrets:

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | the Developer ID certificate as a base64 `.p12` |
| `CSC_KEY_PASSWORD` | the password of that `.p12` |
| `APPLE_API_KEY_P8` | the contents of the `.p8`, newlines and all |
| `APPLE_API_KEY_ID` | the key id |
| `APPLE_API_ISSUER` | the issuer id |

The workflow creates the draft release before electron-builder starts. Left to itself, two artifacts
that finish at the same moment both see no release, both create one, and the upload behind the race
it loses disappears without an error in the log.

Export the certificate from Keychain Access (the private key, not just the certificate) and encode
it with `base64 -i cert.p12 | pbcopy`. The workflow writes the `.p8` to a file under `RUNNER_TEMP`
for the length of the job, because notarytool reads the key from disk, and removes it afterwards.

Two things about that `.p12` cost an afternoon once.

Apple's `security import` reads only the old PKCS12 ciphers. A file written by OpenSSL 3 with its
defaults comes back as `MAC verification failed during PKCS12 import (wrong password?)`, which is
about the algorithm, not the password. Rebuild one with `-legacy -macalg sha1` and
`-certpbe pbeWithSHA1And3-KeyTripleDES-CBC -keypbe pbeWithSHA1And3-KeyTripleDES-CBC`.

And the workflow builds the keychain itself rather than handing electron-builder `CSC_LINK`, because
electron-builder creates a keychain with a random password and then unlocks it with the `.p12`
password, so `security set-key-partition-list` answers `SecKeychainUnlock: The user name or
passphrase you entered is not correct`. With the identity in a keychain on the search list,
electron-builder finds it by discovery and never touches the file.
