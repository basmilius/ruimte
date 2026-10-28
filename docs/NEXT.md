# Next

Open implementation and decisions only, in recommended order. Each numbered package is one reviewable change; split a larger one into issues when work starts. Remove a step once it is built and verified.

Reviewed on October 28, 2026.

## Order

| Package                     | Priority             | Depends on                      |
| --------------------------- | -------------------- | ------------------------------- |
| 3. Measurements             | Hardware runs        | Baseline done (October 17)      |
| 4. Keyboard and settings    | Next                 | Nothing                         |
| 5. File entry points        | Next; 5.1 from 0.20  | Nothing                         |
| 6. Terminal                 | Next                 | 4 for new bindings              |
| 7. Canvas ergonomics        | Next                 | 4 for bindings; baseline from 3 |
| 8. Chat depth               | Next                 | Nothing                         |
| 9. Accounts                 | Next                 | Nothing                         |
| 10. Remote access and media | Next                 | Measurements from 3             |
| 11. iOS devices             | Next                 | Nothing                         |
| 12. Intelligent UI          | Next                 | Nothing                         |
| 15. Language servers        | Per server           | Decision 15.4                   |
| 16. Plugins                 | After 1.0            | A compatibility release         |
| 17. Linux and Windows       | Windows per its plan | Platform spikes and CI          |

Measure before changing the WebGL budget, splitting the composer chunk or choosing media buffer sizes.

## 3. Measurements

The scenes and recorder are built (the "Measure:" rows in a dev build's palette); the baseline was taken on October 17. Still open, on real hardware in the Electron app: the 30-node scene, nine cells and ten large files, the WebGL budget under context loss, 100 idle chats, and workspace startup, which decides whether CodeMirror is split.

## 4. Keyboard and settings

1. The Keyboard panel (`shell/settings/shortcuts.ts`) reads the command table instead of its own lists, with `when` contexts for keys. Keep terminal and browser ownership and the drawing and prompt-widget exceptions.
2. Persisted overrides, press-to-record, conflict labels per context, reset per binding and Restore defaults. No override can make the essential controls unreachable.
4. A canvas font size for chat and text elements, apart from the interface and terminal sizes.

Done when a binding change changes both behavior and the displayed key, overlapping contexts are tested and reset restores the defaults.

## 5. File entry points

1. A file node keeps a location (`FileLocation`). Write it only from 0.20, since 0.19.0 is the first release that keeps unknown stored fields.
2. Probe installed editors, add an editor preference on the machine that holds the file, and implement `fs.open` with a path and line. File menus, diff rows and terminal file links go through it.

Done when a location opens the right line from every entry point and an older client keeps the stored node.

## 6. Terminal

5. Send a terminal selection to a linked chat: append a fenced block to that chat's draft without sending, with a chooser when several qualify.

## 7. Canvas ergonomics

2. Align and tidy as pure geometry over `arrangeRects`, in palette and menu, each undone as one change.
3. Rank palette results by exact, prefix and substring match; `>` for actions; recently visited nodes on an empty query.
4. Save pasted images under `<folder>/.ruimte/images` (or `$RUIMTE_HOME/images/<project>`) as file nodes. A failed write shows a toast and makes no node. "Clean up unused images" is the only removal.
5. Color and arrowheads on edges between nodes, as free canvas lines have, keeping the meaning of context, target and origin edges. A note's first heading follows its title while it still equals the old title.

Done when geometry changes undo cleanly and image, line and note data survive save and reload.

## 8. Chat depth

2. A settled question stays outside its turn fold, and workflow members show in the activity list.
7. Restore files to this turn: only files the turn changed. A file changed since is a conflict, restored only when ticked in the diff.

## 9. Accounts

2. Login started from the iPhone and the station: build only the flow that is missing once a real-account check shows what each provider needs.
3. Share `CLAUDE.md`, skills, agents and commands between an extra Claude account and `~/.claude` through symlinks; `settings.json` once as a copy; never authentication, history or `projects/`.
4. Drop the background behind the machine tiles in the Account pane.

Accepted limits: a Claude chat cannot move to an account with another folder after its first turn (fork instead); Copilot only has its default account.

## 10. Remote access and media

2. Desktop spool or read-ahead for audio and video, only if a measurement shows a gain.
4. Move the broker to its production server with health checks and rollback, then remove the test droplet.

## 11. iOS devices

1. Typing on physical iOS devices behind the existing input capability.

## 12. Intelligent UI

2. A `[1]` reference in a native block's prose becomes a source chip that jumps to its Source row.
3. A failed live read shows the previous value dimmed with the error in the footer. A changed value fades from the accent once over 800 ms, not under reduced motion.
4. Newly written words fade in in a growing native block, without changing an input's identity or focus.
5. Phase 2 of the Generative UI report: the diff and schema views and the host components.

## 15. Language servers

4. Further native servers (Go, Swift, TOML, Lua, Zig, Markdown) only after their install and execution rules are set. Work from another machine already gets no server that runs project code (`runsProjectCode`). Still open: what such a server may run in a person's own agent worktrees, such as build scripts and proc macros.
5. Remaining limits, each in its own package or host: a file view keeps its old path after a move; project-wide diagnostics; column-precise navigation; peek highlighting and more than thirty files; review rows hiding unchanged ranges; on-device help for non-function symbols, Explain in the context menu, suggestions while typing.

## 16. Plugins

After 1.0, declarative first: context, commands and panels, no executable code. Source: [the plugin report](reports/2026-09-14-plugins.html).

2. Ship the compatibility changes first: unknown plugin data survives in project and client state.
3. A manifest and an install, disable and error lifecycle under `$RUIMTE_HOME/plugins`. Opening a repository runs none of its suggested plugins.

## 17. Linux and Windows

2. Linux font fallbacks in drawing text and the generic UI font in `@adecore/ui` ([LINUX.md](LINUX.md)). XWayland stays the default until the fractional-scaling measurement settles native Wayland.
3. Windows follows [WINDOWS.md](WINDOWS.md), tracked in [issue #15](https://github.com/basmilius/ruimte/issues/15).

## Decisions

- 15.4: the execution rules for further language servers in a person's own agent worktrees.
- After switching to no machine of its own, a window on another machine comes back alone, without a start screen beside it. Changing that needs `@adecore/shell`.

Automatic redelivery after an accepted parent turn fails stays off, by an earlier product decision.

## Rules

Every change gets focused deterministic regressions and the required checks; real shells, watchers, sockets and processes get integration tests. New actions go through the registry, menu and palette. New text has English and Dutch. New wire fields are optional, and Swift schemas are regenerated with contract changes. A passing fake or a generated schema does not complete a real-account, device, deployment or release check.
