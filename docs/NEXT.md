# Next

Only open implementation, decisions and verification belong in this plan. Each numbered package
is a reviewable change; split larger packages into issues when implementation starts. The order
is a priority recommendation. Run measurements or a design spike before estimating larger work.

Reviewed against `aada37fe5` on October 7, 2026. Implementation, acceptance and product decisions
are separate tasks below. The ADE CORE extraction, initial language-server implementation and
multiwindow implementation are complete; their remaining acceptance does not require rebuilding them.

## Implementation order

| Package                               | Priority                             | Depends on                                     |
| ------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| 1. Chat lifecycle and native requests | First                                | Nothing                                        |
| 2. Ownership and persistent files     | First                                | Nothing                                        |
| 3. Test floor and measurements        | Early                                | Nothing for a baseline                         |
| 4. Keyboard and settings              | Next                                 | DOM setup from 3 for interaction tests         |
| 5. File and diff entry points         | Next                                 | Nothing                                        |
| 6. Terminal basics                    | Next                                 | 4 for new bindings; 5 for file links           |
| 7. Canvas ergonomics                  | Next                                 | 4 for bindings; baseline from 3                |
| 8. Chat depth                         | Next                                 | 1 for lifecycle; 5 for shared file locations   |
| 9. Accounts                           | Next                                 | 1 for continuation/recovery                    |
| 10. Remote access and media           | Next                                 | 2; measurements from 3                         |
| 11. iOS, devices and worktrees        | Next                                 | 1 for task status; 5 for locations             |
| 12. Multiple windows                  | Acceptance                           | Existing implementation; baseline from 3      |
| 13. Copilot and Gemini chat           | Later                                | 1 and 9; compatibility checks below            |
| 14. Editor and language servers        | Acceptance and remaining features    | Existing implementation; server policy per addition |
| 15. Plugins                           | Decision first                       | Registry inventory and a compatibility release |
| 16. Linux and Windows                 | Linux checks early, Windows deferred | Platform spikes and CI                         |

Measurements must finish before changing the WebGL budget, splitting the composer chunk or
choosing media buffer sizes.

## 1. Chat lifecycle and native requests

Sources: `@adecore/agents/chat`, task coordination and the host's resume handlers.

Completed fixes and retained evidence are in the
[consolidated orchestration report](reports/private/2026-09-30-orchestration-upstream.html).
Only the following live evidence remains; do not rerun historical implementation prompts.

1. Capture a natural provider-limit/reset sequence when one occurs, using the bounded probe in
   the report. A quota read alone is not a refusal/reset replay. Do not consume budget to force
   a limit. Unknown reset times keep the queue paused; this capture does not block other fixes.
2. Preserve natural early-before-tool metadata or mid-run child model changes if they occur.
   Current regressions cover those orderings deterministically; the latest live capture shows
   normal nesting and reuse. This is supplementary evidence, not an implementation gate.

The remaining full-client memory verification belongs to package 3.

## 2. Ownership and persistent files

The [October 7 audit](reports/private/2026-10-07-codebase-audit.html) records B01 through B08
with isolated probes. These are implementation tasks, not missing manual acceptance:

1. Serialize saves per canonical file and recheck the version inside that operation. Two clients
   saving the same old version must produce one whole file and one conflict, including hardlinks,
   shortened files and writes in the same millisecond (B01).
2. Enforce MachineHome protection throughout recursive grep, including its JavaScript fallback.
   Searching an allowed parent folder must not reveal protected descendants (B02).
3. Bind database write grants to the approved destination and scope. Changing a connection's
   target or reusing its id must invalidate the old grant (B03).
4. Make shared/private database configuration writes recover together. Failure between writes
   must retain a complete old or new configuration after restart (B04).
5. Decode truncated UTF-8 correctly at the binary-sniff boundary. Valid multibyte text must stay
   text without accepting invalid UTF-8 later in the file (B05).
6. Order secret reads, writes and deletes per path, with unique temporary files. A completed
   delete must not be undone by an earlier write (B06).
7. Make `ProjectStore.mutate` notify drawing and diagram stores when a view disappears, using the
   same orphan cleanup as save. Test failed writes, shared/private files and unknown kinds (B08).
8. Extend the desktop service check from the standard CLI path to every unknown installation.
   Preserve another executable's service during start, replacement, uninstall and stop, while
   retaining the update/restart path for this app's own service (B07).
9. Reproduce the status-routing problem when someone types `codex` manually in a shell. Use
   `apps/server/src/providers/launch.ts` as the baseline. Do not replace shell configuration or
   infer status from terminal output.
10. Implement the separate [home-maintenance plan](reports/2026-10-01-ruimte-home-maintenance.html):
    screenshot expiry without another capture, writer-owned crash leftovers and durable deletion
    of cold sessions. Log rotation remains a separate patch; age never authorizes deleting work.

Done when the audit's regression cases pass, deleted views lose only their unused files,
unknown services remain unchanged, and handwritten launches have a verified route or limitation.

## 3. Test floor and measurements

1. Add a DOM test setup alongside the existing i18n/React-deduplication preloads. Start with composer
   send/queue/Stop and canvas focus/command wiring. Existing pure state and renderer tests stay.
2. Add the dev-only palette command that creates a reproducible 30-node scene. Measure input
   latency, frame time, heap and mount/read counts for terminals, chats and files, then nine grid
   cells. Measure ten file nodes with representative large files, including zoom below/above the
   editor gate and repeated view switching.
3. Measure the fixed ten-context WebGL budget on representative hardware and under context loss.
   Choose any cap/adaptation change from those results. A user setting is not automatically required.
4. Finish the collected Electron heap and frame/latency measurement for the prepared 100-idle-chat
   full-client fixture. The previous run stopped before collecting that evidence. Recreate the
   fixture against the current ADE CORE packages; obtain app access for any computer-use round.
   The [orchestration report](reports/private/2026-09-30-orchestration-upstream.html#afwerking-1-oktober)
   records the completed 1,000-child deterministic probe, genuine nine-child Claude replay,
   full Electron view-switch baseline and Bun/JSC/mimalloc attribution. Do not infer collected
   Electron heap from RSS or change cache/GC policy before measuring this workload.
   The [October 2 protocol probe](reports/private/2026-09-30-orchestration-upstream.html#retention)
   also retains 10,000 text and 10,000 thinking counters after completed turns and `forgetPending()`.
   Determine a safe lifetime for these message-id maps with replay, deduplication and late background
   frames before choosing cleanup or a cap. This process-lifetime retention does not prove an
   Electron leak; measure the full client separately.
5. Measure binary `bytes.read` throughput while terminals and chats are busy, on socket and direct
   connections. If one session can dominate the socket, add fair per-session limits that preserve
   replies/chat events and repair dropped terminal output through `session.resync`.
6. Measure workspace startup and composer chunk cost before splitting CodeMirror. Split it only
   when the measurement shows a startup improvement, then repeat that same measurement.
7. Record desktop, visual and screen-reader acceptance of the ADE CORE cutover: file navigation
   and selection, staged/mixed Git checkboxes, menus and drags, editor typing/undo/search, language
   popups and AI actions. Shared source already lives in ADE CORE; do not repeat the extraction.
8. Recheck the [remaining October 2 audit cases](reports/private/2026-10-02-codebase-audit.html#restpunten)
   against current code. Its historical completion badges do not close the explicitly recorded
   follow-ups or prove device, deployment and accessibility acceptance.

Done when the baseline, hardware/build, fixture sizes and results are recorded with units, and
any measured regression has a bounded follow-up. Choose performance acceptance budgets from the
baseline before optimizing; the node counts alone are not a latency target.

## 4. Keyboard and settings

Sources: the app/canvas/terminal shortcut handlers, `shell/settings/shortcuts.ts`,
`shell/settings/search.ts` and `state/settings.ts`.

1. Replace handwritten shortcut lists with one binding table containing stable command ids,
   defaults and `when` contexts. Handlers, Keyboard, menu accelerators and the palette read it.
   Preserve terminal/browser ownership and the existing drawing/prompt-widget exceptions.
2. Add persisted overrides, press-to-record, context-aware conflict labels, per-binding reset and
   Restore defaults. An invalid override cannot make the app's essential controls unreachable.
3. Expose the existing settings search results as palette entries that open the exact row, with
   the same availability checks and translated search words.
4. Add a separate canvas font size for chat and text elements, preserving the current interface
   and terminal font sizes. Specify whether existing explicitly sized text follows that default.

Done when changing a binding changes both behavior and the displayed key, overlapping contexts
are tested, reset restores defaults, and a palette setting result reaches the right row.

## 5. File and diff entry points

1. Carry a line location through a file node instead of encoding it into the filesystem path.
   Reuse `file.preview` and the file surface so preview, node and editor agree on the location.
2. Probe installed external editors, add an editor preference and implement `fs.open` with a
   structured path/line location. Route file menus, diff rows and terminal file links through it,
   on the machine that owns the file. Handle an unavailable editor and paths containing spaces.
3. Add a diff node that reuses the git panel's worktree/base/commit scopes and diff rendering.
   Introduce its contract with the existing unknown-kind compatibility discipline; older clients
   must preserve a node they cannot draw.

Done when a location opens the correct line from every entry point, a diff node follows its scope,
and reloads/older clients preserve the stored node.

## 6. Terminal basics

1. Register xterm as a host of the shared find bar, with next/previous, result state and disposal.
2. Add clickable file paths across wrapped rows, carrying line/column locations into package 5.
   Test wrapped paths, spaces and an invalid or missing file.
3. Type a shell-quoted path when a local file is dropped on a terminal. Use the existing Finder
   bridge and remote-machine refusal rules; dragging a local path to a remote shell is not a valid path.
4. Enable matching Unicode 11 widths on client and headless xterms. Compare attach/resync snapshots
   with the client after resize, wide characters and emoji.
5. Add Clear to the node and terminal context menus through the existing `terminal.clear` action.
6. Add Send to linked chat for a terminal selection. Append a fenced block to the chosen linked
   chat's draft without sending; offer a chooser when several chats qualify.
7. Discover listening ports from the session's process tree using a platform adapter, beginning
   with the planned `lsof` probe on macOS. Reuse launch port/probe behavior where useful. Stop the
   poll with the owning session and offer Open :port as a browser node with an edge.

Done when search, links, drop and Clear work in both a terminal view and node; a discovered port
belongs to that session, and its chip creates the linked browser.

## 7. Canvas ergonomics

1. Add directional node focus with its own binding context. Grid focus remains Mod+Alt+Arrow;
   maximize remains Mod+Shift+Enter. Test groups, hidden nodes and a node body owning the keyboard.
2. Add local camera back/forward history. Browser Cmd+[ and Cmd+] win while a browser is focused.
   History stays out of project persistence and does not record every pan animation frame.
3. Implement arrange, align and tidy as pure geometry functions, expose them in palette/menu and
   undo each operation as one change.
4. Rank palette results by exact match, prefix and substring; add `>` for actions. Track recently
   visited nodes independently of recent commands, and use them on an empty query.
5. Save pasted images under `<folder>/.ruimte/images` and create file nodes pointing at them.
   Handle a project without a folder, failed writes and unused-image cleanup deliberately.
6. Add optional color/arrowhead styling to plain lines, preserving the meaning and permissions
   of context/target/origin edges. Give notes a first body heading derived from their title without
   duplicating or overwriting an existing heading; settle rename behavior before implementation.

Done when geometry changes undo cleanly, focus/history never take over another surface's keys,
and image/line/note data survives save and reload. Confirm the measurements from package 3 still hold.

## 8. Chat depth

1. Preserve attached chats in `StashedPrompt`, parsing older entries as an empty list. Restore only
   references still readable in the destination project.
2. Keep a settled question outside its turn fold and keep running background subagents visible.
   Include workflow members in the activity list above the composer.
3. Offer Continue in an empty composer after a person stopped a turn. Reuse the normal continuation
   path and keep its queue/limit behavior consistent with package 1.
4. Add Clear to a chat node's menu through the existing action, after package 1 defines child cleanup.
5. Let a person attach diff review comments to the draft, with path, line/side and quoted context.
   Keep provider permission choices faithful to the descriptions/choices it actually supplies;
   today's remember labels in both protocol mappers are written by Ruimte.
6. Expose fork to agents through the action registry and context CLI with lineage, project, account
   and permission-ceiling checks. `chat.fork` currently admits only person/voice actors.
7. Design Restore files to this turn as a separate action. A turn checkpoint includes all changes
   in the chat's working folder, including concurrent human edits. Decide its overlap/conflict rule
   and show a reviewable diff before building a shared-folder restore. Keep the existing fork into
   a new worktree behavior; that does not restore the original folder.

Done when draft references survive stashing, folds do not hide needed context or active work,
and review/fork/restore actions enforce their actor and file boundaries. File restore stays a
decision-dependent step until concurrent edits have a defined treatment.

## 9. Accounts

Source: `@adecore/agents/providers/accounts`. Nobody has used a second real account yet.

1. Verify two real Claude account folders retain separate logins after daemon/app restart, each
   showing its own email after a restart of the Mac, and a real Codex conversation continues on
   another account in the same thread through its shadow home ("Continue on account"). Record
   versions and outcomes without reading vendor credentials.
2. Verify login started from iPhone and station. Codex's device-auth route is a candidate; establish
   what Claude's browser callback requires when the browser and CLI are on different machines.
   Implement only the missing flow, preserving the distinction from Ruimte's own account login.
3. Decide which skills, `CLAUDE.md` and settings an additional Claude account should share with
   `~/.claude`. Implement that policy without sharing authentication or overwriting an explicit
   account configuration.
4. Drop the background behind the machine tiles in the Account pane, as the other settings icons did.

Known limits, accepted for now: a Claude chat cannot move to an account with another folder after
its first turn (fork instead); Gemini and Copilot only have their default account until it is known
which variable points at their folder; a non-default account is read for limits on the clock only
when used in the last 24 hours, a time the daemon keeps in memory only; "Show folder" copies the
path, since the desktop bridge cannot reveal a folder.

Done when the real-account checks pass and mobile/web login either succeeds or has a precise
remaining provider limitation. Folder-isolation tests alone cannot establish login isolation.

## 10. Remote access and media

1. Reproduce the iPhone's direct connection dropping during the 56 Mbit/s video. Correlate ICE,
   channel, broker and media request events to distinguish a connection failure from a decoder or
   buffer stall. Fix the cause before increasing buffering.
2. Verify audio in Electron dev over a socket and a direct connection, including seek, reconnect
   and repeated playback. Add desktop spool/read-ahead only if measurements show a benefit;
   define its disk/memory bounds and invalidation on file version changes.
3. Measure TURN on real carrier-grade NAT networks, record which route was selected and compare
   throughput/latency. TURN configuration alone is insufficient evidence.
4. Move the broker to its production server: inventory the current deploy configuration, prepare
   health checks and rollback, validate the replacement, migrate, then remove the test droplet.
   The infrastructure cutover/deletion is a separate operational step when implementation reaches it.
5. Check an expired station login at cold start and during reconnect. The start screen must show
   the reason and a usable sign-in action instead of an indefinitely waiting project.
6. Decide a supported protocol-version window using
   [the protocol report](reports/2026-09-15-protocol-versions.html). Implement negotiation and
   cross-version fixtures only after that decision; today's gate accepts exactly the same version.
7. Verify the implemented LAN door on real devices: iPhone and iPad on the same Wi-Fi as
   the MacBook show Local network, also with `--no-broker` after a first connection; on 4G the
   connection opens through the broker with at most a second more. Check whether the macOS firewall
   asks about the npm binary listening on the LAN, and what the iPhone does when Local Network access
   is denied. (Electron 44 lets the `app://ruimte` page open `ws://` and `fetch` to loopback and to a
   LAN address; checked with a probe on 2026-10-04.) Check the same login and connection flow on
   a fresh Linux machine. The LAN door, account-only access, route race and `ruimte status` exist;
   pairing has been removed.
8. Decide whether Bonjour discovery is still wanted for first use and changed LAN addresses.
   It is not implemented. If chosen, specify an anonymous advertisement, iOS local-network
   permission, desktop discovery and Linux multicast behavior before building it.

Done when connection drops have an explained, tested outcome, real-network media/terminal
measurements meet the agreed budgets, and broker migration has verified rollback. Preserve the
existing binary reply path, range streaming and explicit direct-connection failure behavior.

## 11. iOS, devices and worktrees

1. Add typing to physical iOS devices behind the existing backend input capability. Verify Unicode,
   multiline text and the taken-over/stopped state on an actual device. Android's current text
   path is limited to ASCII, so do not claim Unicode parity without a fix.
2. Decide how to merge into a branch checked out nowhere. The current code intentionally refuses
   `target-not-checked-out`. A ref-only merge needs its own conflict/result path and must never move
   a ref behind a working tree; implement it only after updating that invariant deliberately.
3. Verify the implemented visual replies on a real iPhone in both themes, with links opening in
   Safari. Check desktop/station rendering and the machine's off switch too. The daemon verb,
   preview renderer, sandbox host and native iOS presentation are already built; the current
   behavior is documented in the server and iOS READMEs.

Done when phone acceptance checks are recorded and worktree actions show/resolve conflicts
without losing work. Installing apps and device logs remain out of scope.

## 12. Multiple windows

Acceptance only. `createWindows`, project claims, sender-bound IPC, restored window targets and
shared-storage synchronization already exist.

1. Use two local/remote projects side by side. Check menus, dialogs, browser guests, notifications,
   shared settings and project claims from both windows.
2. Reload and reopen the app; verify project URLs and window bounds, including a removed display.
3. Close a window and confirm its client detaches while daemon sessions survive. Explicit project
   closure still follows the last-client rule. Exercise unsaved edits during a window move.

Done when these cases have recorded desktop evidence. Fix any reproduced gap in the existing
implementation; do not introduce another window registry.

## 13. Copilot and Gemini chat

Source: [the provider research](reports/2026-09-25-provider-research.html).

1. Correct the existing Copilot terminal first-prompt behavior separately: it still uses `-p` in
   `apps/server/src/providers/terminal-providers.ts`. Verify the installed CLI's interactive flag
   (the report proposes `-i`) and ensure the session remains open after its first answer.
2. Recheck supported versions and run bounded Copilot SDK versus ACP and Gemini ACP spikes.
   Choose Copilot's transport from actual permission/question/resume and packaged-Bun behavior.
   Keep any shared ACP parsing independent of a provider's unstable model-selection extension.
3. Implement one backend and protocol mapper per provider in `@adecore/agents`, with capability
   discovery, accounts/login probing, model selection, streaming, Stop, approvals, questions and resume.
   Add terminal hook normalization only for documented status/context events; leave TUI answers there.
4. Test desktop and iOS against these existing provider words. Separately design unknown-provider
   handling in `@adecore/agent-contracts/agent.ts` so an older desktop does not reject a whole
   answer. Confirm the iOS open-enum build has shipped before introducing any new enum word;
   regenerating schemas is not proof that the installed app has that change.

Done per provider when two turns, denied writes, an open approval stopped by the person, restart
and account/login failures work in the packaged app. Do not promise an SDK/API choice before the spike.

## 14. Editor and language servers

Implementation and current limits: [SMART-EDITOR.md](SMART-EDITOR.md) and
[the daemon README](../apps/server/README.md#language-servers). The ADE CORE editor/LSP host,
server installation, multiple servers, custom commands, TypeScript sidecar and native PHP
integration are built. Monaco is removed.

1. Finish manual editor, AI and accessibility acceptance with the shared packages, including
   zoomed file nodes, navigation to unopened files, typing/undo, search, language popups,
   multi-file create/rename edits, stale results, crash/restart and local/remote clients.
2. Check install, update, rebuild and previous-version actions with actual server binaries.
   Keep installation and custom-command approval with the person on the machine.
3. Decide the formatter policy recorded in SMART-EDITOR.md. A project's existing formatter is a
   candidate; no new formatter runner is implied by the completed editor migration.
4. Add remaining native/toolchain servers only after specifying installation and execution rules,
   especially project code, build scripts and proc macros in agent worktrees. Rust, Go, Swift,
   TOML, Lua, Zig and Markdown remain candidates, not completed catalog entries.
5. Track remaining editor limits in SMART-EDITOR.md and the shared package's docs. Project-wide
   diagnostics, richer snippet behavior and hidden unchanged review ranges are separate features.

Done per accepted feature when the required runtime/device evidence exists. Fake-server tests
remain deterministic tests; real language servers belong in integration tests.

## 15. Plugins

Source: [the plugin report](reports/2026-09-14-plugins.html), whose product choices remain open.

1. Choose context-only plugins versus declarative commands/panels/nodes, installation scope and
   agent permissions. Inventory existing action/verb registries and only deepen the missing ones.
2. Ship the required compatibility changes before writing plugin kinds or ids. Preserve unknown
   plugin data in project and client-local state, including when a plugin is absent.
3. Implement a manifest and install/disable/error lifecycle under `$RUIMTE_HOME/plugins` for the
   selected model. Opening a repository must not execute its suggested plugins.
4. Introduce isolated executable code only if the declarative model proves insufficient. Test
   compiled-binary loading in the signed app if that route is still needed. Do not repeat the
   ad-hoc compiled-binary experiment that was killed or hung; it proved nothing about `import()`.

Done when one representative plugin can be installed, used, disabled and reopened on a client
without it, with bounded capabilities and intact stored data. This package cannot pass its first
step on an engineering assumption alone.

## 16. Linux and Windows

1. Recheck [LINUX.md](LINUX.md) against the current split between deterministic and integration
   tests. Add Linux CI, handle platform assumptions explicitly, and record package smoke checks for
   deb on Debian trixie/Ubuntu noble, arm64, AppImage on Ubuntu and GNOME/KDE/X11/Wayland.
2. Address Linux font fallbacks in drawing text and request the generic UI font change in
   `@adecore/ui`. Decide native Wayland behavior from fractional-scaling measurements.
3. Keep Windows deferred under [issue #15](https://github.com/basmilius/ruimte/issues/15). First prove
   a ConPTY helper behind the existing PTY adapter; then shell/path/process assumptions, filesystem
   watching, service/CLI packaging and an unsigned installer. Use
   [the platform audit](reports/2026-09-24-cross-platform.html) as the checklist.

Done when each supported platform has CI and recorded packaged-app checks for its claimed
architectures/formats.

## Decisions and completion rules

The decision-dependent steps are shared-folder restore with concurrent edits, Claude account configuration sharing, ref-only merges,
the protocol window, Bonjour discovery, plugin scope, formatter policy and the later language-server execution rules. Decide each before
its dependent implementation, while continuing the other steps. Measurements settle buffer, cap
and chunk choices. Automatic redelivery after an accepted parent turn fails remains disabled by
the existing product decision; it is not an unanswered implementation question.

For each code change, run focused deterministic regressions and the repository's required checks.
Use integration tests for real shells, watchers, sockets and provider/server processes. Verify UI
changes in the Electron dev app and capture real-device/network evidence where the package calls
for it. New actions go through the registry, menu and palette; new text has English and Dutch.
Keep new wire fields optional and regenerate Swift schemas with contract changes. A new kind or
enum word needs the compatibility checks above.

Remove each step once its implementation and required verification are complete. Keep completion
history and evidence in reports, outside this list. A passing fake or a generated schema does not
complete a real-account, device, deployment or release check.
