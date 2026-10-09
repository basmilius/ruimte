# Prepare in terminal

The workspace host registers ADE CORE's `renderShellCodeBlock` callback. A completed top-level sh/bash/zsh fence in a finished main assistant reply can show the **Prepare in terminal** icon beside Copy. Both sit over the top-right corner on hover or keyboard focus, with a background under the buttons. Touch devices keep the buttons visible. Rendering and streaming make no requests and never write terminal input. The preview shows the full command, its owning machine and cwd. Only an explicit confirmation fills a selected empty editor; it sends no Enter.

Opening the preview temporarily follows existing terminal sessions in the current project, including canvas terminals whose bodies are unmounted after a view switch. Existing renderer attachments are shared without requesting another snapshot or consuming their buffered output. These attachments do not create sessions, resize them or write input. Each holder releases its ownership when it closes; the last holder detaches, including while a remount is still pending.

After confirmed insertion, Ruimte opens the destination view or canvas, selects its terminal node and focuses the editor after the dialog closes. Cancelled, refused, unconfirmed or stale destinations do not receive focus. Session identity, machine and project are checked again before navigation.

## ADE CORE dependency

`prepare-code-block.ts` imports `ShellCodeBlockContext` from `@adecore/agents-react/host`. The callback is connected in `workspace-host.ts` and published in [ADE CORE 0.20.1](https://github.com/basmilius/adecore/releases/tag/v0.20.1). Ruimte pins that version in its manifests and lockfile.

The generated Swift artifacts include the combined Ruimte contracts and the current ADE CORE vocabulary. `TERMINAL-PREPARE-CHECKS.txt` separates the final npm consumer checks from historical isolated and linked-source validation.

## Editor protocol

PTY output is never evidence of editor state. OSC 133, OSC 7, bracketed-paste markers and prompt text cannot authorize preparation or establish the cwd used by its preview and confirmation.

A new plain Ruimte zsh session receives a `.zshenv` shim under its Ruimte home. It restores the person's `ZDOTDIR`, sources their original `.zshenv`, and installs ZLE hooks at the first `precmd`. It leaves startup files, shell options and prompt strings unchanged. Bootstrap and every integration hook isolate their options, explicitly disabling errexit, nounset and errreturn locally. Integration failure returns normally to the shell. A startup `read` has no editor channel.

The daemon creates a session-specific Unix socket in a random mode-0700 temporary directory, with a mode-0600 socket and random credential. The shell removes the credential and socket address from its exported environment. Each primary ZLE entry opens a new connection and authenticates with the credential, spawned shell PID and private protocol version 2. Older integrations cannot authorize insertion. Leaving ZLE closes the descriptor; a new editor cycle cannot inherit a pending request or preview revision. Continuation editors and `vared` are excluded.

A `zle -F -w` widget handles requests on this separate descriptor. It answers inspection with the live `PWD` and whether `BUFFER`, pending terminal bytes, queued keys and the current decoder sequence (`KEYS`) are empty. On preparation it checks again, in the actual widget invocation: active primary ZLE, an unexpired request, exact approved cwd, an empty buffer and no pending, queued or partially decoded input. It then claims a request-specific permit with the `zsh/files` builtin rename in the same private socket directory, assigns `BUFFER` and `CURSOR` directly and redraws. Command bytes never pass through the PTY or reach a builtin `read`.

Each prepare creates a mode-0600 permit before dispatch. The pending operation remains subscribed to `ShellPrompt.input()` through its AbortSignal; input removes that permit synchronously before the existing Session write reaches the PTY. Removal and the editor's rename arbitrate which operation wins. Requests expire after one second, and timeout revokes the permit and closes the channel. Reply/close cleanup removes the permit and claim files. ZLE checks the deadline before mutation, so a request waiting behind a blocking widget cannot apply later. Only the widget's `prepared` acknowledgement confirms insertion, and only `refused` confirms an editor refusal. Missing, malformed or lost replies are unconfirmed, even if cancellation was requested. The server uses `terminal-editor-refused` and `terminal-prepare-unconfirmed` error codes; the dialog supplies distinct English/Dutch text. A transport failure after dispatch is also unconfirmed. The consumed ticket and disabled dialog button prevent retries. The person must inspect the terminal because the command may already be present.

This boundary protects against terminal output and concurrent state changes. The person's own shell configuration and processes running with their OS account remain trusted; this is not a sandbox against malicious code deliberately rewriting the integration or reading its private memory/files.

## Server validation and races

The existing person-only action registry sends preview and confirmation to the chat's captured endpoint and machine identity, without fallback to the active or local endpoint. The server checks the source against a closed top-level fence in the persisted finished main reply. It accepts one visible line of at most 1,000 UTF-8 bytes, rejects controls and incomplete operators/heredocs, and runs syntax-only checks for the source and destination shells without executing the command.

A candidate must be the same live plain session, attached to that client, in the chat's project, with no agent, launch or held command. Its foreground state must be positively verified and its live editor cwd must match the chat cwd. Preview tickets expire after one minute and bind the client, machine, source, project, cwd, session instance and editor/input revision.

Confirmation consumes its ticket before awaiting, then repeats source, ownership, membership, attachment, expiry, foreground and revision checks. The last server validation and editor-channel dispatch share one synchronous turn. The widget repeats buffer/cwd/editor checks at insertion. User input invalidates the preview immediately and revokes any unclaimed in-flight insertion, including after dispatch. Input already inside the tty or decoder is checked by ZLE. The precise insertion boundary is the widget's successful permit claim: input arriving after that claim is ordinary subsequent input. The widget executes the claim and buffer assignment without processing another key between them. Typing and clearing or entering a new editor cycle remains eligible after fresh inspection; a used terminal is not permanently disabled. Concurrent confirmations cannot insert twice.

## Live cwd observation

Live editor consumers can call `await session.shellPrompt.workingDirectory()` on the owning machine:

- `{ state: 'known', cwd, revision }` is a fresh observation from the primary ZLE editor, after all prompt hooks, including a late `precmd` that calls `cd`. A nonempty edit buffer can still provide a cwd.
- `{ state: 'unknown' }` means no valid current observation: unsupported shell, startup, command/builtin input, secondary editor, timeout, disconnect, exit, or input/connection replacement while the request was pending.

There is no launch-directory or OSC fallback. The returned cwd is an observation at reply time, not a lease over future shell execution. Consumers must request it at use time and handle unknown explicitly. `snapshot()` is only an internal preview observation, not a reliable file-link cwd source or an insertion authorization. A prepare always rechecks cwd inside ZLE.

Historical file links use the cwd attached to their output, not this live observation. The shared tracker and snapshot metadata are described in [ADECORE-DEVELOPMENT.md](ADECORE-DEVELOPMENT.md#file-location-links-and-shell-cwd).

## Limits and verification

Only newly integrated zsh terminals are eligible destinations. sh/bash/zsh code blocks remain supported when their single line also passes zsh syntax validation. Bash/readline and other editors need an equivalent editor protocol; they do not fall back to generic PTY paste. Existing sessions need reopening. Directory aliases are compared as exact paths; different spellings can yield no candidate. Quoted/nested/subagent fences, multiline commands, control characters, and some conservative literal operator/heredoc cases are excluded.

Real-shell validation covers macOS zsh. Linux and a connection between two physical machines have not been exercised. A profile that removes or replaces the ZLE hooks can make the integration unavailable. Used terminals can become eligible again after the editor actually becomes empty; a redraw alone grants nothing.

The browser test renders ADE CORE's real `AssistantRow`/Markdown through Ruimte's real workspace host, person action registry, request schemas and dispatcher into a real zsh editor. It checks completed/streaming/incomplete blocks, simulated remote ownership despite a local active endpoint, the complete preview, late busy/input changes, and no execution after preparation. Separate real-shell regressions cover forged OSC plus startup read, prefilled line-init buffers, late cwd changes, invisible-to-daemon buffer/cwd races, blocked-widget expiry, editor cycling, secondary editors, and concurrent confirmations. Further regressions cover option preservation in both startup files, delayed-frame races for partial decoding and typing/clearing, cancellation cleanup, and lost-acknowledgement dialog tests in English and Dutch. `TERMINAL-PREPARE-CHECKS.txt` records isolated and combined integration checks separately.

## Cwd integration

`workingDirectory()` and its known/unknown observation contract are unchanged. OSC remains navigation metadata with no insertion authority. `Session.write()` still calls `ShellPrompt.input()` before touching the PTY.

`ShellEditorConnection.prepare(cwd, command, signal)` now returns `Promise<ShellPrepareOutcome>`; `ShellPrepareOutcome` is `'inserted' | 'refused' | 'unconfirmed'`. `ShellPrompt.prepare()` returns that same outcome and owns the pending AbortController. The Unix request frame is unchanged, but the hello frame gains a required fourth field `2`, and the environment supplies `RUIMTE_EDITOR_PERMITS`, removed from exported shell variables during bootstrap. The existing error envelope carries the two new error codes; no public request/result schema or generated wire change is needed.

The output-cwd hooks share the isolated bootstrap and preserve their incoming status while isolating shell options. Cwd notifications never acknowledge input readiness or bypass the editor's permit claim. Combined real-shell/browser tests cover historical file navigation and clear/resync with strict options in both startup files, alongside the editor race and acknowledgement regressions.
