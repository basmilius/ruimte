# Linux

What is left before Ruimte runs and ships on Linux. Almost all of it is packaging, CI and the
Electron shell. The daemon needs nothing: it has no native module, already runs on Debian in
`apps/server/docker`, spawns its PTYs through `Bun.spawn({ terminal })`, reads DMI and the device
tree for the machine model, reveals through `xdg-open` and falls back to per-directory watching.
The client needs one cosmetic thing, the font stacks. Everything else below is `apps/desktop`,
`electron-builder.yml` and the workflows.

An rpm and an AppImage were built and run on Fedora 44 (x64, Wayland) on 2026-09-11 with the
changes in `electron-builder.yml` and `apps/desktop/package.json` that this file describes. What
that run showed is under "What the first build proved".

## Done, in this branch

The packaging config needed four changes before a Linux artifact would build at all. They are in
`electron-builder.yml` under `linux:` and in `apps/desktop/package.json`:

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

The name of the workspace package is `@ruimte/desktop`, and that scope is what forces three of
them. `deb` and `rpm` put `${name}` in the artifact name, so the build wrote to
`release/@ruimte/desktop-0.0.0.x86_64.rpm` and fpm died on a directory that does not exist.
`executableName` defaults to the sanitized package name, which is `@ruimtedesktop`, and that name
was going into the binary, the icons and the `.desktop` file. `desktopName` with `syncDesktopName`
is what ties the entry to Electron's own app id, so a desktop environment can match the running
window to the icon it launched. AppImage was never affected: it uses `${productName}` by default.

Do not set `linux.icon`. Left alone, electron-builder generates the whole set from
`build/icon.png` and installs 16 through 512 in `hicolor`. Pointed at that same file it installs
one 1024x1024 icon and nothing else, which is worse.

## To build

1. **A Linux job in `.github/workflows/release.yml`.** Today the workflow is one `macos-latest`
   job that compiles the daemon `--os mac --arch arm64` and runs `electron-builder --mac --arm64`.
   Nothing builds Linux. The draft release is created before any upload already, so a second job
   needs no extra guard.

   ```yaml
   linux:
     runs-on: ${{ matrix.arch == 'arm64' && 'ubuntu-22.04-arm' || 'ubuntu-22.04' }}
     strategy:
       matrix:
         arch: [x64, arm64]
     steps:
       # checkout, setup-bun, install, RUIMTE_VERSION, check, test, client build
       - run: sudo apt-get update && sudo apt-get install -y rpm
       - run: bun run --cwd apps/server compile -- --os linux --arch ${{ matrix.arch }}
       - working-directory: apps/desktop
         env:
           GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
         run: |
           bun run build:main
           bun x electron-builder --linux --${{ matrix.arch }} --publish always \
             -c.extraMetadata.version="$RUIMTE_VERSION"
   ```

   The rpm goes through fpm, which needs `rpmbuild` on the runner, hence the `apt-get`. A Fedora
   box has it already. The default rpm dependencies are the right ones (`gtk3`, `libnotify`,
   `nss`, `libXScrnSaver`, `(libXtst or libXtst6)`, `xdg-utils`, `at-spi2-core`,
   `(libuuid or libuuid1)`), so no `rpm.depends` block is needed.

2. **Pin the runner to 22.04.** The runner sets the glibc floor for both the Bun daemon and
   Electron. `ubuntu-latest` is 24.04 (glibc 2.39), which locks out Debian 12 and Ubuntu 22.04.

3. **A Linux line in `.github/workflows/ci.yml`.** It runs on `macos-latest` only, so nothing
   catches a Linux regression before a tag.

4. **Publish every format, for the updater's sake.** Each arch's feed (`latest-linux.yml`, and
   `latest-linux-arm64.yml` for the other one) has to carry the format someone installed from, or
   their update finds no file. Build all three targets in the job that publishes the feed.

## To support

5. **Trim the application menu.** `Menu.setApplicationMenu` uses `appMenu, editMenu, viewMenu,
   windowMenu`. On Linux `appMenu` does produce About and Quit, but it also produces Services,
   Hide, Hide Others and Show All, four rows that do nothing off macOS. A template per platform.

6. **Fonts with a Linux face.** `--font-sans` and `--font-mono` in `apps/client/src/styles.css`
   name Apple, Microsoft and web faces only, so both fall through to the generic on a Linux
   desktop. Cantarell, Ubuntu and Noto Sans for the first, DejaVu Sans Mono, Liberation Mono and
   Noto Sans Mono for the second. `DEFAULT_FONT_STACKS` in `packages/drawing/src/text.ts` has the
   same gap, and its `hand` stack (`Kalam, "Comic Sans MS", cursive`) names nothing a stock Linux
   box ships, so a hand-written drawing falls back to whatever `cursive` resolves to.

7. **Wayland.** The app runs under XWayland by default, which is blurry on fractional scaling.
   Whether to pass `--ozone-platform-hint=auto` is a choice, not a bug.

## What the first build proved

Built with `bun x electron-builder --linux rpm --x64` after a client build, a
`bun run --cwd apps/server compile` (which wrote `dist/linux-x64/ruimte`, 95 MB, and runs) and a
`build:main`. Then the same for AppImage. Both were run from `release/`.

- **The rpm is correct.** `Ruimte-0.0.0-x86_64.rpm`, 113 MB, installs `/opt/Ruimte`, requires the
  eight default packages, ships `/usr/share/applications/ruimte.desktop` with
  `Exec=/opt/Ruimte/ruimte %U`, `Icon=ruimte` and `StartupWMClass=ruimte`, and carries the icon set
  from 16 to 512. The daemon and `ruimte-context` are at `resources/bin/`, the built client at
  `resources/client/`, the AppArmor profile at `resources/apparmor-profile`.
- **The app starts.** The packaged build brought its daemon up
  (`ruimte server 0.0.0 listening on ws://127.0.0.1:4299/ws`), installed its hooks, loaded the
  window and answered the smoke check with `window loaded` and `bridge is object`, then shut the
  daemon down cleanly on SIGTERM.
- **The updater picks the right installer.** electron-builder writes `resources/package-type`
  (`rpm`), and the run went through `RpmUpdater.doCheckForUpdates`, not the AppImage one. It failed
  with `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` on `latest-linux.yml`, which is exactly right: there is
  no Linux release yet. `describeUpdateError` already turns that 404 into a readable sentence.
- **The AppImage runs, but needs FUSE 2.** Fedora 44 ships FUSE 3 only, so the AppImage refuses to
  mount and prints the AppImageKit link. With `--appimage-extract-and-run` it starts and the window
  loads. That is an AppImage property, not ours, and it is one more reason the rpm matters.
- **No sandbox trouble here.** Neither run printed a sandbox error, and Fedora allows unprivileged
  user namespaces, which is the condition Ubuntu 24.04's AppArmor policy takes away. That case is
  still untested.
- **`updaterCacheDirName` is `@ruimtedesktop-updater`.** The last place the scoped package name
  shows through. It is a directory under the user's cache and harmless, but it is there.

## Still unverified

- **The deb.** There is no `dpkg` on this Fedora box, so the deb was never built. Its default
  dependency list is electron-builder's, `libgtk-3-0` and `libxss1` among them, both renamed or
  dropped in the t64 transition. Build it on the CI runner and install it on trixie and noble.
- **arm64.** Only x64 was built.
- **The AppImage on Ubuntu 24.04**, per the sandbox note above.
- **The frameless window on other desktops.** It draws correctly here. `titleBarStyle: 'hidden'`
  with `titleBarOverlay` is supported on Linux, but resize borders and the compositor's own title
  bar menu are worth a look under GNOME on X11 and under KDE.
- **`bun test` on Linux.** The docker suite skips itself unless enabled; the rest spawns real
  shells and has never run here.

## Also on this machine

`bun.lock` is modified from lockfileVersion 2 back to 1, because the local bun is 1.3.14 where the
committed lock came from 1.4.x. `bun install --frozen-lockfile` in CI would reject that downgrade
if it were committed, so do not commit it. Electron's binary also had to be fetched by hand
(`node install.js` in its package directory); its postinstall had not run in this checkout.

## Stale claims to correct

- `site/index.html` offers a "Download for Linux" button and says "Linux ships as AppImage and deb",
  pointing at a releases page with no Linux artifact. The caption wants the rpm in it too.
- `docs/RELEASE.md` says the Linux targets exist but no workflow asks for them, and `README.md` says
  a tag builds macOS. Both need the opposite sentence when the job lands.
