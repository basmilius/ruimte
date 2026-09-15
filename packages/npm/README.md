# ruimte

Ruimte for a machine without the app. It runs the machine that terminals, agents and browsers live on, and you reach it from the Ruimte app on another computer or from [station.ruimte.app](https://station.ruimte.app).

```sh
npx ruimte                      # start the machine on 127.0.0.1:4210
npx ruimte pair                 # print a pairing link for the app on another computer
npx ruimte login                # add this machine to your Ruimte account with a code
npx ruimte service install      # keep it running in the background for this user
npx ruimte service status
npx ruimte service uninstall
npx ruimte --version
```

`bunx ruimte` works the same way. Node is enough; Bun does not have to be installed.

It runs on macOS and Linux, on arm64 and x64. Windows is not supported yet.

## The background service

`ruimte service install` copies the binary to `~/.ruimte/bin` and runs that copy, never the one in the npx cache. On macOS it is a LaunchAgent (`~/Library/LaunchAgents/app.ruimte.daemon.plist`, logs in `~/Library/Logs/Ruimte/daemon.log`); on Linux a systemd user unit (`~/.config/systemd/user/ruimte-daemon.service`, logs in `journalctl --user -u ruimte-daemon`). Flags after `install` are the flags the service runs with, such as `npx ruimte service install --host 0.0.0.0`.

On Linux, systemd stops a user's services when that user logs out. To keep the machine running while nobody is logged in, allow lingering yourself; the command never does it for you:

```sh
loginctl enable-linger "$USER"
```

Running `npx ruimte@latest service install` again installs the newer binary. A daemon that is running switches to it as soon as no agent or shell is busy on it.

`RUIMTE_HOME` (default `~/.ruimte`) is where the machine keeps its identity, pairings and projects.

## License

FSL-1.1-MIT. See `LICENSE`.
