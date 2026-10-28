# Prepare in terminal

The workspace host registers ADE CORE's `renderShellCodeBlock`. A completed top-level sh/bash/zsh fence in a finished main assistant reply can show a Prepare in terminal icon beside Copy. Both buttons sit over the top-right corner on hover or keyboard focus, on their own background, and stay visible on touch devices.

- Rendering and streaming make no requests and never write terminal input.
- The preview shows the full command, the owning machine and its cwd.
- Only an explicit confirmation fills a selected empty editor, and it never sends Enter.
- While open, the preview follows the project's terminal sessions, unmounted canvas terminals included. It shares existing renderer attachments without a new snapshot or consuming their buffered output, and never creates, resizes or writes to a session. Each holder lets go on close; the last one detaches, also while a remount is pending.
- After a confirmed insertion Ruimte opens the destination view or canvas, selects its terminal node and focuses the editor once the dialog closes. It checks session identity, machine and project again before navigating. A cancelled, refused, unconfirmed or stale destination gets no focus.

## Editor protocol

PTY output is never evidence of editor state. OSC 133, OSC 7, bracketed-paste markers and prompt text cannot authorize preparation or set the cwd of the preview or confirmation.

A new plain Ruimte zsh session gets a `.zshenv` shim under its Ruimte home. It restores the person's `ZDOTDIR`, sources their `.zshenv` and installs ZLE hooks at the first `precmd`. Startup files, options and prompts stay unchanged. The bootstrap and every hook isolate their options and turn off errexit, nounset and errreturn locally; a failing integration returns to the shell normally. A startup `read` has no editor channel.

The channel:

- The daemon creates a Unix socket per session (mode 0600) in a random mode-0700 temporary directory, with a random credential. The shell removes credential and socket address from its exported environment, and `RUIMTE_EDITOR_PERMITS` likewise.
- Each primary ZLE entry opens a new connection and authenticates with the credential, the shell's PID and private protocol version 2 (the hello frame's fourth field). An older integration cannot authorize an insertion.
- Leaving ZLE closes the descriptor, so a new editor cycle inherits no pending request or preview revision. Continuation editors and `vared` are excluded.
- A `zle -F -w` widget handles requests. Inspection answers the live `PWD` and whether `BUFFER`, pending terminal bytes, queued keys and the current decoder sequence (`KEYS`) are empty.
- A prepare checks again inside the widget: active primary ZLE, unexpired request, the exact approved cwd, empty buffer, no pending, queued or partly decoded input. It then claims the permit with the `zsh/files` builtin rename in the socket directory, sets `BUFFER` and `CURSOR` and redraws. Command bytes never pass through the PTY or reach a builtin `read`.

Permits and outcomes:

- Each prepare creates a mode-0600 permit before dispatch. The pending operation subscribes to `ShellPrompt.input()` through its AbortSignal, and input removes the permit synchronously before `Session.write()` reaches the PTY. Whichever comes first, that removal or the widget's rename, wins.
- A request expires after one second; the timeout revokes the permit and closes the channel. Reply or close removes permit and claim files. ZLE checks the deadline before changing anything, so a request stuck behind a blocking widget never applies later.
- Only the widget's `prepared` confirms an insertion and only `refused` confirms a refusal. A missing, malformed or lost reply, or a transport failure after dispatch, is unconfirmed, even after a cancel.
- The server answers `terminal-editor-refused` or `terminal-prepare-unconfirmed` in the existing error envelope, so no schema names them; the dialog has English and Dutch text for each. The consumed ticket and disabled button rule out a retry, so the person checks the terminal, since the command may be there.

`ShellEditorConnection.prepare(cwd, command, signal)` and `ShellPrompt.prepare()` resolve to a `ShellPrepareOutcome` (`'inserted'`, `'refused'`, `'unconfirmed'`); `ShellPrompt.prepare()` owns the AbortController.

This guards against terminal output and concurrent state changes. The person's shell configuration and their own processes stay trusted: it is no sandbox against code that rewrites the integration or reads its memory or files.

## Server validation and races

- The person-only action registry sends preview and confirmation to the endpoint and machine the chat captured, never falling back to the active or local endpoint.
- The source must be a closed top-level fence in the persisted, finished main reply: one visible line of at most 1,000 UTF-8 bytes, no control characters, no incomplete operators or heredocs. Syntax-only checks run for source and destination shells; the command never runs.
- The destination must be the same live plain session, attached to that client, in the chat's project, with no agent, launch or held command, a verified foreground state and a live editor cwd equal to the chat's cwd.
- A preview ticket expires after one minute and binds client, machine, source, project, cwd, session instance and editor/input revision.
- A confirmation consumes its ticket before its first await, then repeats the source, ownership, membership, attachment, expiry, foreground and revision checks. The last check and the dispatch share one synchronous turn, and the widget repeats buffer, cwd and editor checks at insertion.
- User input invalidates the preview at once and revokes an unclaimed insertion in flight, also after dispatch. ZLE checks input already in the tty or decoder. Input after the widget's permit claim is ordinary input; the widget processes no key between claim and buffer assignment.
- A terminal where someone typed and cleared, or that entered a new editor cycle, is eligible again after a fresh inspection; a redraw alone grants nothing. Concurrent confirmations cannot insert twice.

## Live cwd

`await session.shellPrompt.workingDirectory()` on the owning machine returns:

- `{ state: 'known', cwd, revision }`, a fresh observation from the primary ZLE editor after every prompt hook (a late `precmd` that calls `cd` included). A nonempty buffer still gives a cwd.
- `{ state: 'unknown' }` otherwise: unsupported shell, startup, command or builtin input, secondary editor, timeout, disconnect, exit, or input or connection replacement while pending.

There is no fallback to the launch directory or OSC. The cwd is what the shell said at reply time; ask at the moment of use and handle unknown. `snapshot()` is an internal preview observation, no cwd for file links, and authorizes nothing. A prepare always rechecks the cwd inside ZLE. File links use the cwd attached to their output instead (next section).

## File location links and shell cwd

`FileLocation` (`packages/contracts`) carries a path, an optional one-based line and column, and an optional inclusive end line. A range needs a start line and cannot run backward. `file.preview` also accepts the owning `endpointId`, checked before a tab opens, and still accepts the legacy nullable line.

The chat adapter passes ADE CORE's complete `FileRef` and the rendering `ChatScope.id` to `fileLinks.target` and `open`. Markdown links and timeline menus keep source cwd and scope, mentions and subagent threads included. A missing scope is refused; nothing guesses the active machine or project.

Terminal file links resolve a relative path only with cwd metadata attached to their output:

- The daemon and the browser share `trackTerminalCwd` from contracts (client: `output-cwd.ts`). It reads OSC 7 file URIs and keeps at most 128 transitions on xterm markers, through scrollback and reflow.
- Evicted context, malformed metadata, alternate output and ambiguous rewrites stay unknown. A cwd change inside a wrapped logical line invalidates that line.
- Without a known cwd a relative path is no link; an absolute one still is. The metadata authorizes no input and bypasses no preview sandbox.
- The integrated zsh emits its cwd on `preexec`, `precmd` and `chpwd`, synchronously to `/dev/tty`, so the markers stay in order when a command redirects stdout and stderr. Without a controlling terminal it emits nothing and leaves streams and status alone.
- Subshell hooks emit unknown context and ignore TTOU only for that write, so redirected background jobs finish under `tostop`. Signal handling, options and tty flags stay as they were, and ordinary background tty output still stops. After a `cd` in a subshell, relative links wait for a trusted foreground hook. Concurrent process output carries no per-process cwd.
- An OSC 777 footer keeps bounded context inside the snapshot string and its byte budget. A restored screen replays on its saved grid before reflow. Old snapshots and shells without the integration have no historical cwd. Changes inside external processes, or in shell code that bypasses the hooks (`cd -q`, output of an earlier custom `chpwd`), are invisible.

The output-cwd hooks share the isolated bootstrap and keep their incoming status. A cwd notification never acknowledges input readiness or bypasses the permit claim.

Run the cwd performance gate on its own, apart from the browser tests and typechecks; the unit suite does not run it:

```sh
bun --conditions=source apps/server/scripts/benchmark-output-cwd.ts \
    --warmup=1 --repetitions=3 --metadata=none,fixed,changing --enforce
```

Each case writes 50,000 rows after filling scrollback, in one burst or in 128-row chunks, and compares paired medians with absent, fixed and changing metadata. The budget is twice the plain parser time plus 150 ms. The script also checks the retained output and the cwd context.

## Limits and verification

- Only zsh terminals started with the integration qualify, so an existing session must be reopened. A sh, bash or zsh block works when its single line also passes zsh syntax checks.
- Bash with readline and other editors need an equivalent protocol; they never fall back to a PTY paste.
- Directory aliases compare as exact paths, so another spelling can leave no candidate.
- Excluded: quoted, nested and subagent fences, multiline commands, control characters and some conservative operator or heredoc cases.
- A profile that removes or replaces the ZLE hooks turns the integration off.
- Real-shell validation covers zsh on macOS. Linux and two physical machines are untried.

A browser test drives a fence from ADE CORE's real chat rendering through Ruimte's host and dispatcher into a real zsh editor. Real-shell regressions for each race are in `apps/server/src/sessions`.
