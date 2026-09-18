# Ruimte vendoring note

This directory is the `alacritty_terminal` 0.26.0 crates.io source archive from Alacritty 0.16.1 at commit `94e7c8874e526b1e67b349d9ba30ddf81669119e`. The upstream Apache 2.0 license, `.cargo_vcs_info.json`, and Cargo package metadata remain in the directory.

Ruimte carries a small terminal-compatibility patch because snapshots are replayed by xterm.js:

- read-only `Term::inactive_grid` and `Term::scroll_region` accessors let the snapshot serializer inspect both buffers and the active margins without mutating terminal state;
- an optional character-width callback lets Ruimte use xterm.js's Unicode 6 width table;
- opt-in settings match xterm.js around linefeed and saved-cursor wrap state, repair wide-cell pairs after insert/delete operations, and preserve logical soft-wrap boundaries while their source row is edited;
- `Flags::XTERM_EXPLICIT_SPACE` distinguishes a space written by the PTY from an untouched empty cell, so snapshot replay retains xterm.js cell contents.

Every new behavior setting defaults to disabled. The upstream defaults therefore keep their original behavior; only Ruimte's `TerminalState` enables the compatibility settings. The added grid access is immutable, and the patch adds no mutable access to inactive terminal state.

Differential tests feed the same bytes to this terminal and `@xterm/headless`, replay the Rust snapshot into a fresh xterm instance, and compare cells, widths, wrap state, modes, cursors, margins, both screen buffers, and continuation writes.

Upstream source: https://github.com/alacritty/alacritty/tree/v0.16.1/alacritty_terminal
