# Prepare in terminal

The workspace host registers ADE CORE's `renderShellCodeBlock` callback. A completed top-level sh/bash/zsh fence in a finished main assistant reply can show a **Prepare in terminal** icon beside Copy. Both buttons sit over the top-right corner on hover or keyboard focus, on a background of their own; on a touch device they stay visible. Rendering and streaming make no requests and never write terminal input. The preview shows the full command, the machine that owns it and its cwd. Only an explicit confirmation fills a selected empty editor, and it sends no Enter.

While the preview is open, it follows the existing terminal sessions in the current project, canvas terminals whose bodies unmounted after a view switch included. It shares existing renderer attachments without asking for another snapshot or consuming their buffered output. These attachments never create a session, resize one or write input. Each holder lets go when it closes, and the last one detaches, also while a remount is still pending.

After a confirmed insertion, Ruimte opens the destination view or canvas, selects its terminal node and focuses the editor once the dialog closes. A cancelled, refused, unconfirmed or stale destination gets no focus. Ruimte checks the session identity, machine and project again before it navigates.

## ADE CORE dependency

`prepare-code-block.ts` imports `ShellCodeBlockContext` from `@adecore/agents-react/host`. `workspace-host.ts` connects the callback, which was published in [ADE CORE 0.20.1](https://github.com/basmilius/adecore/releases/tag/v0.20.1). Ruimte pins that version in its manifests and lockfile.

The generated Swift artifacts include the combined Ruimte contracts and the current ADE CORE vocabulary. `TERMINAL-PREPARE-CHECKS.txt` separates the final npm consumer checks from historical isolated and linked-source validation.

## Editor protocol

PTY output is never evidence of editor state. OSC 133, OSC 7, bracketed-paste markers and prompt text cannot authorize preparation or establish the cwd used by its preview and confirmation.

A new plain Ruimte zsh session gets a `.zshenv` shim under its Ruimte home. The shim restores the person's `ZDOTDIR`, sources their original `.zshenv` and installs ZLE hooks at the first `precmd`. It leaves startup files, shell options and prompt strings unchanged. The bootstrap and every integration hook isolate their options and turn off errexit, nounset and errreturn locally. A failing integration returns to the shell as normal. A startup `read` has no editor channel.

The daemon creates a Unix socket per session in a random mode-0700 temporary directory, with a mode-0600 socket and a random credential. The shell removes the credential and socket address from its exported environment. Each primary ZLE entry opens a new connection and authenticates with the credential, the spawned shell's PID and private protocol version 2. An older integration cannot authorize an insertion. Leaving ZLE closes the descriptor, so a new editor cycle cannot inherit a pending request or preview revision. Continuation editors and `vared` are excluded.

A `zle -F -w` widget handles requests on this separate descriptor. It answers inspection with the live `PWD` and whether `BUFFER`, pending terminal bytes, queued keys and the current decoder sequence (`KEYS`) are empty. On a prepare it checks again, inside the widget invocation itself: an active primary ZLE, an unexpired request, the exact approved cwd, an empty buffer and no pending, queued or partly decoded input. It then claims the request's permit with the `zsh/files` builtin rename in the same private socket directory, sets `BUFFER` and `CURSOR` and redraws. Command bytes never pass through the PTY or reach a builtin `read`.

Each prepare creates a mode-0600 permit before dispatch. The pending operation stays subscribed to `ShellPrompt.input()` through its AbortSignal, and input removes that permit synchronously before the existing Session write reaches the PTY. Whichever comes first, that removal or the editor's rename, wins. A request expires after one second; the timeout revokes the permit and closes the channel. Cleanup on reply or close removes the permit and claim files. ZLE checks the deadline before it changes anything, so a request waiting behind a blocking widget cannot apply later. Only the widget's `prepared` acknowledgement confirms an insertion, and only `refused` confirms an editor refusal. A missing, malformed or lost reply is unconfirmed, even if cancellation was requested, and so is a transport failure after dispatch. The server answers with the `terminal-editor-refused` and `terminal-prepare-unconfirmed` error codes, and the dialog has its own English and Dutch text for each. The consumed ticket and the disabled dialog button rule out a retry. The person has to look at the terminal, since the command may already be there.

This boundary protects against terminal output and concurrent state changes. The person's own shell configuration and the processes running under their OS account stay trusted: this is no sandbox against malicious code that rewrites the integration or reads its private memory or files.

## Server validation and races

The person-only action registry sends the preview and the confirmation to the endpoint and machine identity the chat captured, never falling back to the active or local endpoint. The server checks the source against a closed top-level fence in the persisted, finished main reply. It accepts one visible line of at most 1,000 UTF-8 bytes, rejects control characters and incomplete operators or heredocs, and runs syntax-only checks for the source and destination shells without running the command.

A candidate must be the same live plain session, attached to that client, in the chat's project, with no agent, launch or held command. Its foreground state must be verified and its live editor cwd must match the chat's cwd. A preview ticket expires after one minute and binds the client, machine, source, project, cwd, session instance and editor/input revision.

A confirmation consumes its ticket before its first await, then repeats the source, ownership, membership, attachment, expiry, foreground and revision checks. The last server validation and the editor-channel dispatch share one synchronous turn. The widget repeats the buffer, cwd and editor checks at insertion. User input invalidates the preview at once and revokes any unclaimed insertion in flight, also after dispatch. ZLE checks input that is already inside the tty or decoder. The insertion boundary is the widget's successful permit claim: input that arrives after it is ordinary input that follows. The widget runs the claim and the buffer assignment without processing a key in between. A terminal where someone typed and cleared, or that entered a new editor cycle, is eligible again after a fresh inspection, so a used terminal is not disabled for good. Concurrent confirmations cannot insert twice.

## Live cwd observation

Live editor consumers can call `await session.shellPrompt.workingDirectory()` on the owning machine:

- `{ state: 'known', cwd, revision }` is a fresh observation from the primary ZLE editor, after every prompt hook, a late `precmd` that calls `cd` included. A nonempty edit buffer still gives a cwd.
- `{ state: 'unknown' }` means no valid current observation: unsupported shell, startup, command/builtin input, secondary editor, timeout, disconnect, exit, or input/connection replacement while the request was pending.

There is no fallback to the launch directory or to OSC. The cwd is what the shell said at reply time, not a promise about what it runs next. A consumer must ask for it at the moment it uses it and handle unknown explicitly. `snapshot()` is an internal preview observation only: it is no reliable cwd for file links and authorizes no insertion. A prepare always checks the cwd again inside ZLE.

Historical file links use the cwd attached to their output, not this live observation. The shared tracker and snapshot metadata are described in [ADECORE-DEVELOPMENT.md](ADECORE-DEVELOPMENT.md#file-location-links-and-shell-cwd).

## Limits and verification

Only zsh terminals started with the integration are eligible destinations, so an existing session has to be reopened. An sh, bash or zsh code block works when its single line also passes zsh syntax validation. Bash with readline and other editors need an equivalent editor protocol; they never fall back to a plain PTY paste. Directory aliases are compared as exact paths, so a different spelling can leave no candidate. Quoted, nested and subagent fences, multiline commands, control characters and some conservative literal operator or heredoc cases are excluded.

Real-shell validation covers zsh on macOS. Nobody has tried Linux or a connection between two physical machines yet. A profile that removes or replaces the ZLE hooks can turn the integration off. A used terminal becomes eligible again once its editor is really empty; a redraw alone grants nothing.

The browser test renders ADE CORE's real `AssistantRow`/Markdown through Ruimte's real workspace host, person action registry, request schemas and dispatcher into a real zsh editor. It checks completed/streaming/incomplete blocks, simulated remote ownership despite a local active endpoint, the complete preview, late busy/input changes, and no execution after preparation. Separate real-shell regressions cover forged OSC plus startup read, prefilled line-init buffers, late cwd changes, invisible-to-daemon buffer/cwd races, blocked-widget expiry, editor cycling, secondary editors, and concurrent confirmations. Further regressions cover option preservation in both startup files, delayed-frame races for partial decoding and typing/clearing, cancellation cleanup, and lost-acknowledgement dialog tests in English and Dutch. `TERMINAL-PREPARE-CHECKS.txt` records isolated and combined integration checks separately.

## Cwd integration

`workingDirectory()` and its known/unknown observation contract are unchanged. OSC stays navigation metadata with no say over insertion. `Session.write()` still calls `ShellPrompt.input()` before touching the PTY.

`ShellEditorConnection.prepare(cwd, command, signal)` now returns `Promise<ShellPrepareOutcome>`; `ShellPrepareOutcome` is `'inserted' | 'refused' | 'unconfirmed'`. `ShellPrompt.prepare()` returns that same outcome and owns the pending AbortController. The Unix request frame is unchanged, but the hello frame has a required fourth field `2`, and the environment supplies `RUIMTE_EDITOR_PERMITS`, which the bootstrap removes from the exported shell variables. The existing error envelope carries the two new error codes, so no public request or result schema and no generated wire code changed.

The output-cwd hooks share the isolated bootstrap and preserve their incoming status while isolating shell options. Cwd notifications never acknowledge input readiness or bypass the editor's permit claim. Combined real-shell/browser tests cover historical file navigation and clear/resync with strict options in both startup files, alongside the editor race and acknowledgement regressions.
