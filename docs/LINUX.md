# Linux

Linux packaging exists; a packaged-app check on real Linux desktops is still open. The daemon has a Debian setup in `apps/server/docker`. Newer native dependencies (the ADE CORE database helper, the separately installed PHP language server) need Linux build and runtime checks of their own.

On Fedora 44 (x64, Wayland) the packaged rpm started its daemon, loaded the window, shut down cleanly on SIGTERM and updated through `RpmUpdater`. The AppImage needs FUSE 2, which Fedora 44 lacks; `--appimage-extract-and-run` starts it.

## Packaging config

Leave these alone. Three of the four are forced by the `@ruimte/desktop` scope.

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

- Without `artifactName`, deb and rpm write to `release/@ruimte/desktop-0.0.0.x86_64.rpm` and fpm fails on the missing directory.
- Without `executableName`, the binary, icons and `.desktop` file are named `@ruimtedesktop`.
- `desktopName` with `syncDesktopName` ties the entry to Electron's app id, so the desktop matches the window to its icon.

Do not set `linux.icon`. Unset, electron-builder generates every size from `mac.icon` (`build/icon/AppIcon.icns`) into `hicolor`. Pointed at one PNG, it installs only that one.

## Release workflow

The `linux` job in `release.yml` builds x64 on `ubuntu-22.04` and arm64 on `ubuntu-22.04-arm`. It uploads the AppImage, deb, rpm and each arch's feed (`latest-linux.yml`, `latest-linux-arm64.yml`) into the draft.

- The runner sets the glibc floor for the daemon and Electron. 24.04 (glibc 2.39) would lock out Debian 12 and Ubuntu 22.04.
- The job builds all three formats, because a feed must carry the format someone installed from.
- fpm needs `rpmbuild`, installed from apt. The default rpm dependencies are right, so there is no `rpm.depends`.
- It has a draft job of its own, so it does not wait on macOS.
- CI runs `integration (Linux)` on `ubuntu-latest` and `packaged (Linux)` on `ubuntu-22.04`, both required by `CI checks`.

## Open

1. Fonts. `--font-sans` and `--font-mono` in `@adecore/ui/theme.css` name only Apple, Microsoft and web faces, so Linux falls through to the generic (an ADE CORE issue). Candidates: Cantarell, Ubuntu, Noto Sans; DejaVu Sans Mono, Liberation Mono, Noto Sans Mono. `DEFAULT_FONT_STACKS` in `@adecore/drawing/text.ts` has the same gap, and its `hand` stack names nothing a stock Linux ships.
2. Wayland. The app runs under XWayland by default, blurry on fractional scaling. Passing `--ozone-platform-hint=auto` is a choice, not a bug.

Unverified:

- The deb, for amd64 and arm64. `deb.depends` in `apps/desktop/electron-builder.yml` still names `libgtk-3-0` and `libxss1`, which the t64 transition renamed or dropped. Install it on trixie and noble.
- arm64.
- The AppImage on Ubuntu 24.04, whose AppArmor policy removes the unprivileged user namespaces Fedora allows.
- The frameless window under GNOME on X11 and under KDE: resize borders and the compositor's title bar menu.
- What stays macOS-only in CI: file system tests on a case-insensitive volume, and the Swift and device-bridge jobs. The `ports` listener test has no Linux probe and skips.
