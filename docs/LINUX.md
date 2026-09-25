# Linux

What is left before Ruimte ships on Linux. Almost all of it is packaging, CI and the Electron
shell. The daemon needs nothing: it has no native module, already runs on Debian in
`apps/server/docker`, spawns its PTYs through `Bun.spawn({ terminal })`, reads DMI and the device
tree for the machine model, reveals through `xdg-open` and falls back to per-directory watching.

An rpm and an AppImage were built and run on Fedora 44 (x64, Wayland) on 11 September 2026. The
packaged app brought its daemon up, loaded the window and shut down cleanly on SIGTERM. The rpm
installs `/opt/Ruimte` with the icon set from 16 to 512, and its updater goes through
`RpmUpdater`, so electron-builder's `resources/package-type` does its work. The AppImage needs
FUSE 2, which Fedora 44 does not ship; `--appimage-extract-and-run` starts it. That is an
AppImage property and one more reason the rpm matters.

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

Do not set `linux.icon`. Left alone, electron-builder generates the whole set from
`build/icon.png` and installs 16 through 512 in `hicolor`. Pointed at that same file it installs
one 1024x1024 icon and nothing else.

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
- **No check and no tests.** The macOS job runs both on the same commit, and `bun test` has never
  run on Linux.

## Open

1. **A Linux line in `.github/workflows/ci.yml`.** It runs on `macos-latest` only, so nothing
   catches a Linux regression before a tag.
2. **Fonts with a Linux face.** `--font-sans` and `--font-mono` in `apps/client/src/styles.css`
   name Apple, Microsoft and web faces only, so both fall through to the generic on a Linux
   desktop. Cantarell, Ubuntu and Noto Sans for the first, DejaVu Sans Mono, Liberation Mono and
   Noto Sans Mono for the second. `DEFAULT_FONT_STACKS` in `packages/drawing/src/text.ts` has the
   same gap, and its `hand` stack names nothing a stock Linux box ships.
3. **Wayland.** The app runs under XWayland by default, which is blurry on fractional scaling.
   Whether to pass `--ozone-platform-hint=auto` is a choice, not a bug.
4. **`site/index.html`** says Linux ships as AppImage and deb, and leaves the rpm out.

Unverified: the deb (never built, and the `deb.depends` list in `apps/desktop/electron-builder.yml`
names `libgtk-3-0` and `libxss1`, both renamed or dropped in the t64 transition, so install it on
trixie and noble); arm64; the
AppImage on Ubuntu 24.04, whose AppArmor policy takes away the unprivileged user namespaces
Fedora allows; the frameless window under GNOME on X11 and under KDE, where resize borders and the
compositor's own title bar menu are worth a look; and `bun test`, which spawns real shells and has
never run here.
