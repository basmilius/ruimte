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

The Vite client, development daemon, desktop bundler, Pulsar development worker, daemon compiler, TypeScript checks and Bun tests select ADE CORE's `source` exports. You do not need to build ADE CORE between changes to imported TypeScript. Vite keeps one React and i18next instance when the library has its own dependencies installed.

The client, desktop and daemon release builders deliberately keep the source condition. Consumer validation in npm mode bundles the TypeScript sources shipped in the published packages; it does not validate their JavaScript `dist` as Ruimte's runtime input. ADE CORE CI builds the packages and runs `test:pack` to check packed default (`dist`) and source exports and execute their consumers. Pulsar's production deploy keeps Wrangler's default conditions and uses the published default exports.

Vite updates the client while it runs. The daemon runs with Bun's watch mode. The desktop main process is bundled at startup; restart it after changing `@adecore/shell` or desktop service code. A new file, new export or dependency change may also require a restart. Tools outside this source-configured flow can use compiled `dist` exports and require `bun run build` in ADE CORE.

### Tailwind linked-source validation

The development plugin in `apps/client/adecore-sources.ts` resolves the three ADE CORE `@source` directives to real filesystem paths before Tailwind scans them. This makes the stylesheet dependencies match Vite's linked modules. It also watches those source directories and includes their stylesheet in HMR for new or unloaded files. The committed CSS paths and production build are unchanged.

`apps/client/tailwind.integration.test.ts` uses temporary ADE CORE package folders linked through the same `@source` paths as `styles.css`. It verifies the initial utilities from `ui`, `agents-react` and `editor-react`, CSS HMR after source edits, and discovery of a new source file. The assertions inspect HMR messages and the served CSS without editing the shared checkout.

The link command discovers consumers from Ruimte's workspaces and dependencies from ADE CORE's workspaces. It checks that shared dependencies such as editor-core resolve inside the same local folder before changing consumer links. A failed link operation restores the consumer aliases it started with.

The script replaces installed package symlinks directly. Bun 1.4.2's `bun link` inside a Ruimte consumer fails to resolve that consumer's `workspace:*` dependencies. Direct links avoid that installer path and global package registrations.

## PHP language server

The PHP language server lives in `basmilius/language-server-php` and is independent of the ADE CORE packages. The link script switches every declared `@adecore/*` consumer; PHP is no longer one of them.

For PHP development, place an existing checkout at `../language-server-php` beside Ruimte, or set `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE=/path/to/language-server-php`. A Ruimte worktree also discovers the sibling of its primary checkout. Install builds that checkout with Cargo. The locator never creates or updates a Git checkout. Without valid local sources, the daemon uses the pinned native release; a compiled daemon always uses that release. See [the daemon README](../apps/server/README.md#language-servers) for the descriptor and install behavior.

## Work across the repositories

Fix shared behavior in the ADE CORE folder and application behavior in Ruimte. Edit a shared repository only through its real filesystem path, never through `node_modules`, and only when the task authorizes changes there. A link changes package resolution; it grants neither task authorization nor filesystem permissions.

Validate the shared change in ADE CORE and then in linked Ruimte. Linked checks do not prove that Ruimte CI can use the registry versions. Publish ADE CORE first. Push Ruimte code that uses a new ADE CORE API only together with the dependency bump to that published version in its manifests and `bun.lock`, after `adecore:npm`, `adecore:status --npm` and the relevant npm consumer checks are green. This workflow does not require a pre-push hook. Each repository keeps its own commits and release history.
