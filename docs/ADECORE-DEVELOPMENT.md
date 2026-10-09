# Developing Ruimte with ADE CORE

Ruimte normally consumes the npm versions pinned in its package manifests and `bun.lock`. To work on the shared packages, switch to the ADE CORE folder beside Ruimte:

```sh
# Run once in ../adecore, and again when its dependencies change.
bun install --cwd ../adecore

# Run from Ruimte.
bun run adecore:link
bun dev
```

The default folder is `../adecore`, currently `~/Development/Projects/adecore`. Links point directly at its package folders. Uncommitted edits and whatever branch is open there are used immediately. The command does not select a commit, create a checkout or pull Git changes.

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

`adecore:npm` runs a frozen install of the declared versions. It does not upgrade to the latest registry release and works even if the local ADE CORE folder was moved or removed. Both switches leave package manifests and lockfiles unchanged. No local paths enter a commit.

Restart `bun dev` after either switch. The scripts clear Vite's dependency cache; running processes still need to start with the new package locations. `bun dev` prints a brief package-mode banner before starting the workspaces, so a return to npm is visible. A mixed or incomplete install prevents startup.

After changing a dependency, run `bun install` in the repository whose manifest changed, then run `adecore:link` in Ruimte again. An install in Ruimte restores npm packages, including when another agent runs it in the same checkout.

`adecore:status` lists every declared ADE CORE dependency by workspace, with its installed source. It exits unsuccessfully for missing packages, unexpected locations or a mixture of local and npm packages. `--npm` additionally requires the npm mode, so use it before a release or a final consumer validation.

In linked mode, full status also compares installed peer versions, plus shared runtime `zod` and `zustand`, including transitive ADE CORE packages. It advises on concrete differences between Ruimte and ADE CORE without failing the command or changing dedupe. Electron differences concern types because the desktop bundler keeps its runtime external. Missing or equal peer versions produce no drift advice; this is not a peer-range compatibility check. `adecore:status --brief` prints only the startup banner.

## Source changes

The Vite client, development daemon, desktop bundler, Pulsar development worker, daemon compiler, TypeScript checks and Bun tests select ADE CORE's `source` exports. You do not need to build ADE CORE between changes to imported TypeScript. Vite keeps one instance of React, i18next, CodeMirror and Lezer when the library has its own dependencies installed. The linked composer and the app's dictation extensions must use the same CodeMirror classes, including when Vite serves their sources without prebundling.

The client, desktop and daemon release builders deliberately keep the source condition. Consumer validation in npm mode bundles the TypeScript sources shipped in the published packages; it does not validate their JavaScript `dist` as Ruimte's runtime input. ADE CORE CI builds the packages and runs `test:pack` to check packed default (`dist`) and source exports and execute their consumers. Pulsar's production deploy keeps Wrangler's default conditions and uses the published default exports.

Vite updates the client while it runs. The daemon runs with Bun's watch mode. The desktop main process is bundled at startup; restart it after changing `@adecore/shell` or desktop service code. A new file, new export or dependency change may also require a restart. Tools outside this source-configured flow can use compiled `dist` exports and require `bun run build` in ADE CORE.

### Tailwind linked sources

The development plugin in `apps/client/adecore-sources.ts` resolves ADE CORE's `@source` directives to real filesystem paths before Tailwind scans them. This makes the stylesheet dependencies match Vite's linked modules. It also watches those source directories and includes their stylesheet in HMR for new or unloaded files. The committed CSS paths and production build are unchanged.

The link command discovers consumers from Ruimte's workspaces and dependencies from ADE CORE's workspaces. It checks that shared dependencies such as editor-core resolve inside the same local folder before changing consumer links. A failed link operation restores the consumer aliases it started with.

The script replaces installed package symlinks directly. Bun 1.4.2's `bun link` inside a Ruimte consumer fails to resolve that consumer's `workspace:*` dependencies. Direct links avoid that installer path and global package registrations.

## PHP language server

The PHP language server lives in `basmilius/language-server-php` and is independent of the ADE CORE packages. The link script switches every declared `@adecore/*` consumer; PHP is no longer one of them.

For PHP development, place an existing checkout at `../language-servers/php` beside Ruimte, or set `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE=/path/to/php`. A Ruimte worktree also discovers the sibling of its primary checkout. Install builds that checkout with Cargo. The locator never creates or updates a Git checkout. Without valid local sources, the daemon uses the pinned native release; a compiled daemon always uses that release. See [the daemon README](../apps/server/README.md#language-servers) for the descriptor and install behavior.

For SQL development, the same holds for `basmilius/language-server-sql`: place its checkout at `../language-servers/sql` beside Ruimte, or set `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE=/path/to/sql`, and Install builds it with Cargo.

## Work across the repositories

Fix shared behavior in the ADE CORE folder and application behavior in Ruimte. Edit a shared repository only through its real filesystem path, never through `node_modules`, and only when the task authorizes changes there. A link changes package resolution; it grants neither task authorization nor filesystem permissions.

Validate the shared change in ADE CORE and then in linked Ruimte. Linked checks do not prove that Ruimte CI can use the registry versions. Publish ADE CORE first. Push Ruimte code that uses a new ADE CORE API only together with the dependency bump to that published version in its manifests and `bun.lock`, after `adecore:npm`, `adecore:status --npm` and the relevant npm consumer checks are green. This workflow does not require a pre-push hook. Each repository keeps its own commits and release history.

## File location links and shell cwd

Ruimte's `FileLocation` contract carries a path, optional one-based line and column, and
an optional inclusive end line. A range requires a start line and cannot run backward.
The `file.preview` action also accepts the owning `endpointId`, checked before opening
a tab. Its legacy nullable line remains accepted.

The chat adapter uses ADE CORE's complete `FileRef` and the rendering `ChatScope.id`
passed to `fileLinks.target` and `open`. Markdown links and timeline menus retain the
source cwd and scope, including mentions and subagent threads. A missing scope is
refused; neither rendering nor activation guesses the active machine or project.
These hooks are published in
[ADE CORE 0.20.1](https://github.com/basmilius/adecore/releases/tag/v0.20.1), pinned
in Ruimte's package manifests and lockfile.

Terminal file links resolve relative paths only with cwd metadata attached to their
output. The daemon and browser share `trackTerminalCwd` from the contracts package;
the client imports it through `output-cwd.ts`. It consumes OSC 7 file URIs and retains
at most 128 context transitions using xterm markers. Scrollback and reflow preserve
those transitions; evicted context, malformed metadata, alternate output and ambiguous
rewrites remain unknown. A cwd change within a wrapped logical line invalidates that
line. Without a known cwd, relative paths are not links; absolute paths remain usable.
This metadata does not authorize terminal input or bypass the file preview sandbox.

The integrated zsh emits cwd on `preexec`, `precmd` and `chpwd`. It writes markers
synchronously to `/dev/tty`, preserving their order even when a command redirects
stdout and stderr. Without a reachable controlling terminal, it emits no metadata
and leaves redirected streams and shell status intact. Subshell hooks emit unknown
context and ignore TTOU only for that metadata write, so fully redirected background
jobs can finish under `tostop`. The caller's signal handling, shell options and tty
flags remain intact; ordinary background tty output still stops. Relative links
after a subshell cwd change remain unavailable until a trusted foreground hook runs.
Concurrent process output has no per-process cwd provenance.

An OSC 777 footer preserves
bounded context metadata inside the existing snapshot string and its byte budget.
Restored screens replay on their saved grid before reflow. Old snapshots and
shells without integration have no historical cwd fallback. The producer cannot
observe cwd changes inside external processes or shell code that suppresses, replaces
or bypasses its hooks, including `cd -q` and output from an earlier custom `chpwd` hook.

Real zsh/browser tests cover `cd`, late prompt-hook changes, escaped directory names,
reconnect, snapshot restore at another grid and clear/resync. Click and menu use the
real preview, editor and transport to read different existing `same.ts` files and
select the requested range. Redirected commands, blocks and functions also require
fresh transport reads and correct full contents; their output files contain no
metadata. Separate regressions cover rewrites, wrapping and output
through full scrollback. Combined shell-editor validation also covers directory
changes and clear/resync with strict options in `.zshenv` and `.zshrc`. Independent
review approved the consumer, shell and snapshot routes. File nodes retaining
locations remain separate follow-up work.

Run the independent cwd performance gate separately from browser tests and typechecks:

```sh
bun --conditions=source apps/server/scripts/benchmark-output-cwd.ts \
    --warmup=1 --repetitions=3 --metadata=none,fixed,changing --enforce
```

Each case writes 50,000 rows after filling scrollback, in one burst or 128-row chunks.
It compares paired medians with absent, fixed and changing cwd metadata. The budget
is twice the plain parser time plus 150 ms; the fixed allowance prevents small
baselines from amplifying timer noise. The script also checks retained output and
usable cwd context. This manual gate runs outside the default unit suite.
