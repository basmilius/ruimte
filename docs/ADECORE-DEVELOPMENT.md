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

## Taking a new ADE CORE release

```sh
bun run adecore:npm
bun run adecore:bump 0.24.0
```

`adecore:bump` sets every `@adecore/*` entry in the root and workspace manifests to the given version, in every dependency section, then runs `bun install` and the check of `adecore:status --npm`. Every entry has to be an exact version; a range or a `workspace:` entry stops it before any manifest changes. When the install fails, the manifests and `bun.lock` go back to what they were.

It fails when an entry was missed: a manifest pin that is not on the new version, a package in `bun.lock` that is (ADE CORE releases every package under one version, so a transitive package on another version means two copies of it), or an installed package that is not the npm version its manifest pins. It leaves the files in place then, so you can see what went wrong.

A linked checkout is refused, with the package that is linked. `bun install` resolves the declared versions and so ends every link, and the check after it has to see the registry packages. Switch with `adecore:npm` first, bump, and run `adecore:link` again to continue on the local folder. Commit the manifests and `bun.lock` together.

## Source changes

The Vite client, the development daemon, the desktop bundler, the Pulsar development worker, the daemon compiler, the TypeScript checks and the Bun tests all select ADE CORE's `source` exports, so there is no need to build ADE CORE between changes to imported TypeScript. Vite keeps one instance of React, i18next, CodeMirror and Lezer when the library has its own dependencies installed. The linked composer and the app's dictation extensions must use the same CodeMirror classes, also when Vite serves their sources without prebundling.

ADE CORE compiles the `dist` of its React packages (UI, Terminal, Agent views, Editor views) with the React Compiler, and the source condition skips that `dist`. So the client runs the same compiler over their `src`, linked or installed, beside its own source (`apps/client/react-compiler.ts`), and so do the client's DOM and browser tests; the unit run leaves it out, since it renders only to static markup. Installed from npm, Vite would pre-bundle them, which runs no plugin over them; `optimizeDeps.exclude` serves them as modules, the way a linked checkout is served. Their sources are entries of the dependency scan, so the first start bundles what they import at once instead of reloading the page. Under `bun dev`, in a build and in those tests the compiler runs on worker threads and keeps what it made under Vite's cache folder (`apps/client/react-compiler-vite.ts`, `react-compiler-cache.ts`), so a restart, a build or a test run compiles only what changed; CI keeps that folder between runs.

The client, desktop and daemon release builders keep the source condition on purpose. Consumer validation in npm mode bundles the TypeScript sources shipped in the published packages; it does not validate their JavaScript `dist` as Ruimte's runtime input. ADE CORE CI builds the packages and runs `test:pack`, which checks the packed default (`dist`) and source exports and runs their consumers. Pulsar's production deploy keeps Wrangler's default conditions and uses the published default exports.

Vite updates the client while it runs, and the daemon runs in Bun's watch mode. The desktop main process is bundled at startup, so restart it after changing `@adecore/shell` or desktop service code. A new file, a new export or a dependency change may also need a restart. Tools outside this source-configured flow use the compiled `dist` exports and need `bun run build` in ADE CORE.

### Tailwind linked sources

The development plugin in `apps/client/adecore-sources.ts` resolves ADE CORE's `@source` directives to real filesystem paths before Tailwind scans them, so the stylesheet dependencies match Vite's linked modules. It also watches those source directories and includes their stylesheet in HMR for new or unloaded files. The committed CSS paths and the production build stay the same.

The link command finds consumers in Ruimte's workspaces and dependencies in ADE CORE's workspaces. Before it changes a consumer's links, it checks that shared dependencies such as editor-core resolve inside the same local folder. A failed link restores the consumer aliases it started with.

The script replaces the installed package symlinks itself. Bun 1.4.2's `bun link` inside a Ruimte consumer cannot resolve that consumer's `workspace:*` dependencies, and direct links avoid both that installer path and global package registrations.

## Language servers

The PHP and SQL language servers live in repositories of their own and are no part of the ADE CORE link. `apps/server/src/language/CLAUDE.md` says how a development daemon finds their sources, and [the daemon README](../apps/server/README.md#language-servers) covers the pinned release and how Install works.

## Work across the repositories

Fix shared behavior in the ADE CORE folder and application behavior in Ruimte. Edit a shared repository only through its real filesystem path, never through `node_modules`, and only when the task authorizes changes there. A link changes package resolution; it grants neither task authorization nor filesystem permissions.

Validate a shared change in ADE CORE first and then in linked Ruimte. Linked checks do not prove that Ruimte CI can use the registry versions. Publish ADE CORE first. Push Ruimte code that uses a new ADE CORE API only together with the dependency bump to that published version in its manifests and `bun.lock`, after `adecore:npm`, `adecore:status --npm` and the relevant npm consumer checks are green. No pre-push hook is required. Each repository keeps its own commits and release history.

## Asking ADE CORE for a change

UI that knows nothing of Ruimte belongs in `basmilius/adecore`, and so does a fix to it. Never copy a shared implementation into Ruimte. When Ruimte needs something the library lacks or draws wrong, open an issue there:

```sh
gh issue create --repo basmilius/adecore --title "<Component>: <the need>" --label Ruimte --label Bug   # or Enhancement
```

The body has three sections:

- `## Problem`: what is missing or wrong, the call sites in Ruimte as `path:line`, and how Ruimte works around it today.
- `## Wish`: the need as what a person does or sees, not a fix. A proposed API is optional.
- `## Impact on AfterMotion`: search `../aftermotion` for the same component or pattern. Name the call sites a change would touch and whether it would change what they draw or break them, or say there are none.
