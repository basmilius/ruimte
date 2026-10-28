# Linux

Linux packaging exists; packaged-app acceptance is still open. The daemon has a Debian setup in `apps/server/docker`, spawns PTYs through
`Bun.spawn({ terminal })`, reads DMI and the device tree for the machine model, reveals through
`xdg-open` and falls back to per-directory watching. Newer native dependencies, such as the
ADE CORE database helper and the separately installed PHP language server, need Linux build and
runtime checks of their own; the older shell smoke test below does not cover them.

On Fedora 44 (x64, Wayland) the packaged rpm brought its daemon up, loaded the window, shut down
cleanly on SIGTERM and updates through `RpmUpdater`. The AppImage needs FUSE 2, which Fedora 44 does
not ship; `--appimage-extract-and-run` starts it.

## The packaging config

Four settings in `electron-builder.yml` under `linux:` and in `apps/desktop/package.json`, three
of them forced by the `@ruimte/desktop` scope. Leave them alone.

```yaml
linux:
    target: [AppImage, deb, rpm]
    artifactName: ${productName}-${version}-${arch}.${ext}
    executableName: ruimte
    syncDesktopName: true
```

```json
"desktopName": "ruimte.desktop"
```

`deb` and `rpm` put `${name}` in the artifact name, so without `artifactName` the build writes to
`release/@ruimte/desktop-0.0.0.x86_64.rpm` and fpm dies on a directory that does not exist.
`executableName` defaults to the sanitized package name, `@ruimtedesktop`, which then lands in the
binary, the icons and the `.desktop` file. `desktopName` with `syncDesktopName` ties the entry to
Electron's app id, so a desktop environment can match the running window to the icon it launched.
AppImage uses `${productName}` and was never affected.

Do not set `linux.icon`. Left alone, electron-builder generates the whole set from `mac.icon`
(`build/icon/AppIcon.icns`) and installs its sizes in `hicolor`. Pointed at a single PNG it installs
that one icon and nothing else.

## The release workflow

The `linux` job in `.github/workflows/release.yml` builds x64 on `ubuntu-22.04` and arm64 on
`ubuntu-22.04-arm`, and uploads the AppImage, the deb, the rpm and each arch's feed
(`latest-linux.yml`, `latest-linux-arm64.yml`) into the draft.

- **22.04, not `ubuntu-latest`.** The runner sets the glibc floor for both the Bun daemon and
  Electron. 24.04 (glibc 2.39) locks out Debian 12 and Ubuntu 22.04.
- **Every format.** A feed has to carry the format someone installed from, or their update finds
  no file, so the job that publishes the feed builds all three targets.
- **`rpm` from apt.** The rpm goes through fpm, which needs `rpmbuild` on the runner. The default
  rpm dependencies are the right ones, so no `rpm.depends` block is needed.
- **A draft job of its own**, so three parallel builds do not wait on the macOS job.
- **CI gates the release.** The reusable CI workflow runs the core integration suite and the
  packaged daemon on Linux as well as on macOS: `integration (Linux)` on `ubuntu-latest` and
  `packaged (Linux)` on `ubuntu-22.04`, the release's own runner. Both are required by `CI checks`.
  Verification, the unit shards and the DOM tests run on Linux too.

## Open

1. **Fonts with a Linux face.** `--font-sans` and `--font-mono` in `@adecore/ui/theme.css` name
   only Apple, Microsoft and web faces (an issue for that library, not a patch here), so both fall
   through to the generic on a Linux desktop. Candidates are Cantarell, Ubuntu and Noto Sans for the
   first, and DejaVu Sans Mono, Liberation Mono and Noto Sans Mono for the second. `DEFAULT_FONT_STACKS` in `@adecore/drawing/text.ts` has the
   same gap, and its `hand` stack names nothing a stock Linux box ships.
2. **Wayland.** The app runs under XWayland by default, which is blurry on fractional scaling.
   Whether to pass `--ozone-platform-hint=auto` is a choice, not a bug.

Unverified:

- the deb. Every release builds and uploads it for amd64 and arm64, but nobody has installed one.
  The `deb.depends` list in `apps/desktop/electron-builder.yml` still names `libgtk-3-0` and
  `libxss1`, which the t64 transition renamed or dropped, so install it on trixie and noble;
- arm64;
- the AppImage on Ubuntu 24.04, whose AppArmor policy takes away the unprivileged user namespaces
  Fedora allows;
- the frameless window under GNOME on X11 and under KDE, where resize borders and the compositor's
  own title bar menu are worth a look;
- what stays macOS-only in CI: the file system tests on a case-insensitive volume and the Swift and
  device-bridge jobs. The `ports` listener test has no Linux probe and skips there.
