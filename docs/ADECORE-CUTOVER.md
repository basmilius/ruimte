# Ruimte consuming Adecore

Ruimte now consumes the published Adecore `0.17.0-beta.1` packages. The manifests pin that version and `bun.lock` records the registry artifacts. Temporary links to the Adecore checkout have been replaced by the normal isolated Bun install.

The original shared implementations were removed on October 6 before manual testing, at Bas's request. This includes the former packages, PHP Rust workspace, old library publisher, superseded editor and tree files, and the unused Monaco engine. Commit `db8f1afee` retains the originals for comparison or rollback. Ruimte keeps its application adapters.

## Ownership

| Shared implementation                              | Adecore package                                         | Ruimte integration                                                                        |
| -------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Agent wire schemas                                 | `@adecore/agent-contracts`                              | Existing request/event tables in `@ruimte/contracts`.                                     |
| Agent runtimes and coordination                    | `@adecore/agents`                                       | Daemon providers, chat management, task adapters, persistence and application commands.   |
| Chat UI                                            | `@adecore/agents-react`                                 | `chat/host.ts`, `workspace-host.ts` and machine transports.                               |
| Document model, editor engine, LSP and language UI | `@adecore/editor-core`, `editor`, `lsp`, `editor-react` | `ruimte-project-language.ts`, `ruimte-editor-language.ts` and `RuimteLanguagePopups.tsx`. |
| Merge, drawing, diagram and plan                   | `@adecore/merge`, `drawing`, `diagram`, `plan`          | Product views, daemon stores and application wire envelopes.                              |
| FileTree and tree rows                             | `@adecore/ui`                                           | Files/search, Git changes and commit/change trees.                                        |
| Service managers                                   | `@adecore/service`                                      | `@ruimte/service/host` retains Ruimte's identity, environment and paths.                  |
| Native PHP language server                         | `@adecore/php-language-server`                          | Explicit source lookup and pinned release assets in the language host.                    |

UI, terminal and shell dependencies also use `0.17.0-beta.1`. The application npm workflow publishes only the launcher and platform binaries. Adecore owns library releases, model catalogs and pricing snapshots. The old library build files and placeholders have been removed.

## Compatibility retained by the adapters

Chat storage is configured with the `ruimte` namespace before the first store access. Existing draft, preference, stash and usage keys are preserved. Mention producers write both the new Adecore MIME type and the previous Ruimte type; receivers accept both.

The editor receives Ruimte's existing shortcut overrides and Shiki tokenizer. Ruimte keeps its daemon transport, document synchronization policy, machine-wide diagnostics, application navigation and AI actions. Ghost text takes Tab before the shared completion and snippet handlers. Shared language features, review rendering and attribution UI come from Adecore.

FileTree owns row rendering and generic interaction. Ruimte keeps listing caches, persisted expansion keys, filesystem/Git commands and staging. Staging uses accessible checkboxes. Decorations read the current application data so changing counts or branch names refresh without rebuilding the paths.

Drawing, diagram and plan host schemas add project/view/chat envelopes around the shared generic schemas. Schema comparisons preserve the existing constraints, request/event tables use the shared instances, and all 565 generated Swift wire models remain unchanged. The iOS document renderer was regenerated against the installed drawing package and its dependency license records.

The PHP npm version is `0.17.0-beta.1`; the native binary version remains `0.1.0`. `php-native-release.json` pins the published GitHub descriptor and checksums for Apple silicon, Linux arm64/x64 and Windows x64. Development can use the installed native sources or `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE`. Installation remains a person's action.

## Validation

Before source cleanup, the following checks passed against the published npm packages:

- Registry availability for all 21 release packages; every active direct Adecore dependency resolves inside Ruimte's npm install, with no Adecore checkout links.
- `bun install --frozen-lockfile`, all workspace typechecks, lint and generated Swift/renderer checks.
- 8,715 tests with no failures. Temporary Git fixtures ran with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` to isolate the machine's global commit-signing settings.
- Client, desktop and station builds, plus compilation and execution of the daemon's version command.
- Published export/asset resolution, including source and declaration targets, and compiled editor consumer execution under Node 22.23.3, Node 24.21.0 and Bun 1.4.2.
- An isolated DOM fixture under both source and compiled exports: old draft hydration and writes, pointer/Space staging, disabled controls and updated Git/commit decorations.
- All four PHP descriptor checksums matched GitHub asset digests. The macOS artifact also passed checksum verification, safe archive extraction and a real stdio initialize, UTF-8 negotiation, document-symbol, shutdown and exit sequence.
- Scoped formatting and whitespace checks.

TypeScript resolves Adecore's supported `source` condition. The shared base config also includes Bun's condition so unrelated dependencies that expose TypeScript sources continue to resolve their supported Bun entrypoint. Production compilation and separate consumer checks exercise the published default JavaScript exports.

Vite prebundles `.tsx` source exports so CommonJS dependencies of the shared React components reach the browser as ES modules. A clean-cache browser integration test boots the application and loads the Note view, which uses the shared Markdown component.

Detailed logs and executable fixtures are in `/private/tmp/ruimte-adecore-cutover-2026-10-05`.

After removing the old implementations, validation passed again:

- 6,382 tests across 620 files, with no failures. Shared package unit tests now belong to Adecore; application adapter tests and public-export consumer tests remain in Ruimte.
- Workspace typechecks, lint, formatting, generated Swift models and native document renderer checks. The generated wire models changed only their source-ownership comment.
- Client, desktop and station builds, plus the daemon compile with its native helpers and execution of `--version`.
- A browser boot and shared Markdown import with a fresh Vite cache, and durable save recovery after a killed process using the installed agent test fake.
- Six real PHP integration tests, covering installation from the installed Adecore sources, hover, completion, diagnostics and refactors through Ruimte's language host.
- Frozen-lockfile installation and all 29 direct Adecore dependency resolutions. No Adecore checkout links or old package dependencies remain. All 44 old alias probes failed to resolve; 17 dangling workspace links were removed.

The dev launch was restarted. Vite serves the client on `http://localhost:4212`, and the daemon's health endpoint responds on port 4211. Cleanup validation logs are in `/private/tmp/ruimte-cleanup-*`.

## Manual acceptance

Desktop interaction, visual and screen-reader acceptance still need evidence. Check file navigation and selection, staged/mixed Git controls, context menus and drags, editor typing/undo/search, language popups and the app's AI actions. Run this test round with the legacy source removed, so shared behavior is exercised through Adecore.

AfterMotion's consumer cutover is separate and has not been changed by this Ruimte refactor.
