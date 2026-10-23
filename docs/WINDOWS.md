# Windows

Windows 11 x64 runs, but is not supported yet. The base is Rick's work from
[#64](https://github.com/basmilius/ruimte/pull/64): the daemon and the desktop app build, install and start
there, a terminal runs in Git Bash and ends cleanly, and `ruimte-context` reaches the daemon from inside it.
What is left is below. The npm launcher refuses Windows on purpose until this list is done
(`packages/npm/src/launcher.ts`).

## Decisions

Do not reverse one without asking Bas.

- **Git for Windows is required.** Ruimte needs `git` for its panels, worktrees and checkpoints anyway, and
  Git Bash gives the daemon one shell dialect on every platform. The daemon finds `bash.exe` beside the
  `git` on the PATH, then under Program Files and LocalAppData (`apps/server/src/pty/pty.ts`). Without it
  the app says so and names where to get it, instead of falling back without a word. Taken on 2026-10-20,
  replacing the earlier choice of PowerShell as the default shell.
- **Every line the daemon types runs in bash.** An agent's start, a resume with `||`, a long line through
  `eval`, a launch and an `exec` session are POSIX and go to Git Bash, so the daemon never quotes for a
  second dialect. A person's own shell (`pwsh`, cmd) is fine for a plain terminal that starts nothing.
- **Status hooks keep the sh line.** Claude Code runs its hooks in Git Bash on Windows, so the line
  `agents/install.ts` writes works unchanged. The `ruimte hook` subcommand from the earlier plan is dropped
  until a CLI turns out to run hooks outside a POSIX shell.
- **Stopping.** An interrupt is Ctrl+C on the console (`\x03` through ConPTY). Every other stop takes the
  whole tree with `taskkill /PID <pid> /T /F` (`apps/server/src/pty/bun-pty.ts`), since SIGHUP, SIGTERM and
  `kill(-pid)` do not exist there. Chats already stop that way in `@adecore/agents` (`killProcessTree`).
- **Background service.** A scheduled task per user that starts at logon and restarts after a crash,
  created without admin. It runs in the person's session, so their files, Credential Manager and CLI logins
  are there. Running while nobody is logged on is a later opt-in, the counterpart of `loginctl
  enable-linger` on Linux. A Windows service was weighed and rejected: as LocalSystem it would run every
  agent as SYSTEM, and as the user it needs their password. A packaged app and `ruimte service install`
  register the task; the dev app runs the daemon as its child, as on the other platforms.

## Done

- PATH with `;` and under the name the variable already has (`apps/server/src/env-path.ts`), in terminals
  and chats.
- A save never writes through a link (no `O_NOFOLLOW` there, so `fs/write.ts` looks at the name first), a
  rename never folds two hard links of one file and takes a case-only change of a name (`fs/rename.ts`),
  and a detected launch writes its paths with `/` (`launches/detect.ts`, `launches/vscode.ts`).
- `ruimte-context` finds `ruimte.exe`, and `ruimte-context.cmd` ships beside it for cmd and PowerShell.
- Terminals start in Git Bash with `-l`; `shellName` drops `.exe`, so `plainShell` applies.
- Ending a session, as in the stopping decision.
- Deleting to the Recycle Bin (`apps/server/src/fs/trash.ts`, the script in `fs/recycle-bin.ts`). The
  shell is called with no error dialogs and the item is refused, not deleted for good, when the Recycle Bin
  would not take it: a drive that is not fixed, a bin that is off, an item larger than the bin, or a linked
  folder. PowerShell is ended after 30 seconds. The C# helper behind it is compiled once per version into
  `%LOCALAPPDATA%\Ruimte\recycle-bin`; an integration test compiles it as C# 5 wherever `pwsh` is. Should
  the shell still mean to delete for good, `FOF_WANTNUKEWARNING` makes it ask on the PC's own screen,
  whoever deleted; with nobody there the time limit leaves the file. A file replaced by a rename that the
  bin refuses stays in its hidden `.ruimte-overwrite-*` folder, as on another volume on macOS and Linux.
  Unit tested through an injected spawner; unverified on a PC.
- `bun run dev` through `apps/server/scripts/dev.ts`, since Bun's shell on Windows has no `${VAR:-default}`
  and no `HOME`.
- `win:` and `nsis:` in `apps/desktop/electron-builder.yml`: an installer and a zip, unsigned.
- `bun run check:types`, `lint` and `format:check` pass on Windows.
- The background service as decided: `taskSchedulerManager` in `@adecore/service`, wired in
  `packages/service/src/host.ts` with the task `app.ruimte.daemon`, its definition and log under
  `%LOCALAPPDATA%\Ruimte` (`service\app.ruimte.daemon.xml`, `logs\daemon.log`). The desktop app treats a
  packaged Windows build as supported and recognizes its own task by the `RUIMTE_HOME` in it
  (`apps/desktop/src/service/ownership.ts`). The task runs again every minute, so a daemon that ends for an
  update is back within a minute. `ruimte service install` copies `ruimte.exe` to `$RUIMTE_HOME\bin` and
  renames a running one out of the way first. Unit tested only; unverified on a PC.

## Open, in the order they block

### 1. Repository and checks

- `.gitattributes` holds every text file at LF, `.cmd` and `.bat` at CRLF. With `core.autocrlf` on, a
  checked-out fixture reads CRLF and tests fail.
- Integration tests still assume `/bin/sh` and POSIX paths. The unit tests pass on Windows: `unit
  (Windows)` in `ci.yml` runs on two workers, since four files starting git processes at once pushed tests
  past Bun's five seconds on that runner. Until Windows ships it only runs once the repository variable
  `WINDOWS_RELEASE` is `true`, stays out of the final check and may fail without failing the run: the
  worktree tests (`canvas/worktree-verb.test.ts`, `git/worktree-merge.test.ts`) still time out there now
  and then and leave a temporary folder Windows holds on to (`EBUSY`).

### 2. The daemon starts and stops

- The shell requires Git for Windows, as decided: a check at start and a clear message, where `pty.ts` now
  falls back to `pwsh`, `powershell` and cmd.
- `apps/server/src/daemon.ts:327` waits for SIGINT or SIGTERM. Windows never sends SIGTERM, and
  `apps/desktop/src/main/service.ts:227` `kill('SIGTERM')` is a hard stop, so nothing is flushed. The shell
  needs another way to ask for a shutdown (a request over the loopback API, then a hard stop after a
  timeout).
- The desktop app spawns the daemon without `windowsHide`. Unverified whether a console window appears.
- Secrets (`auth/local-secret.ts`, `auth/auth-store.ts`, `secrets/secret-store.ts`, `endpoint-id.ts`,
  `agents/integrations.ts`) rely on mode bits that Windows ignores. The profile ACL covers them for now; an
  explicit ACL is a hardening step, not a blocker.

### 3. Terminals

Done, to be confirmed on the PC:

- **Git Bash for every typed line.** On Windows a session that types a line (a command, held or not, an
  agent's start, a launch) starts in `gitBash()` (`apps/server/src/pty/pty.ts`) whatever shell was asked
  for, and is refused with `git-bash-missing` when Git for Windows is not there. A plain terminal keeps
  the fallback to PowerShell and cmd. The app does not say so yet.
- **Git Bash paths.** On a Windows machine the cwd tracker on the daemon and in the client reads
  `/c/Users/x` as `C:\Users\x` (`windowsPathOfMsys`, `packages/contracts/src/terminal-cwd.ts`); a path
  off any drive (`/usr`, `/tmp`) stays unknown. A plain Git Bash terminal emits OSC 7 at every prompt
  through an exported function and `PROMPT_COMMAND` (`sessions/shell-integration.ts`), set before the
  person's startup files run: a file that adds to `PROMPT_COMMAND` keeps both, one that replaces it leaves
  the cwd unknown. `sessions/shell-prompt.ts` is unchanged: its cwd comes only from the zsh editor channel.
- **Dropped paths.** `apps/client/src/terminal/drop-path.ts` types `C:\x\y` as `/c/x/y` in POSIX single
  quotes. The client does not know a session's shell and assumes Git Bash.
- **Foreground.** `processes/foreground.ts` answers unknown on Windows without spawning `ps`. A resume
  and a launch's stop go on as they do when `ps` cannot say.

Open:

- **Preparing a command line.** `prepare-terminal.ts` needs an empty prompt from the zsh editor channel,
  which bash cannot offer (no way to insert into its line from outside while it waits), so no terminal on
  Windows is a target, as with bash on Linux. The foreground check is not what blocks it.
- **Path conversion.** MSYS rewrites an argument that starts with `/` when bash calls a native program, so
  an agent's first prompt such as `/init` would reach the CLI as `C:/Program Files/Git/init`.
  `MSYS_NO_PATHCONV=1` on the session would fix that line but also reach the agent's own Bash tool, where
  the conversion is wanted; not set until that trade-off is decided.
- **Resume in a person's shell.** `session.resume` types its line into the shell the session has; a
  terminal a person opened in PowerShell or cmd gets a POSIX line there.

### 4. Agents

- **Spawning CLIs.** `@adecore/agents` `chat/chat-process.ts` and `providers/launch.ts` spawn `claude` and
  `codex` by bare name. The native `claude.exe` resolves; npm's `codex.cmd` needs a shell, so a Codex chat
  cannot start. In a terminal it works.
- `agents/integrations.ts` expands `~` with `env.HOME ?? ''`, which is relative on Windows.

### 5. Paths from git and in the client

Done, covered by unit tests with Windows paths; not yet tried on the PC.

- A path git prints goes through `nativePath` (`apps/server/src/git/native-path.ts`) where it enters the
  daemon: `rev-parse --show-toplevel`, `--git-common-dir`, `--git-path`, `--absolute-git-dir`,
  `worktree list` and `check-ignore`. The status watcher, the repositories, checkpoints, worktrees and
  provenance compare it with `resolve()` from then on. Paths git prints relative to its checkout (status,
  diff, blame) stay POSIX on the wire.
- A repository's `label` and a detected launch's `cwd` and `path` are POSIX, as a project file holds them.
- `isPathBelow` in `packages/contracts/src/stored-path.ts` takes either separator; the console folders of
  `database/sql-analysis.ts` and the client's `database/console-file.ts`, and `holdsUnder` in
  `language/host.ts` use it.
- The client joins with `absoluteOf`, splits with `basenameOf` and `dirnameOf`, and tests with
  `isAbsolutePath`, `isPathBelow` and `relativeTo`, all through `shell/panels/files-tree.ts`.
- `projects/project-files.ts` and `fs/rename.ts` rename through `retryingRename` (`fs/busy-retry.ts`), which
  tries again for about a second on win32 while another process holds the file (EPERM, EBUSY, EACCES).
  `writeAtomic` of `@adecore/agents` renames without it.

### 6. Packaging and the service

- The release pipeline builds Windows behind the repository variable `WINDOWS_RELEASE`: the installer,
  `latest.yml` and the zip in `release.yml`, `@ruimte/win32-x64` in `npm.yml`, `/download/windows` on the
  site (`docs/RELEASE.md`, "Windows"). Open: code signing, publishing the npm placeholder, and turning
  the variable on.
- The site detects Windows and offers the installer once a release has one.
- An app update replaces `resources\bin\ruimte.exe`, which Windows refuses while the scheduled task runs
  it. The installer either has to stop the task first or the task has to run a copy outside the install
  folder, as `ruimte service install` does.
- The npm launcher's refusal comes off last.

## Not on Windows

iOS devices and simulators, computer use, the Apple model and Speech to Text stay macOS only. Android
devices are not enabled yet.

## Testing

Development stays on the Mac. A Windows 11 x64 PC is reached over SSH (`Host winpc`, key `~/.ssh/winpc`)
with PowerShell 7 as its shell, and an agent runs `bun install`, `bun run check` and the tests there per
step. A process started over SSH has no desktop, so the desktop app and anything with a window are tested
by a person at the PC.

Open questions for the next test at the PC:

- Does `bash -l` start in the folder the session asked for, or does Git Bash's profile move it to `$HOME`?
- Does a console window appear beside the desktop app when it starts the daemon?
- Deleting from the file tree (`fs/recycle-bin.ts`), each with the file still there afterwards unless it
  is in the Recycle Bin:
  - A file and a folder land in the Recycle Bin and Restore puts them back. How long does the first delete
    take, which compiles the helper, and how long the ones after? A `node_modules` folder finishes within
    30 seconds.
  - A file another program holds open (an open Excel workbook) is refused within seconds with "Another
    program has the file open", and no dialog appears.
  - A file on a mapped network drive and on a USB stick is refused. On a SUBST drive it is refused, or lands
    in the bin of the drive under it if the daemon resolved the path there first.
  - With "Don't move files to the Recycle Bin" on for the drive, a file is refused. With a custom size of
    1 MB, a 5 MB file is refused and a 100 KB file lands in the bin.
  - A junction (`mklink /J linked C:\Elsewhere`) and a directory symbolic link (`mklink /D`) are refused,
    and both the link and `C:\Elsewhere` stay as they were. A symbolic link to a file lands in the bin as
    the link, its target untouched.
  - A folder that holds a junction to a folder outside it lands in the bin, and the folder the junction
    points to keeps everything in it.
  - A file in a OneDrive folder whose content is only online lands in the bin.
  - The same from the daemon the scheduled task started.
  - Does the shell ever still ask to delete for good (`FOF_WANTNUKEWARNING`)? If so, for what.
- Does an agent started from a terminal report its status through the hooks?
- Does the packaged app register the scheduled task without admin, does it start at logon and after a
  crash, and do "Stop the machine" and a restart onto a new build end the whole tree?
