# ruimte

Ruimte for a computer without the app. It runs the machine your terminals, agents and browsers live on. You reach it from the Ruimte app on another computer or from [station.ruimte.app](https://station.ruimte.app).

```sh
npx ruimte                      # start the machine on 127.0.0.1:4210
npx ruimte login                # add this machine to your Ruimte account with a code
npx ruimte status               # how the app on other devices reaches this machine
npx ruimte logout               # take this machine off its account
npx ruimte service install      # keep it running in the background for this user
npx ruimte service status
npx ruimte service uninstall
npx ruimte closed-lid install   # on a Mac: let keep awake hold with the lid closed
npx ruimte closed-lid remove
npx ruimte --version
```

`bunx ruimte` works too. Node is enough. It runs on Apple silicon Macs and on Linux (x64 and arm64), not on Windows yet.

## Reaching it

After `npx ruimte login`, the Ruimte app on any device signed in to your account lists the machine. On the same network or tailnet the app connects through the machine's door on port 4220 (its own port plus 10). `--lan-port` moves it and `--no-lan` closes it. From anywhere else the app goes through the broker. `npx ruimte status` says which routes are open.

## The background service

`ruimte service install` copies the binary to `~/.ruimte/bin` and runs that copy, never the one in the npx cache.

- macOS: a LaunchAgent at `~/Library/LaunchAgents/app.ruimte.daemon.plist`, logs in `~/Library/Logs/Ruimte/daemon.log`
- Linux: a systemd user unit at `~/.config/systemd/user/ruimte-daemon.service`, logs in `journalctl --user -u ruimte-daemon`

Flags after `install` are the flags the service runs with, such as `npx ruimte service install --no-lan`.

On Linux, systemd stops your services when you log out. To keep the machine running, enable lingering yourself (the command never does it for you):

```sh
loginctl enable-linger "$USER"
```

Run `npx ruimte@latest service install` again to update. A running machine switches to the new binary once no agent or shell is busy.

`RUIMTE_HOME` (default `~/.ruimte`) holds the machine's identity, the devices it let in and its projects.

## Awake with the lid closed

A closed Mac lid sleeps the machine even while keep awake holds, unless an external display and power are connected. Only root can change that, so you install one rule, once:

```sh
npx ruimte closed-lid install
```

It prints the rule before sudo asks for your password. The rule goes in `/etc/sudoers.d/ruimte-closed-lid-<uid>` and allows only `/usr/bin/pmset -a disablesleep 1` and `/usr/bin/pmset -a disablesleep 0` without a password. Then turn on "Also with the lid closed" under keep awake, on your phone or in the app on the Mac.

Sleep stays off only while keep awake holds: on power, or on battery at 20% or more when keep awake may hold there. It comes back when keep awake lets go, when the machine stops, and through a watchdog when the machine is killed. `npx ruimte closed-lid remove` turns sleep back on and removes the rule. Removing Ruimte leaves the rule in place, so remove it first.

## License

FSL-1.1-MIT. See `LICENSE`.
