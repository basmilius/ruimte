# Moving shared modules to Adecore

The inventory and extraction plan below record the starting state. Current consumers use the published Adecore packages, and the original sources were removed before manual testing on October 6, 2026. See [the cutover record](ADECORE-CUTOVER.md).

Inventory and migration proposal, October 5, 2026.

Adecore should own the modules shared by development apps. Ruimte and AfterMotion should consume its published packages, supply their own adapters and own their product behavior. A shared module must build and be usable without a checkout of either app.

The original implementation stays in Ruimte until Ruimte has completely switched to the Adecore replacements and the complete migration has passed validation. Creating, building or locally testing a replacement package alone does not authorize deleting its original source. Extraction and source cleanup are separate steps.

The user initially deferred the editor and PHP language server, then authorized transferring their current implementations as well. Their known limits and remaining feature work carry over to Adecore. The source retention and complete application validation requirement still applies.

This inventory covers the local Ruimte, AfterMotion and Adecore checkouts, the file tree request in [Adecore issue #32](https://github.com/basmilius/adecore/issues/32), and the corresponding tree in Command Center. The Adecore checkout lives at `/Users/bas/Development/Projects/@basmilius/desktop`. The inventory records the starting point of the extraction; the final section and [consumer cutover](ADECORE-CUTOVER.md) record what has since changed.

## What already exists

At the start of the inventory, Ruimte consumed `@adecore/ui`, `@adecore/terminal` and `@adecore/shell` at `^0.15.0`. Adecore also owns `@adecore/database`, including its Rust helper and platform binary packages. These establish the publishing, theme and native binary patterns to extend.

The agent implementation is already split into three packages. Their current interfaces include `ChatCore`, `AgentHost`, `FramePort`, `ChatTransport`, `ChatScope` and the application's `ChatHost` adapter. Existing tests prohibit app imports in the backend and React packages, prohibit the full Ruimte wire contract there, and prohibit Bun APIs in backend implementation code. This makes their move mostly a packaging and consumer migration, with a few remaining app assumptions to address.

The editor is also split, but only at its lower layers. Moving its three packages alone would leave much of the working editor experience in Ruimte.

| Current module               | Source files | Test files | Initial destination        |
| ---------------------------- | -----------: | ---------: | -------------------------- |
| `packages/agent-contracts`   |           13 |          3 | `@adecore/agent-contracts` |
| `packages/agents`            |          105 |         60 | `@adecore/agents`          |
| `packages/agents-react`      |          163 |         65 | `@adecore/agents-react`    |
| `packages/smart-editor-core` |           25 |         27 | `@adecore/editor-core`     |
| `packages/smart-editor`      |           34 |         22 | `@adecore/editor`          |
| `packages/smart-editor-lsp`  |           15 |         10 | `@adecore/lsp`             |
| `packages/merge`             |            5 |          2 | `@adecore/merge`           |

Counts cover `.ts` and `.tsx` files under each package's `src`, including support code and fixtures. They describe the amount of code to transfer, not a test result or an estimate of effort.

AfterMotion's manifests are behind Ruimte's current shared implementation. Its client uses `@basmilius/desktop-ui` at `^0.9.0`, its desktop shell uses `@basmilius/desktop-shell` at `^0.8.0`, and its three agent dependencies are at `^0.9.3`. It does not yet consume the Adecore names. This contradicts some newer descriptions of the shared architecture; the migration must use the manifests and actual call sites as its starting point.

The old UI name occurs in 95 AfterMotion client source files. The old shell name occurs in two desktop source files and four desktop bridge source files. Agent package references occur in 52 app files for contracts, 104 for the backend and 37 for React, including scripts and tests. Some files use more than one package.

## Package ownership

| Module in Ruimte     | Recommendation                                                       | Work needed                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-contracts`    | Move first.                                                          | Rename package references and publish all existing subpaths. Preserve frame shapes, ids and the agent schema tables.                                                                                                                                           |
| `agents`             | Move with contracts.                                                 | Carry providers, chat, accounts, usage, outbox, tasks, lineage, messaging, context verb machinery and the helpers already used by both apps. Keep application authorization, project placement and product prompts in adapters.                                |
| `agents-react`       | Move with the agent family.                                          | Carry chat, composer, approvals, questions, providers, usage, translations, CSS and test support. Preserve its current host and transport interfaces during the first move.                                                                                    |
| `smart-editor-core`  | Move as editor core.                                                 | Preserve document behavior, tests, benchmarks and Apache provenance files. It has no runtime dependencies.                                                                                                                                                     |
| `smart-editor`       | Move as the editor.                                                  | Supply complete default CSS tokens, separate app shortcut choices and publish CSS, the Shiki adapter, keymap and fake. The engine already takes its tokenizer and host callbacks.                                                                              |
| `smart-editor-lsp`   | Move as a generic LSP package.                                       | Preserve the DOM-free client, `LanguageService`, transports, framing, Vue support and `/testing`. It spawns no process and needs no runtime dependency.                                                                                                        |
| `merge`              | Move alongside editor work.                                          | Package the pure diff and conflict algorithms and their tests. There are no app or runtime dependencies. Conflict persistence, Git commands and AI decisions stay in Ruimte.                                                                                   |
| `drawing`, `diagram` | Extract after their schemas are separated.                           | Move drawing and diagram shapes out of `@ruimte/contracts` into the relevant generic modules. Ruimte re-exports or embeds those schemas in its wire tables. Move geometry, SVG output, layout and reading order first; React editing can follow separately.    |
| `plan`               | Candidate for a later extraction.                                    | Its tree, markdown and permissions currently use types and schemas from Ruimte contracts. Give the module ownership of those shapes before publishing. Compare its actual needs with AfterMotion's storyboard model before trying to share one implementation. |
| `service`            | Extract only the generic OS managers if another app needs them.      | The launchd/systemd machinery is reusable, but service names, log paths, `RUIMTE_HOME`, executable placement and the daemon specification are Ruimte's. AfterMotion deliberately has no background daemon.                                                     |
| `actions`            | Keep the app catalog in Ruimte.                                      | It directly names canvas, views, devices, Git, plans and other Ruimte concepts. A generic registry may become reusable; moving the whole package would export the application's domain model.                                                                  |
| `contracts`          | Keep as Ruimte's wire composition.                                   | Consume Adecore agent contracts and future drawing/diagram/plan schemas. Preserve the request/event ordering used by Swift generation.                                                                                                                         |
| `desktop-bridge`     | Keep the app bridge.                                                 | Continue using `@adecore/shell/bridge` for shared shell shapes. Ruimte's channels and its voice and machine data remain application-specific.                                                                                                                  |
| `csp`                | Keep Ruimte's policy.                                                | The current directives reflect its machine connections and content sources. A generic serializer can live in shell if useful; the complete policy belongs to the app.                                                                                          |
| `pulsar`             | Keep product-specific trust and account behavior for this migration. | Generic signaling or framing could move later. Do not make the address book, broker deployment or Ruimte's authentication rules prerequisites for agents or editors.                                                                                           |
| `editor`             | Retire the old Monaco package after acceptance of the new editor.    | The active loader uses `smart-editor`; no application call to `loadMonacoEngine` was found. The manifest dependency and legacy tests remain. Check the intended fallback before removing them; there is no reason to publish two editor engines now.           |
| `npm`                | Keep launcher and platform packaging in Ruimte.                      | Remove its shared-library build and publication responsibilities after both consumers migrate. Preserve publication of the `ruimte` CLI and daemon binaries.                                                                                                   |

Ruimte keeps its canvas, views, machine transport, session ownership, project persistence, Git execution and application menus. Its branding and product screens also remain there. Existing speech, computer-use and device helpers require their own extraction study if they become shared; they are outside the first package migration.

## File tree and shared tree rows

[Issue #32](https://github.com/basmilius/adecore/issues/32) proposes two reusable modules in `@adecore/ui`: a file tree around `@pierre/trees`, and the row appearance usable by other tree implementations.

The current Ruimte call sites are:

- [FilesPanel](../apps/client/src/shell/panels/FilesPanel.tsx), with separate models for directory contents and search results.
- [GitFileList](../apps/client/src/shell/panels/GitFileList.tsx), with change decorations and staging checkboxes.
- [CommitFileTree](../apps/client/src/shell/panels/CommitFileTree.tsx), with commit change counts.

The shared implementation is spread across [panel-tree.ts](../apps/client/src/shell/panels/panel-tree.ts), [use-panel-tree-shift.tsx](../apps/client/src/shell/panels/use-panel-tree-shift.tsx), [panel-tree-shift.ts](../apps/client/src/shell/panels/panel-tree-shift.ts) and [styles.css](../apps/client/src/styles.css). It includes the 25px rows, 12px chevron, end truncation, theme mapping, selection and focus helpers, flattened-folder handling, sideways scrolling and workarounds for the current tree version.

The shared interface needs paths, expansion, selection, activation, lazy-loading hooks, icons, drag/drop and context-menu hooks, and row decorations. Decorations must support actual controls and their accessible interaction. Both Ruimte's staging boxes and Command Center's viewed boxes currently work around the lack of a checkbox slot by encoding a box into decorations and recognizing it through shadow DOM styles.

The row appearance must also be usable by `@adecore/database`'s `DatabaseExplorer`, which currently draws its own rows with matching hover, selection, corners and indentation. Share the row implementation or its internal styling rules without making a database tree pretend to be a file tree. Following Adecore's existing conventions, avoid exporting raw class strings for apps to assemble.

Ruimte retains directory listing, searching, creating entries, filesystem changes and Git operations. Inspect `files-tree.ts` and `git-tree.ts` function by function: folding and path normalization can be generic, while change grouping and staging rules belong to the app. Command Center retains findings and viewed state. AfterMotion currently has no tree consumer.

Acceptance requires the Files, search, changes and commit trees to retain keyboard interaction, multiselection, long-path readability, decorations and drag/drop. Database rows and Command Center's checkbox tree should exercise the same appearance and control slots.

## A complete reusable editor

The three existing packages provide the document model, DOM editor and LSP client. Ruimte's [language folder](../apps/client/src/language) still contains 84 non-test source files, and [editor-ai](../apps/client/src/editor-ai) another 34. These include both reusable behavior and application adapters.

Introduce `@adecore/editor-react` for the reusable language features and React surfaces. Keep its internal feature coordinator together initially; a separate package for every feature would add interfaces without helping consumers.

| Move into reusable editor modules                                                                                        | Keep in Ruimte or supply through adapters                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Completion models, snippets, hover, signature help, diagnostics, semantic tokens, inlays and folding.                    | `WireLanguageService`, machine transport, stored-path resolution and language-server configuration on a machine.                  |
| Completion and hover popups, signature card, rename UI, symbol picker, peek layout, placement and find/replace controls. | Opening a file in a panel, canvas or view; application navigation and focus routing.                                              |
| Generic navigation, references, rename and workspace-edit planning.                                                      | Reading/writing files and applying multi-file changes through the authorized app host.                                            |
| Editor mounting, view-state primitives, generic problem models and language feature coordination.                        | Draft ownership, saving, conflict persistence, project lifetime, settings storage and the app's menus.                            |
| Generic inline proposal, change review and attribution display, once their inputs are explicit.                          | Creating agent chats, finding the responsible agent, provenance requests, Git blame and applying or accepting an agent's changes. |

The first interface should take an `Editor`, a `LanguageService` and the host operations these features actually call. The app supplies file access, navigation, workspace-edit application, messages, notifications and optional AI actions. Current `EditorLanguage` and `ProjectLanguage` mix those needs with app imports, so copying the entire folder into Adecore would not establish the required seam.

There are two concrete editor dependencies to remove:

1. `editor.css` reads tokens defined by Ruimte, including `--editor-*`, `--find-*` and `--agent-ink`. Publish defaults with the owning modules so a minimal Adecore example renders correctly. Ruimte should only override the values it intentionally changes.
2. `keymap-table.ts` embeds Ruimte's shortcut collisions, including sidebar, panel, close-cell and voice commands. Adecore should define the editor commands and default keys; Ruimte should supply its collision overrides. Menus, command handlers and shortcut hints must use the same resolved table.

The current editor exposes generic markers, widgets, ghost text and attribution already. Keep those capabilities in Adecore even while the first AI orchestration adapters stay in Ruimte. Later, a shared AI editor feature can depend on the Adecore agent packages without depending on a Ruimte chat or project.

Known editor limitations belong in the package docs and acceptance evidence. The current view has no bidirectional text support and limited screen-reader verification. Extraction must preserve the current behavior; it does not establish that those features have been completed.

## Agent migration and compatibility

Move the current three agent packages together and preserve their existing subpaths for the initial release. AfterMotion imports many internal-looking paths, including `fs`, `serializer`, `record-directory`, `client-sinks`, `watch-seam`, outbox and task modules. They are already a consumer interface. Narrowing that interface should be a later change with its own migration notes.

Address these remaining assumptions deliberately:

- React persistence uses `ruimte.chat.drafts`, `ruimte.chat.stash`, `ruimte.chat.preferences` and `ruimte.usage`. Give the host a storage namespace or adapter. Preserve or migrate each app's existing records so a package rename does not discard unsent prompts and preferences.
- Several of those stores read browser storage during module initialization. Adecore's current convention requires initialization to happen explicitly or on first use. Arrange hydration after the host supplies its storage configuration, with the same fallback when storage is unavailable.
- File mentions use `application/x-ruimte-mention`. Publish a neutral drag format and update both producer and consumer together, with transitional support if needed.
- `cliEnvironment` removes inherited `RUIMTE_*` hook and context variables. The protection is still useful when an app starts inside a Ruimte terminal. Make the policy reusable while retaining the current removal behavior; a simple rename would reintroduce inherited sessions.
- Keep app-specific task words, permission decisions, placement and context CLI verbs in the host. Preserve generic task coordination, lineage, messaging and durable work in the backend package.
- Keep `ChatHost`, lazy-loading hooks, `ChatScope` and transport injection. Do not redesign their global configuration during the package move; any change to support multiple independently configured instances deserves separate validation.

Ruimte's `contracts` already composes the agent schema tables. Change their source to Adecore while preserving frame names and persisted shapes. A package namespace change by itself does not require a wire protocol bump. Run the Swift generation checks to verify that the change did not reorder or otherwise change generated models.

AfterMotion must update its UI and shell baseline as well as the agent names. Its installed `0.9.3` agent packages precede the current extracted messaging and lifecycle work, so distinguish the package move from behavior upgrades. Audit its current outbox, notices, tasks and child-ending adapters against the transferred version and remove duplicate generic implementations only once equivalent behavior is verified.

Old `@ruimte/*` releases should remain available. Publish and validate the Adecore packages, then migrate both apps. Deprecated old names with migration guidance are enough for these consumers; add forwarding packages only if other users need a compatibility period.

## PHP language server

The current PHP implementation is now authorized for transfer. At the handoff, Ruimte's editor and PHP source tree is clean, with source revision `9729144f0df3f25628f20cc283dee54f8d9e8162`. Transfer that implementation and record its revision; preserve its known remaining work. The original source stays in Ruimte until the complete application cutover passes validation.

The [Cargo workspace](https://github.com/basmilius/adecore/blob/main/packages/php-language-server/Cargo.toml) already has five separate crates: syntax, format, index, analysis and the stdio LSP server. Its package metadata declares MIT, and it has no dependency on Ruimte. Move that workspace intact into Adecore, for example under `packages/php-language-server`, with its lockfile, scripts, tests and docs. No split into more repositories is needed. Ruimte's current documentation saying it will get a repository of its own must change to this destination.

The remaining integration work is distribution:

- Add PHP-specific Cargo formatting, lint and test jobs in Adecore. Ruimte's current Rust CI job only covers the iOS device bridge; it does not validate this workspace.
- Produce pinned binaries for the supported platform/architecture combinations, with checksums and the matching stub commit. Adecore's database helper provides an existing pattern for platform packages; a verified release archive is also compatible with Ruimte's installer.
- Define how the Cargo version and native release metadata follow Adecore's shared release version. Include a standalone stdio smoke test for the distributed binary.
- Replace the hardcoded sibling checkout lookup in `apps/server/src/daemon.ts` with an explicit development path or an installed package lookup. The production installer should use the published binary metadata.
- Fill `NATIVE_RELEASES` in `apps/server/src/language/native.ts`, or consume equivalent metadata from Adecore. It is currently empty, so an installed Ruimte has no pinned native PHP server to download.
- Keep user-triggered installation, custom server authorization, per-project process ownership and shutdown rules in Ruimte's language host.

The editor and agent migrations can proceed while PHP development continues. The PHP source move does not block either workstream, and it should not require a feature freeze for the language server.

## Publishing and repository work

Adecore's existing release workflow needs changes before it can own these packages:

1. Add per-package compiled JavaScript, declarations and `source` export conditions. Preserve rewriting of relative `.ts` import extensions, which Ruimte's current library build does for Node consumers. Publish the existing subpaths and intentional testing entry points, plus CSS, locales, model JSON, fake CLI assets and editor provenance files. Exclude test files from the consumer artifact.
2. Extend version normalization to regular internal `dependencies`. The current workflow rewrites Adecore peers and optional platform dependencies, but not regular dependencies. The new agent and editor families introduce those direct internal dependencies. Resolve workspace ranges to the release version before npm publication.
3. Build against the dependencies' declarations and publish in dependency order. The current publication loop special-cases database platform packages and otherwise follows folder order. Make the dependency order explicit for contracts, backend, React, editor core and editor view.
4. Set up first publication and Trusted Publishing for the new npm names. Adecore's current instructions keep a new package private until its first publication and trusted publisher configuration are complete.
5. Record the license choice for extracted TypeScript code. Ruimte's library publisher currently declares `FSL-1.1-MIT` and copies the root license, while Adecore uses MIT. Preserve `smart-editor-core`'s `NOTICE`, Apache license and source attribution regardless of that choice.
6. Move package tests and fixtures with their implementation. Keep the Node compatibility and no-app-import checks, and add equivalent checks for the extracted editor modules.
7. Test packed artifacts in consumers. Verify default JavaScript exports as well as linked `source` development, React deduplication, CSS assets, worker loading, lazy chunks and browser-safe imports. A working monorepo build alone does not verify npm packaging.
8. Update docs, examples, import paths, lockfiles, Tailwind sources, test preloads and architecture instructions in all three repositories. Describe the generic host contract in library docs and implementation comments; keep application integration details in app docs or repository maintenance guidance. Preserve comments explaining security decisions, version-specific workarounds and upstream provenance.
9. Remove Ruimte's `libraries-v*` publication path after the consumers switch. Its current `npm.yml`, `build-libraries.ts`, library manifest builder and library placeholders publish these modules with Ruimte's version and license. Ruimte's application release series must then advance independently of Adecore.

In particular, Ruimte's stylesheet currently scans `../../../packages/agents-react/src`, which will disappear. Change that to the installed Adecore package, and verify the same CSS with a linked checkout and with a packed package.

## Suggested sequence

| Step | Deliverable                                                                                                        | Dependency                                                                                                               | Relative effort                       |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1    | Settle package names, license metadata, exports, build/publish order and packed-consumer verification.             | None.                                                                                                                    | Medium                                |
| 2    | Transfer agent contracts, backend and React package; migrate Ruimte and AfterMotion.                               | Step 1. AfterMotion also needs the current UI/shell baseline.                                                            | Medium                                |
| 3    | Implement shared file tree and row appearance for issue #32; migrate Ruimte, database and Command Center.          | Existing UI package. Can proceed independently of step 2.                                                                | Medium                                |
| 4    | Transfer editor core, DOM editor, LSP and merge algorithms; move CSS defaults and app keymap overrides.            | Step 1.                                                                                                                  | Medium                                |
| 5    | Extract editor language features and React surfaces behind host adapters, with a small working example.            | Step 4. AI integration can use step 2.                                                                                   | Large                                 |
| 6    | Transfer and distribute the PHP workspace at a committed handoff.                                                  | Current PHP work can continue. Release support from step 1.                                                              | Medium, with native distribution work |
| 7    | Extract drawing/diagram schemas and cores; assess plan, previews, shared diff display and generic service helpers. | Actual consumer need and an app-free interface.                                                                          | Varies                                |
| 8    | Remove old app-owned implementations and library publishing; update architecture guidance.                         | Ruimte has completely switched to the Adecore replacements and the complete application migration has passed validation. | Small to medium                       |

Avoid combining a namespace migration, an interface redesign and new product behavior in one change. Each step should leave Ruimte usable as an ordinary consuming application. Start with the agent family to establish ownership and release independence, while the file tree and editor package transfers can proceed separately.

## Completion criteria

- Adecore's transferred packages build, test and pack without either application checkout.
- A minimal example renders chat and a language-enabled editor with only documented package CSS and host adapters.
- The backend runs under Node and Bun; browser packages import neither runtime's server APIs.
- Ruimte and AfterMotion install a published Adecore version and pass their normal checks and relevant integration tests. They also pass an artifact smoke test without workspace source aliases.
- Existing chats, drafts, preferences, task state and replay behavior survive the agent cutover.
- Editor typing, undo, multicaret, search, language requests, stale-result handling and file edits retain their behavior. App keymaps and lazy loading still work.
- The PHP release can be installed and run outside a Ruimte checkout, and the distributed binary answers a stdio LSP handshake.
- Shared modules have one implementation in Adecore. Application wire composition, file operations and permission decisions remain in their application adapters.

The initial inventory above is based on source and manifest inspection. The extraction work that followed is recorded below.

## Local extraction status, October 5, 2026

The shared implementations now exist in Adecore's existing `main` checkout. The agent family, file tree and shared tree rows, merge, drawing, diagram, plan, service managers, editor family and PHP language server have been transferred. Application adapters remain in Ruimte. Ruimte has completed its consumer cutover; AfterMotion has not.

Adecore's workspace dependencies, build order, compiled exports, source conditions, package assets, docs dependencies and editor styles are integrated. The release workflow includes dependency-ordered publication and verified PHP native archives with a pinned descriptor. The extraction has reached `origin/main`. Adecore `0.17.0-beta.1` is now published on npm and GitHub with native PHP archives for Apple silicon, Linux arm64/x64 and Windows x64.

Combined validation passed:

- Dependency-ordered builds, workspace typechecks and lint.
- 3,854 JavaScript tests, with 60 skips; isolated DOM interaction tests run through their wrappers.
- Packed export resolution for 348 entrypoints and consumer execution under Node 22.23.3, Node 24.21.0, Node 26.7.0 and Bun, including editor lifecycle, language synchronization, diagnostics, keymaps and React rendering.
- PHP's native formatting, clippy, release build and 710 Rust tests, with five corpus cases returning early without downloaded corpora. The extracted native archive also passed a real stdio handshake on the local platform.
- Workflow validation, lockfile consistency and scoped formatting checks.
- Combined documentation typecheck, build and link validation, with all new package and tree pages reachable from the shared navigation.

The five documentation workstreams are complete and integrated. The new package and tree documentation now spans 123 pages, including package overviews, setup, concepts, references, integration examples, testing, troubleshooting and current limits. The 35 staged editor/PHP chapters have been copied into Adecore. Individual roles checked 117 typed examples, with runtime behavior checks as described in their handoffs; the complete site builds with dead-link checking enabled.

FindReplace's replacement-label lookups now match its nested English and Dutch locale keys, with component render checks for both languages. Preserved compatibility origins, inherited environment exclusions and transitional mention MIME values remain unchanged; exact spellings are recorded in Adecore's maintenance guidance. The documentation also records the reproduced drawing SVG rotation mismatch, working TypeScript source-resolution configurations, editor workspace-edit/rename-preview limitations and unfinished PHP framework support.

Ruimte's active consumers now import Adecore's agent, editor, LSP, merge, drawing, diagram, plan and service packages. Its FileTree views use the shared UI component. Application adapters preserve chat storage keys, mention drags, editor shortcuts, daemon transport, machine-wide diagnostics, AI actions, Git staging and service identity. Ruimte-specific wire envelopes wrap the shared schemas; generated Swift models remain unchanged.

Ruimte pins `0.17.0-beta.1` and its lockfile installs the published npm artifacts. Temporary checkout links have been removed. The published PHP descriptor is pinned in the daemon, with all four checksums checked against GitHub's asset digests. The app's npm workflow now publishes its launcher and platform binaries only. The original implementations and legacy library build files were removed on October 6 before the manual test round. Commit `db8f1afee` retains them.

AfterMotion's consumer cutover remains a separate task. Desktop interaction, visual and screen-reader acceptance in Ruimte still need evidence. See [the cutover record](ADECORE-CUTOVER.md) for current ownership and validation.
