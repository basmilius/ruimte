# Next

Only open implementation, decisions and verification belong in this plan. Each numbered package
is a reviewable change; split larger packages into issues when implementation starts. The order
is a priority recommendation. Run measurements or a design spike before estimating larger work.

## Implementation order

| Package | Priority | Depends on |
| --- | --- | --- |
| 1. Chat lifecycle and native requests | First | Nothing |
| 2. Ownership and persistent files | First | Nothing |
| 3. Test floor and measurements | Early | Nothing for a baseline |
| 4. Keyboard and settings | Next | DOM setup from 3 for interaction tests |
| 5. File and diff entry points | Next | Nothing |
| 6. Terminal basics | Next | 4 for new bindings; 5 for file links |
| 7. Canvas ergonomics | Next | 4 for bindings; baseline from 3 |
| 8. Chat depth | Next | 1 for lifecycle; 5 for shared file locations |
| 9. Accounts | Next | 1 for continuation/recovery |
| 10. Remote access and media | Next | 2; measurements from 3 |
| 11. iOS, devices and worktrees | Next | 1 for task status; 5 for locations |
| 12. Multiple windows | Later | 2 and 4; baseline from 3 |
| 13. Copilot and Gemini chat | Later | 1 and 9; compatibility checks below |
| 14. Language servers | Later | 5; design spike and permission decisions |
| 15. Plugins | Decision first | Registry inventory and a compatibility release |
| 16. Linux and Windows | Linux checks early, Windows deferred | Platform spikes and CI |

Measurements must finish before changing the WebGL budget, splitting the composer chunk or
choosing media buffer sizes.

## 1. Chat lifecycle and native requests

Sources: `packages/agents/src/chat`, task coordination and the host's resume handlers.

The completed lifecycle fixes and CLI captures are recorded in
[the orchestration report](reports/private/2026-09-30-orchestration-upstream.html#resultaat).
The [October 1 follow-up plan](reports/private/2026-09-30-orchestration-upstream.html#vervolgplan) maps the remaining
changes to the current code and defines their acceptance cases. B1 through B6 and R1 are complete;
the audit's historical start prompt must not be run again.

The implementation, real Claude nesting/reuse and direct resume/compact captures, and verified
mixed-provider child context are recorded in the
[app acceptance results](reports/private/2026-09-30-orchestration-upstream.html#appacceptatie-1-oktober).
No remaining implementation step from B1 through B6 or R1 is open.

The first current baseline is recorded in the
[October 2 scan](reports/private/2026-10-02-orchestration-scan-061736.html).
The additional B01/B02 fixes and current verification are recorded in the
[October 2 recovery results](reports/private/2026-10-02-orchestration-scan-061736.html#herstel).
No implementation step from those findings remains open. The natural captures and measurements
below remain separate evidence tasks.

1. Capture a natural provider-limit/reset sequence when one occurs, using the bounded probe in
   the report. A quota read alone is not a refusal/reset replay. Do not consume budget to force
   a limit. Unknown reset times keep the queue paused; this capture does not block other fixes.
2. Preserve natural early-before-tool metadata or mid-run child model changes if they occur.
   Current regressions cover those orderings deterministically; the latest live capture shows
   normal nesting and reuse. This is supplementary evidence, not an implementation gate.

The remaining full-client memory verification belongs to package 3.

## 2. Ownership and persistent files

1. Make `ProjectStore.mutate` notify drawing and diagram stores when a view disappears, using the
   same orphan cleanup as save. Its current id update can hide the deletion from a later save too.
   Test deletion through `view delete`, a failed write, shared/private files and unknown kinds that
   must retain their assets.
2. Apply the CLI's service ownership check to the desktop service controller before install,
   replacement, uninstall or stop. Preserve a service installed by another Ruimte executable.
   Retain the existing update/restart path for a service owned by this app.
3. Reproduce the remaining status-routing problem when someone types `codex` manually in a shell.
   Use the supported launch route in `apps/server/src/providers/launch.ts` as a baseline and
   determine a supported remedy for handwritten launches. Do not silently replace the person's
   shell configuration or guess status from terminal output.

Done when deleting a view cleans only its unused files, the app cannot take over a CLI-owned
service, and the handwritten Codex case has either a verified fix or a documented limitation with
a usable launch route.

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
   full-client fixture. The fixture opened in Ruimte Dev; after Inspect, the computer helper stopped
   resolving the running dev app and reports taken-over. Resume computer use before continuing.
   The [orchestration report](reports/private/2026-09-30-orchestration-upstream.html#afwerking-1-oktober)
   records the completed 1,000-child deterministic probe, genuine nine-child Claude replay,
   full Electron view-switch baseline and Bun/JSC/mimalloc attribution. Do not infer collected
   Electron heap from RSS or change cache/GC policy before measuring this workload.
   The [October 2 protocol probe](reports/private/2026-10-02-orchestration-scan-061736.html#R01)
   also retains 10,000 text and 10,000 thinking counters after completed turns and `forgetPending()`.
   Determine a safe lifetime for these message-id maps with replay, deduplication and late background
   frames before choosing cleanup or a cap. This process-lifetime retention does not prove an
   Electron leak; measure the full client separately.
5. Measure binary `bytes.read` throughput while terminals and chats are busy, on socket and direct
   connections. If one session can dominate the socket, add fair per-session limits that preserve
   replies/chat events and repair dropped terminal output through `session.resync`.
6. Measure workspace startup and composer chunk cost before splitting CodeMirror. Split it only
   when the measurement shows a startup improvement, then repeat that same measurement.

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

Source: `packages/agents/src/providers/accounts`. Nobody has used a second real account yet.

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
4. Complete the iOS account follow-up: Continue on account after a limit (`chat.continueOn` is
   generated but no screen calls it), limit information in its account menu, and a remembered
   default keyed by machine and CLI. Recheck each against current iOS behavior before writing it.
5. Drop the background behind the machine tiles in the Account pane, as the other settings icons did.

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

Done when connection drops have an explained, tested outcome, real-network media/terminal
measurements meet the agreed budgets, and broker migration has verified rollback. Preserve the
existing binary reply path, range streaming and explicit direct-connection failure behavior.

## 11. iOS, devices and worktrees

1. Add typing to physical iOS devices behind the existing backend input capability. Verify Unicode,
   multiline text and the taken-over/stopped state on an actual device. Android's current text
   path is limited to ASCII, so do not claim Unicode parity without a fix.
2. Render a device node/view in the iOS app, using the existing device schema, stream and input
   requests. Define behavior for a disconnected device and an unsupported video format.
3. Add iOS worktree listing, changes, merge/conflict and removal through the existing requests.
4. Decide how to merge into a branch checked out nowhere. The current code intentionally refuses
   `target-not-checked-out`. A ref-only merge needs its own conflict/result path and must never move
   a ref behind a working tree; implement it only after updating that invariant deliberately.

Done when phone acceptance checks are recorded and worktree actions show/resolve conflicts
without losing work. Installing apps and device logs remain out of scope.

## 12. Multiple windows

1. Write a file map and acceptance cases against today's code. Keep one start screen or one
   project per window; views of that project may still occupy a grid.
2. Replace Electron's singleton window with a window registry and resolve window-specific IPC,
   menus, dialogs, browser guests and notification routing from the sender/owning window.
3. Open another project in its own window. Define same-project window presence, restore URLs,
   shared settings/endpoint storage synchronization and window bounds recovery.
4. Verify closing a window detaches its client and preserves the daemon's sessions. Explicitly
   closing a project still follows the existing last-client rule.

Done when two local/remote projects work side by side, reload/reopen restores the right project,
and actions in one window cannot change another window's menu, dialog parent or active view.

## 13. Copilot and Gemini chat

Source: [the provider research](reports/2026-09-25-provider-research.html).

1. Correct the existing Copilot terminal first-prompt behavior separately: it still uses `-p` in
   `apps/server/src/providers/terminal-providers.ts`. Verify the installed CLI's interactive flag
   (the report proposes `-i`) and ensure the session remains open after its first answer.
2. Recheck supported versions and run bounded Copilot SDK versus ACP and Gemini ACP spikes.
   Choose Copilot's transport from actual permission/question/resume and packaged-Bun behavior.
   Keep any shared ACP parsing independent of a provider's unstable model-selection extension.
3. Implement one backend and protocol mapper per provider in `packages/agents`, with capability
   discovery, accounts/login probing, model selection, streaming, Stop, approvals, questions and resume.
   Add terminal hook normalization only for documented status/context events; leave TUI answers there.
4. Test desktop and iOS against these existing provider words. Separately design unknown-provider
   handling in `packages/agent-contracts/src/agent.ts` so an older desktop does not reject a whole
   answer. Confirm the iOS open-enum build has shipped before introducing any new enum word;
   regenerating schemas is not proof that the installed app has that change.

Done per provider when two turns, denied writes, an open approval stopped by the person, restart
and account/login failures work in the packaged app. Do not promise an SDK/API choice before the spike.

## 14. Language servers

Source: [the language-server design](reports/2026-09-23-language-servers.html).

1. Spike Monaco's language-id separation from its TS worker, definition opening without a loaded
   target model, and suggestions/hover in a zoomed file node. Verify the current TypeScript LSP.
2. Build daemon stdio framing, a process seam/fake server, per-root lifecycle, cancellation,
   document ownership and versioned diagnostics. Start with TypeScript.
3. Add optional contracts and client synchronization, permission to run project code, editor
   providers/markers and a visible status/restart path. Use the file locations from package 5.
4. Add other installed servers one at a time after their execution rules are settled, especially
   build scripts/proc macros in agent worktrees. Keep diagnostics outside open editors a separate choice.

Done when real TypeScript completion, hover, signatures, definitions and diagnostics work across
local/remote machines, stale responses are discarded, and crashes/cancellation close their work.
Fake-server tests are standard tests; real servers belong in integration tests.

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
   `@basmilius/desktop-ui`. Decide native Wayland behavior from fractional-scaling measurements.
3. Keep Windows deferred under [issue #15](https://github.com/basmilius/ruimte/issues/15). First prove
   a ConPTY helper behind the existing PTY adapter; then shell/path/process assumptions, filesystem
   watching, service/CLI packaging and an unsigned installer. Use
   [the platform audit](reports/2026-09-24-cross-platform.html) as the checklist.

Done when each supported platform has CI and recorded packaged-app checks for its claimed
architectures/formats.

## Decisions and completion rules

The decision-dependent steps are automatic result redelivery after an accepted parent turn fails,
shared-folder restore with concurrent edits, Claude account configuration sharing, ref-only merges,
the protocol window, plugin scope and the later language-server execution rules. Decide each before
its dependent implementation, while continuing the other steps. Measurements settle buffer, cap
and chunk choices.

For each code change, run focused deterministic regressions and the repository's required checks.
Use integration tests for real shells, watchers, sockets and provider/server processes. Verify UI
changes in the Electron dev app and capture real-device/network evidence where the package calls
for it. New actions go through the registry, menu and palette; new text has English and Dutch.
Keep new wire fields optional and regenerate Swift schemas with contract changes. A new kind or
enum word needs the compatibility checks above.

Remove each step once its implementation and required verification are complete. Keep completion
history and evidence in reports, outside this list. A passing fake or a generated schema does not
complete a real-account, device, deployment or release check.
