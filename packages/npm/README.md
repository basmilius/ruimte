# ruimte

Ruimte for a computer without the app. It runs the machine your terminals, agents and browsers live on, and you reach it from the Ruimte app on another computer or from [station.ruimte.app](https://station.ruimte.app).

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

`bunx ruimte` works the same way. Node is enough; Bun does not have to be installed.

It runs on macOS and Linux, on arm64 and x64. Windows is not supported yet.

## Reaching it

`npx ruimte login` puts the machine on your Ruimte account; the Ruimte app on any device signed in to that account then lists it. On the same network or tailnet, the app connects to it directly through the door the machine keeps open on port 4220 (its own port plus 10; `--lan-port` moves it and `--no-lan` closes it). From anywhere else it connects through the broker. `npx ruimte status` says which of those are open.

## The background service

`ruimte service install` copies the binary to `~/.ruimte/bin` and runs that copy, never the one in the npx cache. On macOS it is a LaunchAgent (`~/Library/LaunchAgents/app.ruimte.daemon.plist`, logs in `~/Library/Logs/Ruimte/daemon.log`); on Linux a systemd user unit (`~/.config/systemd/user/ruimte-daemon.service`, logs in `journalctl --user -u ruimte-daemon`). Flags after `install` are the flags the service runs with, such as `npx ruimte service install --no-lan`.

On Linux, systemd stops a user's services when that user logs out. To keep the machine running while nobody is logged in, allow lingering yourself; the command never does it for you:

```sh
loginctl enable-linger "$USER"
```

Running `npx ruimte@latest service install` again installs the newer binary. A running machine switches to it as soon as no agent or shell is busy on it.

`RUIMTE_HOME` (default `~/.ruimte`) is where the machine keeps its identity, the devices it let in and its projects.

## Awake with the lid closed

Keep awake keeps a Mac from sleeping while agents work, but a closed lid still sleeps it unless an external display and the power adapter are connected. Only root can turn that off, so you install one rule, once:

```sh
npx ruimte closed-lid install
```

It prints the rule before sudo asks for your password. The rule goes in `/etc/sudoers.d/ruimte-closed-lid-<uid>` and lets you run `/usr/bin/pmset -a disablesleep 1` and `/usr/bin/pmset -a disablesleep 0` without a password, and nothing else. Then turn on "Also with the lid closed" under keep awake, from Ruimte on your phone or in the app on the Mac.

Sleep stays off only while keep awake holds: on the power adapter, or on battery when keep awake may hold there and the battery is at 20% or more. It comes back on when keep awake lets go, when the machine stops, and through a small watchdog when the machine is killed. `npx ruimte status` says whether keep awake and the closed lid hold right now. `npx ruimte closed-lid remove` turns sleep back on and removes the rule. Removing Ruimte leaves the rule in place, so remove it first.

## License

FSL-1.1-MIT. See `LICENSE`.
