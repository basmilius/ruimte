# Windows

Windows 11 x64 runs but is not supported. Rick's [#64](https://github.com/basmilius/ruimte/pull/64) is the base: daemon and desktop app build, install and start, a terminal runs in Git Bash and `ruimte-context` reaches the daemon. The npm launcher refuses Windows (`packages/npm/src/launcher.ts`) until the list below is done. Release mechanics: [RELEASE.md](RELEASE.md), "Windows".

## Decisions

Do not reverse one without asking Bas.

- Git for Windows is required (2026-10-20, replacing PowerShell as default). The daemon finds `bash.exe` beside `git` on the PATH, then under Program Files and LocalAppData (`apps/server/src/pty/pty.ts`). Without it the app says so and names where to get it.
- Every line the daemon types runs in Git Bash: an agent's start, a resume with `||`, a long line through `eval`, a launch, an `exec` session. The daemon never quotes for a second dialect. A plain terminal that starts nothing may use `pwsh` or cmd.
- Status hooks keep the sh line from `agents/install.ts`, since Claude Code runs hooks in Git Bash. No `ruimte hook` subcommand until a CLI runs hooks outside a POSIX shell.
- An interrupt is Ctrl+C (`\x03` through ConPTY). Every other stop ends the tree with `taskkill /PID <pid> /T /F` (`apps/server/src/pty/bun-pty.ts`); chats do the same (`killProcessTree`, `@adecore/agents`).
- The background service is a per-user scheduled task, created without admin, that starts at logon and restarts after a crash, in the person's session (files, Credential Manager, CLI logins). Running with nobody logged on is a later opt-in. A Windows service was rejected: as LocalSystem every agent runs as SYSTEM, as the user it needs their password. A packaged app and `ruimte service install` register the task; the dev app runs the daemon as its child.

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

## Open, in blocking order

### 1. Repository and checks

- `.gitattributes` must hold text at LF and `.cmd`/`.bat` at CRLF; with `core.autocrlf` on, fixtures read CRLF and tests fail.
- Integration tests assume `/bin/sh` and POSIX paths.
- `unit (Windows)` in `ci.yml` runs on two workers and only with `WINDOWS_RELEASE` set to `true`, outside the final check, and may fail without failing the run. `canvas/worktree-verb.test.ts` and `git/worktree-merge.test.ts` still time out at times and leave a folder Windows holds (`EBUSY`).

### 2. Daemon start and stop

- Require Git for Windows at start with a clear message; `pty.ts` still falls back to `pwsh`, `powershell` and cmd.
- `apps/server/src/daemon.ts` shuts down on SIGINT or SIGTERM, which Windows never sends, and `killDaemon` in `apps/desktop/src/main/service.ts` is a hard stop that flushes nothing. Needed: a shutdown request over the loopback API, then a hard stop after a timeout.
- Secrets (`auth/local-secret.ts`, `auth/auth-store.ts`, `secrets/secret-store.ts`, `endpoint-id.ts`, `agents/integrations.ts`) rely on mode bits Windows ignores. The profile ACL covers them; an explicit ACL is hardening, not a blocker.

### 3. Terminals

Done, to confirm on the PC:

- A session that types a line starts in `gitBash()` whatever shell was asked, and is refused with `git-bash-missing` without Git for Windows. A plain terminal keeps the PowerShell and cmd fallback; the app does not say so yet.
- The cwd tracker reads `/c/Users/x` as `C:\Users\x` (`windowsPathOfMsys`, `packages/contracts/src/terminal-cwd.ts`); `/usr` and `/tmp` stay unknown. Git Bash emits OSC 7 through `PROMPT_COMMAND` (`sessions/shell-integration.ts`), set before the person's startup files; a file that replaces `PROMPT_COMMAND` leaves the cwd unknown.
- `apps/client/src/terminal/drop-path.ts` types `C:\x\y` as `/c/x/y` in single quotes, assuming Git Bash.
- `processes/foreground.ts` answers unknown on Windows without spawning `ps`.

Open:

- Prepare in terminal needs the zsh editor channel ([TERMINAL-PREPARE.md](TERMINAL-PREPARE.md)), so no Windows terminal qualifies.
- MSYS rewrites a native program's argument that starts with `/`, so a first prompt `/init` reaches the CLI as `C:/Program Files/Git/init`. `MSYS_NO_PATHCONV=1` would also reach the agent's own Bash tool, where conversion is wanted. Undecided.
- `session.resume` types a POSIX line into whatever shell the session has, PowerShell or cmd included.

### 4. Agents

- `@adecore/agents` (`chat/chat-process.ts`, `providers/launch.ts`) spawns `claude` and `codex` by bare name. npm's `codex.cmd` needs a shell, so a Codex chat cannot start; in a terminal it works.
- `agents/integrations.ts` expands `~` with `env.HOME ?? ''`, relative on Windows.

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

Development stays on the Mac. The Windows 11 x64 PC is reachable over SSH (`Host winpc`, key `~/.ssh/winpc`, PowerShell 7). An agent runs `bun install`, `bun run check` and the tests there. SSH has no desktop, so a person at the PC tests anything with a window.

Open questions for the next PC session:

- Does `bash -l` start in the requested folder, or does Git Bash's profile move it to `$HOME`?
- Does a console window appear when the desktop app starts the daemon (it spawns with `windowsHide: true`)?
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
- Does an agent started from a terminal report status through the hooks?
- Does the packaged app register the task without admin, start at logon and after a crash, and do "Stop the machine" and a restart onto a new build end the whole tree?
