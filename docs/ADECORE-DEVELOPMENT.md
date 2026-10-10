# Developing Ruimte with ADE CORE

By default Ruimte uses the npm versions pinned in its package manifests and `bun.lock`. To work on the shared packages, switch to the ADE CORE folder beside Ruimte:

```sh
# Run once in ../adecore, and again when its dependencies change.
bun install --cwd ../adecore

# Run from Ruimte.
bun run adecore:link
bun dev
```

The default folder is `../adecore`, currently `~/Development/Projects/adecore`. Links point at its package folders, so Ruimte picks up uncommitted edits and whatever branch is checked out there at once. The command does not select a commit, create a checkout or pull Git changes.

For a different location, pass an absolute path or a path relative to Ruimte:

```sh
ADECORE_PATH=/path/to/adecore bun run adecore:link
ADECORE_PATH=/path/to/adecore bun run adecore:status
```

## Switching back to npm

```sh
bun run adecore:npm
bun run adecore:status --npm
bun dev
```

`adecore:npm` runs a frozen install of the declared versions. It does not upgrade to the latest registry release, and it works even if the local ADE CORE folder was moved or removed. Neither switch changes a package manifest or lockfile, so no local path ends up in a commit.

Restart `bun dev` after either switch. The scripts clear Vite's dependency cache, but running processes only see the new package locations after a restart. `bun dev` prints a short package-mode banner before it starts the workspaces, so a return to npm is visible. A mixed or incomplete install stops it from starting.

After changing a dependency, run `bun install` in the repository whose manifest changed, then run `adecore:link` in Ruimte again. An install in Ruimte restores the npm packages, also when another agent runs it in the same checkout.

`adecore:status` lists every declared ADE CORE dependency by workspace, with its installed source. It exits with an error for missing packages, unexpected locations or a mix of local and npm packages. `--npm` also requires npm mode; use it before a release or a final consumer check.

In linked mode, the full status also compares installed peer versions, plus the shared runtime `zod` and `zustand`, transitive ADE CORE packages included. It reports concrete differences between Ruimte and ADE CORE without failing the command or changing dedupe. Electron differences only concern types, because the desktop bundler keeps its runtime external. A missing or equal peer version produces no advice; this is not a peer-range compatibility check. `adecore:status --brief` prints only the startup banner.

## Source changes

The Vite client, the development daemon, the desktop bundler, the Pulsar development worker, the daemon compiler, the TypeScript checks and the Bun tests all select ADE CORE's `source` exports, so there is no need to build ADE CORE between changes to imported TypeScript. Vite keeps one instance of React, i18next, CodeMirror and Lezer when the library has its own dependencies installed. The linked composer and the app's dictation extensions must use the same CodeMirror classes, also when Vite serves their sources without prebundling.

The client, desktop and daemon release builders keep the source condition on purpose. Consumer validation in npm mode bundles the TypeScript sources shipped in the published packages; it does not validate their JavaScript `dist` as Ruimte's runtime input. ADE CORE CI builds the packages and runs `test:pack`, which checks the packed default (`dist`) and source exports and runs their consumers. Pulsar's production deploy keeps Wrangler's default conditions and uses the published default exports.

Vite updates the client while it runs, and the daemon runs in Bun's watch mode. The desktop main process is bundled at startup, so restart it after changing `@adecore/shell` or desktop service code. A new file, a new export or a dependency change may also need a restart. Tools outside this source-configured flow use the compiled `dist` exports and need `bun run build` in ADE CORE.

### Tailwind linked sources

The development plugin in `apps/client/adecore-sources.ts` resolves ADE CORE's `@source` directives to real filesystem paths before Tailwind scans them, so the stylesheet dependencies match Vite's linked modules. It also watches those source directories and includes their stylesheet in HMR for new or unloaded files. The committed CSS paths and the production build stay the same.

The link command finds consumers in Ruimte's workspaces and dependencies in ADE CORE's workspaces. Before it changes a consumer's links, it checks that shared dependencies such as editor-core resolve inside the same local folder. A failed link restores the consumer aliases it started with.

The script replaces the installed package symlinks itself. Bun 1.4.2's `bun link` inside a Ruimte consumer cannot resolve that consumer's `workspace:*` dependencies, and direct links avoid both that installer path and global package registrations.

## PHP language server

The PHP language server lives in `basmilius/language-server-php` and is independent of the ADE CORE packages. The link script switches every declared `@adecore/*` consumer; PHP is no longer one of them.

For PHP development, put an existing checkout at `../language-servers/php` beside Ruimte, or set `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE=/path/to/php`. A Ruimte worktree also finds the one beside its primary checkout. Install builds that checkout with Cargo. The locator never creates or updates a Git checkout. Without valid local sources the daemon uses the pinned native release, and a compiled daemon always does. See [the daemon README](../apps/server/README.md#language-servers) for the descriptor and how Install works.

SQL works the same way with `basmilius/language-server-sql`: put its checkout at `../language-servers/sql` beside Ruimte, or set `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE=/path/to/sql`, and Install builds it with Cargo.

## Work across the repositories

Fix shared behavior in the ADE CORE folder and application behavior in Ruimte. Edit a shared repository only through its real filesystem path, never through `node_modules`, and only when the task authorizes changes there. A link changes package resolution; it grants neither task authorization nor filesystem permissions.

Validate a shared change in ADE CORE first and then in linked Ruimte. Linked checks do not prove that Ruimte CI can use the registry versions. Publish ADE CORE first. Push Ruimte code that uses a new ADE CORE API only together with the dependency bump to that published version in its manifests and `bun.lock`, after `adecore:npm`, `adecore:status --npm` and the relevant npm consumer checks are green. No pre-push hook is required. Each repository keeps its own commits and release history.

## File location links and shell cwd

Ruimte's `FileLocation` contract carries a path, an optional one-based line and column, and an optional inclusive end line. A range needs a start line and cannot run backward. The `file.preview` action also accepts the owning `endpointId`, which it checks before opening a tab. It still accepts the legacy nullable line.

The chat adapter uses ADE CORE's complete `FileRef` and the rendering `ChatScope.id` it passes to `fileLinks.target` and `open`. Markdown links and timeline menus keep the source cwd and scope, mentions and subagent threads included. A missing scope is refused: neither rendering nor activation guesses the active machine or project. These hooks were published in [ADE CORE 0.20.1](https://github.com/basmilius/adecore/releases/tag/v0.20.1), which Ruimte's package manifests and lockfile pin.

Terminal file links resolve a relative path only with cwd metadata attached to their output. The daemon and the browser share `trackTerminalCwd` from the contracts package; the client imports it through `output-cwd.ts`. It reads OSC 7 file URIs and keeps at most 128 context transitions on xterm markers. Scrollback and reflow keep those transitions. Evicted context, malformed metadata, alternate output and ambiguous rewrites stay unknown. A cwd change within a wrapped logical line invalidates that line. Without a known cwd a relative path is not a link; an absolute path still is. This metadata does not authorize terminal input or bypass the file preview sandbox.

The integrated zsh emits its cwd on `preexec`, `precmd` and `chpwd`. It writes the markers synchronously to `/dev/tty`, so they stay in order even when a command redirects stdout and stderr. Without a reachable controlling terminal it emits no metadata and leaves redirected streams and the shell status alone. Subshell hooks emit unknown context and ignore TTOU only for that metadata write, so fully redirected background jobs can finish under `tostop`. The caller's signal handling, shell options and tty flags stay as they were, and ordinary background tty output still stops. After a cwd change in a subshell, relative links stay unavailable until a trusted foreground hook runs. Concurrent process output carries no per-process cwd.

An OSC 777 footer keeps bounded context metadata inside the existing snapshot string and its byte budget. A restored screen replays on its saved grid before reflow. Old snapshots and shells without the integration have no historical cwd to fall back on. The producer cannot see cwd changes inside external processes, or in shell code that suppresses, replaces or bypasses its hooks, such as `cd -q` and output from an earlier custom `chpwd` hook.

Real zsh and browser tests cover `cd`, late prompt-hook changes, escaped directory names, reconnect, snapshot restore at another grid and clear/resync. Click and menu go through the real preview, editor and transport to read different existing `same.ts` files and select the requested range. Redirected commands, blocks and functions also need fresh transport reads and correct full contents, and their output files contain no metadata. Separate regressions cover rewrites, wrapping and output through full scrollback. The combined shell and editor validation also covers directory changes and clear/resync with strict options in `.zshenv` and `.zshrc`. An independent review approved the consumer, shell and snapshot routes. File nodes that keep a location are separate follow-up work.

Run the cwd performance gate on its own, apart from the browser tests and typechecks:

```sh
bun --conditions=source apps/server/scripts/benchmark-output-cwd.ts \
    --warmup=1 --repetitions=3 --metadata=none,fixed,changing --enforce
```

Each case writes 50,000 rows after filling scrollback, in one burst or in 128-row chunks, and compares paired medians with absent, fixed and changing cwd metadata. The budget is twice the plain parser time plus 150 ms; the fixed allowance keeps timer noise from blowing up small baselines. The script also checks the retained output and that the cwd context is usable. This manual gate runs outside the default unit suite.
