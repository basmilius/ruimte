# Windows

Windows 11 x64 runs but is not supported. Rick's [#64](https://github.com/basmilius/ruimte/pull/64) is the base: daemon and desktop app build, install and start, a terminal runs in Git Bash and `ruimte-context` reaches the daemon. The npm launcher refuses Windows (`packages/npm/src/launcher.ts`) until the list below is done. Release mechanics: [RELEASE.md](RELEASE.md), "Windows".

## Decisions

Do not reverse one without asking Bas.

- Git for Windows is required (2026-10-20, replacing PowerShell as default). The daemon finds `bash.exe` beside `git` on the PATH, then under Program Files and LocalAppData (`apps/server/src/pty/pty.ts`). Without it the app says so and names where to get it.
- Every line the daemon types runs in Git Bash: an agent's start, a resume with `||`, a long line through `eval`, a launch, an `exec` session. The daemon never quotes for a second dialect. Routines and launches stay in it too, since a team shares them across platforms (2026-10-30).
- What a person sees defaults to PowerShell, with a setting to override it (2026-10-30, not built yet). Windows ships 5.1, which has no `&&` or `||`, so nothing the daemon types relies on it.
- WSL: a terminal profile (`wsl.exe`) is fine. A project on `\\wsl$\` under a Windows daemon is not supported. Whoever works in WSL runs a Linux daemon there, as another machine, after the Windows version (2026-10-30).
- Status hooks keep the sh line from `agents/install.ts`, since Claude Code runs hooks in Git Bash. No `ruimte hook` subcommand until a CLI runs hooks outside a POSIX shell.
- An interrupt is Ctrl+C (`\x03` through ConPTY). Every other stop ends the tree with `taskkill /PID <pid> /T /F` (`apps/server/src/pty/bun-pty.ts`); chats do the same (`killProcessTree`, `@adecore/agents`).
- The background service is a per-user scheduled task, created without admin, that starts at logon and restarts after a crash, in the person's session (files, Credential Manager, CLI logins). Running with nobody logged on is a later opt-in. A Windows service was rejected: as LocalSystem every agent runs as SYSTEM, as the user it needs their password. A packaged app and `ruimte service install` register the task; the dev app runs the daemon as its child.
- A window has the system's title bar and no menu bar. The logo at the top of the sidebar opens the application menu, as in the web client (2026-10-30). macOS and Linux keep their windows.

## Done

Unit tested. "Unverified" means nobody tried it on a PC.

- PATH with `;` under the variable's existing name (`apps/server/src/env-path.ts`).
- A save never writes through a link (`fs/write.ts`). A rename never folds two hard links and handles a case-only change (`fs/rename.ts`). Detected launches write `/` paths (`launches/detect.ts`, `launches/vscode.ts`).
- `ruimte-context.exe` ships beside `ruimte.exe`: a Rust launcher (`apps/context-launcher`) that passes the words through untouched, so nothing re-reads `%` and `^`. `compile.ts` builds it with MSVC on Windows and MinGW elsewhere (`rustup target add x86_64-pc-windows-gnu`, `x86_64-w64-mingw32-gcc`). `apps/server/bin/ruimte-context.cmd` is for `bun dev` only and still re-reads them.
- Terminals start in Git Bash with `-l`; `shellName` drops `.exe`.
- Delete to the Recycle Bin (`apps/server/src/fs/trash.ts`, `fs/recycle-bin.ts`), unverified. No error dialogs. An item the bin would not take is refused, never deleted for good: a non-fixed drive, a bin that is off, an item larger than the bin, a linked folder. PowerShell ends after 30 seconds. The C# helper compiles once per version into `%LOCALAPPDATA%\Ruimte\recycle-bin`. Should the shell still mean to delete for good, `FOF_WANTNUKEWARNING` makes it ask on the PC, and with nobody there the time limit leaves the file. A file a refused rename replaced stays in its hidden `.ruimte-overwrite-*` folder.
- `bun run dev` goes through `apps/server/scripts/dev.ts` (Bun's Windows shell lacks `${VAR:-default}` and `HOME`).
- `win:` and `nsis:` in `apps/desktop/electron-builder.yml` build an unsigned installer and zip.
- `check:types`, `lint` and `format:check` pass.
- The background service, unverified: `taskSchedulerManager` (`@adecore/service`), wired in `packages/service/src/host.ts` as task `app.ruimte.daemon`, with `service\app.ruimte.daemon.xml` and `logs\daemon.log` under `%LOCALAPPDATA%\Ruimte`. The desktop app recognizes its own task by its `RUIMTE_HOME` (`apps/desktop/src/service/ownership.ts`). The task reruns every minute, so a daemon that ends for an update returns within a minute. `ruimte service install` copies `ruimte.exe` to `$RUIMTE_HOME\bin`, renaming a running one aside first.

- The process monitor and a session's ports (`apps/server/src/processes/windows.ts`), through `bun:ffi` as on macOS, since a process per reading is what costs on Windows. A reading takes 3 ms on the PC with 310 processes, also from a compiled executable. `NtQuerySystemInformation` gives the table and counters, a handle once per process gives the path and owner, and `GetExtendedTcpTable` the listeners. Memory is the private working set; disk counters include all of a process's I/O, as in Task Manager. Windows has no reparenting, so a parent that ended or whose pid was reused becomes pid 1, as on POSIX. An MSYS `exec` ends the Windows process it ran in, so a child that lost its parent hangs under the oldest process on its console, flat, which is the terminal's shell. Git for Windows's `bin\bash.exe` starts the real shell as its child; `childCounter` looks through that, so an idle Git Bash is no work.
- Interrupt and terminate in the process panel end the process at once. `process.kill` on Windows has no gentler signal, so `SIGINT` and `SIGTERM` do what `SIGKILL` does (exit code 1, confirmed on the PC).
- Keep awake (`apps/server/src/power/windows-keep-awake.ts`): `SetThreadExecutionState` on the daemon's own thread, so no process per agent turn and a killed daemon lets go by itself (confirmed with `powercfg /requests`). Windows has no adapter-only flag, so "Also on battery" off follows `GUID_ACDC_POWER_SOURCE` through `PowerSettingRegisterNotification`, never a clock. The closed-lid rule stays macOS only. It does not stop a sleep a person asks for: closing a lid with its action set to sleep, the power button or Start, Sleep.
- Copying files to the clipboard (`apps/desktop/src/file-clipboard.ts`), through a short-lived PowerShell (`Windows.Forms`). Electron writes named formats only: "CF_HDROP" becomes a stranger of that name, and `FileNameW` makes Windows derive a drop list for a single path. Tried on the PC in Electron 45. Copying several files needs the real format.

## Open, in blocking order

### 1. Repository and checks

On the PC, 2026-10-30: `check:types`, `lint` and `format:check` pass. `bun run test:windows` (8 workers) takes 2 minutes with 11485 pass and 0 fail, `bun run test:dom` 626 pass and 0 fail, and `bun run test:integration` 255 pass, 178 skip and 0 fail.

- `bun run test` uses a worker per core. With 16 it has timeouts in tests that run real git (`git/repos`, `canvas/worktree-verb`); with 8 it has none and the same tests pass alone, so load is the likely cause.
- `check:generated` fails: the floats in `apps/ios/Tests/Fixtures/document-scenes.json` differ in their last digits (`37.23045369887423` here, `37.230453698874236` on the PC), so the math libraries disagree. The check stays off on Windows.
- Skipped on Windows, and so proven only by hand or not at all:
  - PHP: Intelephense was removed. The own server finds a class created on disk on Windows, once it is built on `language-server-core` with the fix to `crates/server/src/paths.rs` (not yet released).
  - `sessions/terminal-stream`: ConPTY draws a screen, so a burst does not arrive whole.
  - `pty/bun-pty`, the resize in Git Bash: its `stty` reads no size from a ConPTY. A test of its own holds the resize in PowerShell.
  - `git/run`, the timeout that ends a background job, and `git/identity`, a fake `git` script. The hook tests in `git/actions` and `git/worktree-merge` do hold the process tree.
  - `sessions/shell-editor`, `shell-editor-review`, `background-cwd`, `shell-integration` and `prepare-terminal`: POSIX shells, with zsh among them.
  - `peering/one-shot-place`, `providers/acp-providers` (a fake CLI as a shell script) and `devices/helper-source` (Bun answers `EMFILE`). Apple's model and the launcher, which refuses Windows until the release.
  - Bun's watcher hears no edit through a junction, so a daemon on a linked ADE CORE may not restart for a source edit.
- `remote/connect-peer.test.ts` ("fails what is owed once the 7 days are over") failed once under load on the PC and once in 4 parallel runs on the Mac. It passes alone. The cause is not known.
- `unit (Windows)` in `ci.yml` runs on two workers and only with `WINDOWS_RELEASE` set to `true`, outside the final check, and may fail without failing the run. It stays off until everything works on the PC. `canvas/worktree-verb.test.ts` and `git/worktree-merge.test.ts` passed in the baseline, but did time out on the runner, leaving a folder Windows holds (`EBUSY`).
- On build 26300 an elevated process refuses a junction a non-elevated process made ("untrusted mount point"); a non-elevated process reads it fine, and a junction an elevated process made works for both. So run `bun install` on the PC over SSH: one from a person's PowerShell crashed every test in the elevated SSH session. Whether this reaches an elevated Ruimte, or other Windows builds, is not known.

### 2. Daemon start and stop

- Require Git for Windows at start with a clear message; `pty.ts` still falls back to `pwsh`, `powershell` and cmd.
- `POST /machine/shutdown` on the local secret stops a daemon the way a signal does. The shell asks for it on Windows before a quit or a restart ends a daemon, waits up to 10 seconds, and then ends it the hard way. Proven against a real daemon on the PC; the quit in the app and the scheduled task without elevation are not checked yet.
- Secrets (`auth/local-secret.ts`, `auth/auth-store.ts`, `secrets/secret-store.ts`, `endpoint-id.ts`, `agents/integrations.ts`) rely on mode bits Windows ignores. The profile ACL covers them; an explicit ACL is hardening, not a blocker.

### 3. Terminals

Done, to confirm on the PC:

- A session that types a line starts in `gitBash()` whatever shell was asked, and is refused with `git-bash-missing` without Git for Windows. A plain terminal keeps the PowerShell and cmd fallback; the app does not say so yet.
- The cwd tracker reads `/c/Users/x` as `C:\Users\x` (`windowsPathOfMsys`, `packages/contracts/src/terminal-cwd.ts`); `/usr` and `/tmp` stay unknown. Git Bash emits OSC 7 through `PROMPT_COMMAND` (`sessions/shell-integration.ts`), set before the person's startup files; a file that replaces `PROMPT_COMMAND` leaves the cwd unknown.
- `apps/client/src/terminal/drop-path.ts` types `'C:\x\y'` in single quotes, literal in PowerShell and Git Bash alike. cmd reads them as part of the path. Untried on the PC: a drop from the Explorer.
- `processes/foreground.ts` answers unknown on Windows without spawning `ps`.
- A new terminal opens in `personShell` (`pty/pty.ts`), set under Settings, Terminal, with PowerShell as default. Confirmed on the PC for PowerShell, Git Bash and cmd; WSL is untried. PowerShell reports its cwd through an encoded command that wraps the prompt, which an execution policy does not block.
- A line typed in Git Bash ends in `exec <person's shell>` (`handingBack`, `sessions/manager.ts`), except for WSL. Confirmed on the PC: an agent's `/exit` lands in PowerShell or cmd, and a resume after the shell ended works.
- A resume typed into a running PowerShell or cmd lets Git Bash run the line from a file (`typedResume`). The form was tried by hand in PowerShell; the app's route was not, nor the cmd form.

Open:

- The logo menu leaves out the rows only the shell can run (cut, copy, paste, full screen, quit, DevTools), which stay on their keys, and the start screen has no logo menu.
- Prepare in terminal needs the zsh editor channel ([TERMINAL-PREPARE.md](TERMINAL-PREPARE.md)), so no Windows terminal qualifies.
- MSYS rewrites a native program's argument that starts with `/`, so the daemon types a first prompt `/init` as `//init` (`startLine`), which arrives as `/init`. A prompt holding another `/` keeps both slashes, such as `//review src/foo.ts`, and reaches the CLI as a message instead of a command. `MSYS_NO_PATHCONV=1` would solve it but also reach the agent's own Bash tool, where conversion is wanted.

### 4. Agents

- `@adecore/agents` (`windows-command.ts`, since v0.29.2) resolves a bare name through PATHEXT and wraps `.cmd` in `cmd.exe`. Such a line holds no line break and stops near 8 KB, so a Claude chat's system prompt goes through a file on Windows (`chat/claude-system-prompt.ts`, unreleased).
- `agents/integrations.ts` expands `~` with `HOME`, then `USERPROFILE`; with both empty the path is still relative.

### 5. Paths from git and in the client

Done, unit tested with Windows paths, untried on the PC.

- Git's absolute paths go through `nativePath` (`apps/server/src/git/native-path.ts`) where they enter the daemon (`rev-parse --show-toplevel`, `--git-common-dir`, `--git-path`, `--absolute-git-dir`, `worktree list`, `check-ignore`) and compare with `resolve()` after. Checkout-relative paths (status, diff, blame) stay POSIX on the wire, as do a repository's `label` and a detected launch's `cwd` and `path`.
- `isPathBelow` (`packages/contracts/src/stored-path.ts`) takes either separator; `database/sql-analysis.ts`, the client's `database/console-file.ts` and `holdsUnder` in `language/host.ts` use it. The client handles paths through `shell/panels/files-tree.ts`.
- `projects/project-files.ts` and `fs/rename.ts` rename through `retryingRename` (`fs/busy-retry.ts`), retrying about a second on EPERM, EBUSY and EACCES. `writeAtomic` in `@adecore/agents` does not.

### 6. Packaging and the service

- Code signing, the npm placeholder and turning on `WINDOWS_RELEASE`.
- The site offers the installer once a release has one.
- An update replaces `resources\bin\ruimte.exe`, which Windows refuses while the task runs it. The installer stops the task first, or the task runs a copy outside the install folder as `ruimte service install` does.
- The npm launcher's refusal comes off last.

## Not on Windows

iOS devices and simulators, computer use, the Apple model and Speech to Text stay macOS only. Android devices are not enabled yet.

## Testing

Development stays on the Mac. The Windows 11 x64 PC is reachable over SSH (`Host winpc`, key `~/.ssh/winpc`, Git Bash, an elevated session), with Ruimte in `C:\dev\ruimte` and ADE CORE in `C:\dev\adecore`. An agent runs `bun install`, `bun run check` and the tests there. Its Bun is 1.4.4 against the pinned 1.4.2. SSH has no desktop, so a person at the PC tests anything with a window for now.

Confirmed on the PC, 2026-10-30, in a dev app started without elevation: `bash -l` stays in the requested folder, also with a space in its path; no console window appears for the daemon; a terminal opens in Git Bash; an agent started there reports status through the hooks; a Claude chat and a Codex chat answer. A `codex.cmd` chat keeps `100% "a&b" ^c` intact.

Open questions for the next PC session:

- In the app: the processes panel shows each terminal and chat with live CPU and memory, and a dev server's port appears on its terminal node, in PowerShell and in Git Bash (`npm run dev`). An idle Git Bash does not count as work when quitting.
- Copy one file, and several, from the file tree; paste each in the Explorer. They are copied, the originals stay, and pasting in a text field gives the paths. The first copy takes about a second.
- Keep awake "Always" with "Also on battery" and "Keep display on": `powercfg /requests` in an elevated prompt lists `bun.exe` or `ruimte.exe` under both SYSTEM and DISPLAY (an SSH session is in session 0, where Windows drops the display flag). The settings show no closed-lid row.
- On a laptop, with "Also on battery" off: under SYSTEM while plugged in, gone within seconds of unplugging, back when plugged in again. The PC has no battery, so only the first report of the source was seen.

- Deleting from the file tree. In each case the file stays unless it is in the Recycle Bin.
  - A file and a folder land in the bin and Restore puts them back. Time the first delete (it compiles the helper) and later ones. A `node_modules` folder finishes within 30 seconds.
  - A file open in another program (Excel) is refused within seconds with "Another program has the file open", without a dialog.
  - A mapped network drive or USB stick is refused. A SUBST drive is refused, or lands in the underlying drive's bin.
  - With "Don't move files to the Recycle Bin" on, a file is refused. With a 1 MB bin, 5 MB is refused and 100 KB lands.
  - A junction (`mklink /J linked C:\Elsewhere`) and a directory symlink (`mklink /D`) are refused, link and target untouched. A file symlink lands as the link.
  - A folder holding a junction to an outside folder lands in the bin; the outside folder keeps its contents.
  - An online-only OneDrive file lands in the bin.
  - The same from the daemon the scheduled task started.
  - Does the shell ever still ask to delete for good (`FOF_WANTNUKEWARNING`)? For what?
- What does a Codex chat do on a PC where Codex's sandbox setup never ran? The CLI asks for it in its TUI, which a chat does not have.
- Does the packaged app register the task without admin, start at logon and after a crash, and do "Stop the machine" and a restart onto a new build end the whole tree?
