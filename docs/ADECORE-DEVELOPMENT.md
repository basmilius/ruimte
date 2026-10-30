# Developing Ruimte with ADE CORE

Ruimte uses the npm versions pinned in its manifests and `bun.lock`. To work on the shared packages, link the ADE CORE folder beside Ruimte:

```sh
# Once in ../adecore, and again when its dependencies change.
bun install --cwd ../adecore
# Once on a fresh clone, too: the client's `vite.config.ts` loads a package's `dist`.
bun run --cwd ../adecore build

# From Ruimte.
bun run adecore:link
bun dev
```

The default folder is `../adecore` (`~/Development/Projects/adecore`). Links point at its package folders, so Ruimte sees uncommitted edits and whatever branch is checked out. The command never selects a commit, creates a checkout or pulls. For another location, pass an absolute path or one relative to Ruimte:

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

`adecore:npm` runs a frozen install of the declared versions. It never upgrades, and it works when the local folder moved or is gone. Neither switch changes a manifest or lockfile, so no local path reaches a commit.

Restart `bun dev` after either switch; running processes only see the new locations after a restart. `bun dev` prints a package-mode banner and refuses to start on a mixed or incomplete install.

After a dependency change, run `bun install` in the repository whose manifest changed, then `adecore:link` in Ruimte again. Any install in Ruimte restores the npm packages, also one another agent runs in the same checkout.

`adecore:status` lists every declared ADE CORE dependency per workspace with its source, and fails on missing packages, unexpected locations or a mix of local and npm. `--npm` also requires npm mode; use it before a release or a final consumer check. In linked mode it also compares installed peer versions and the shared `zod` and `zustand`, transitive ADE CORE packages included, and reports differences without failing. This is no peer-range check. Electron differences only affect types, since the desktop bundler keeps Electron external. `--brief` prints only the banner.

## Taking a new ADE CORE release

```sh
bun run adecore:npm
bun run adecore:bump 0.24.0
```

`adecore:bump` sets every `@adecore/*` entry in every manifest and dependency section to the version, runs `bun install` and then `adecore:status --npm`.

- Every entry must be an exact version. A range or `workspace:` entry stops it before any change.
- A failed install restores the manifests and `bun.lock`.
- It fails, leaving the files in place, when an entry was missed: a manifest pin on another version, a package in `bun.lock` on another version (ADE CORE releases every package under one version, so that means two copies), or an installed package that differs from its pin.
- It refuses a linked checkout and names the linked package. Switch with `adecore:npm`, bump, then `adecore:link` to go on locally.

Commit the manifests and `bun.lock` together.

## Source changes

The Vite client, the development daemon, the desktop bundler, the Pulsar development worker, the daemon compiler, the TypeScript checks and the Bun tests all use ADE CORE's `source` exports, so ADE CORE needs no build between changes. Vite keeps one instance of React, i18next, CodeMirror and Lezer when the library has its own dependencies installed. The linked composer and the app's dictation extensions must share the same CodeMirror classes.

The source condition skips the React Compiler output in ADE CORE's `dist`. So the client compiles their `src` itself, linked or installed (`apps/client/react-compiler.ts`); the DOM and browser tests do too, the unit run does not. `optimizeDeps.exclude` keeps Vite from pre-bundling them, and their sources are dependency-scan entries so the first start does not reload. The compiler runs on worker threads and caches under Vite's cache folder (`apps/client/react-compiler-vite.ts`, `react-compiler-cache.ts`); CI keeps that folder between runs.

The client, desktop and daemon release builders keep the source condition on purpose. npm-mode consumer checks bundle the TypeScript sources of the published packages, not their `dist`. ADE CORE CI builds the packages and runs `test:pack`, which checks the packed `dist` and source exports and their consumers. Pulsar's production deploy uses Wrangler's default conditions and the published default exports.

Vite updates the client live and the daemon runs in Bun's watch mode. The desktop main process is bundled at startup, so restart after changing `@adecore/shell` or desktop service code. A new file, export or dependency may also need a restart. Tools outside this flow use `dist` and need `bun run build` in ADE CORE.

### Linking details

`apps/client/adecore-sources.ts` resolves ADE CORE's Tailwind `@source` directives to real paths before Tailwind scans them, watches those folders and includes their stylesheet in HMR. Committed CSS paths and the production build stay the same.

The link command finds consumers in Ruimte's workspaces and dependencies in ADE CORE's. It checks that shared dependencies such as editor-core resolve inside the same local folder before it changes links, and a failed link restores the previous aliases. It replaces the package symlinks itself, because Bun 1.4.2's `bun link` cannot resolve a consumer's `workspace:*` dependencies.

## Language servers

The PHP and SQL language servers are separate repositories, outside the ADE CORE link. `apps/server/src/language/CLAUDE.md` says how a development daemon finds their sources; [the daemon README](../apps/server/README.md#language-servers) covers the pinned release and Install.

## Work across the repositories

Fix shared behavior in ADE CORE and application behavior in Ruimte. Edit a shared repository only through its real path, never through `node_modules`, and only when the task authorizes it. A link changes resolution; it grants no authorization or file permission.

Validate a shared change in ADE CORE first, then in linked Ruimte. Linked checks do not prove that Ruimte CI can use the registry versions. Publish ADE CORE first. Push Ruimte code that uses a new ADE CORE API only together with the bump to that published version in its manifests and `bun.lock`, after `adecore:npm`, `adecore:status --npm` and the relevant npm consumer checks pass. No pre-push hook is required. Each repository keeps its own commits and release history.

## Asking ADE CORE for a change

UI that knows nothing of Ruimte belongs in `basmilius/adecore`, and so does a fix to it. Never copy a shared implementation into Ruimte. When Ruimte needs something the library lacks or draws wrong, open an issue there:

```sh
gh issue create --repo basmilius/adecore --title "<Component>: <the need>" --label Ruimte --label Bug   # or Enhancement
```

The body has three sections:

- `## Problem`: what is missing or wrong, the call sites in Ruimte as `path:line`, and how Ruimte works around it today.
- `## Wish`: the need as what a person does or sees, not a fix. A proposed API is optional.
- `## Impact on AfterMotion`: search `../aftermotion` for the same component or pattern. Name the call sites a change would touch and whether it would change what they draw or break them, or say there are none.
