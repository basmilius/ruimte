# Ruimte

Ruimte is a workspace for AI engineering, built around projects, views and persistent sessions. `README.md` has the principles. This file is the map and the rules the code does not tell you; the rules of one area sit in a `CLAUDE.md` beside its code.

## Layout

Bun workspaces (`bun install` at the root). Shared config at the root: `tsconfig.base.json`, `.oxlintrc.json`, `.editorconfig`, `bun.lock`.

- `apps/client`: the React UI (Vite). Never imports Node or Bun APIs, and talks to a daemon only through the `Transport` interface. A window shows a start screen or one workspace, which is one project on one machine and never exists without it (`state/window.ts`, `transport/connections.ts`). A project is in one window at a time (`desktop/window-claim.ts`), and the window's address holds what it shows (`state/window-target.ts`). See `apps/client/README.md`.
- `apps/server`: the daemon (Bun). Owns sessions, PTYs, chats and persistence under `$RUIMTE_HOME` (default `~/.ruimte`), with its WebSocket API on `localhost:4210`. `bun dev` runs it on `4211` with `~/.ruimte-dev`, so it never meets an installed Ruimte. Ports, flags, hooks and the on-disk layout: `apps/server/README.md`.
    - `src/remote` is the machine whose person works elsewhere; `src/peering` is the machine that is worked in.
    - `src/daemon.ts` calls the modules in `src/wiring` in boot order, each returning a typed bundle; one that needs a later bundle reaches it through `later`. Agent verbs get services through `CanvasHost` (`src/wiring/canvas-host.ts`).
- `apps/desktop`: the Electron shell, running a daemon beside the client only in machine mode `local`. Only a small, fixed set crosses IPC (`packages/desktop-bridge`), and every bridge method added after the first release is optional. See `apps/desktop/CLAUDE.md`.
- `apps/ios`: the native iPhone and iPad client (iOS 27, Swift, XcodeGen). The generated Xcode project and `Package.resolved` are committed for Xcode Cloud (`apps/ios/README.md`). Continue implementation autonomously; device measurements remain explicit acceptance evidence.
- Native helpers, each with its README: `apps/ios-device-bridge` (Rust, keeps Apple's private device protocols out of the daemon), `apps/computer-use` (Swift app through which an agent operates another Mac app, `apps/server/src/computer`), `apps/foundation-models` (Swift, the Mac's own Apple model, Apple silicon only) and `apps/speech-bridge` (Rust, Speech to Text, owned by the shell). Android has no app; the daemon drives the SDK a person installed (`apps/server/src/devices`).
- The PHP and SQL language servers are the standalone Rust repositories `basmilius/language-server-php` and `basmilius/language-server-sql`, with versions of their own (`apps/server/src/language/CLAUDE.md`).
- `apps/station` (`station.ruimte.app`) is the web client, with no local machine (`IS_STATION` in `apps/client/src/station.ts`, `state/local-machine.ts`). `apps/bench` (`bench.ruimte.app`) is the client's `bench` build alone (`apps/client/bench.html`, `src/bench`).
- `apps/site`: the website at `ruimte.app` (Next.js on Cloudflare through OpenNext, prerendered). `/download/<platform>` redirects to the latest release's build, so a release needs no deploy. Its scenes are drawn in React: when a feature changes what it looks like, its scene in `src/components/film` or `src/components/features` changes with it, and `src/components/app` copies the client's measures.
- `apps/pulsar-broker` relays signals between ed25519 keys, never reads an envelope and stores nothing. It hands out ICE servers, so no client or daemon holds a TURN secret.
- `apps/maps-worker` (`maps.ruimte.app`) proxies TomTom behind a ticket from the address book and logs no request, path or tile. The client takes tiles only while "Map tiles" is on and a person is signed in (`apps/client/src/chat/map-source.ts`). Ruimte looks up no addresses, so agents give `lat` and `lon` for every `Place`.
- `apps/pulsar-worker` is the address book at `pulsar.ruimte.app`: accounts, machines, signed statements, device links and live model catalogs.
- `packages/contracts`: zod 4 schemas for every wire message. Nothing else defines a wire shape, except `@adecore/agent-contracts`, whose schemas it re-exports.
- `packages/pulsar`: schemas for the wires outside a daemon, and `BrokerPeer`. Every signature's bytes live in `signing.ts`, each with its own prefix line, so a signature for one purpose never verifies as another.
- `packages/actions`: typed actions and the registry that runs them, so voice, the UI and the daemon execute the same thing. Every call names its actor: a person, voice, an agent or automation.
- `packages/voice`: what a Voice session does whoever runs it, shared by the desktop and the daemon. No DOM, Node or Bun APIs; sending, running and timers are injected.
- `packages/csp`: the client's Content Security Policy and the visual sandbox page's path and policy. A test holds `apps/client/index.html`'s `<meta>` tag against it.
- `packages/service` (`@ruimte/service/host`) gives `@adecore/service` Ruimte's identity, paths and runtime. `packages/npm` holds the `ruimte` launcher and its platform packages, the only packages the application workflow publishes.

Shared behavior comes from ADE CORE (`basmilius/adecore`), pinned on npm: `@adecore/ui` (components that know nothing of Ruimte, imported from the root, `/settings`, `/format` and `/testing`), `terminal`, `shell`, `agents` (imported from its root and `/chat`, `/context`, `/coordination`, `/host`, `/providers`, `/usage`, `/testing`), `agents-react`, `agent-contracts`, `plan`, `drawing`, `diagram`, the editor packages, `merge`, `database` and `service`. Ruimte supplies persistence, words, transport and actions through hosts (`apps/client/src/chat/host.ts`, `apps/server/src/chat/chat-manager.ts`, `packages/contracts/src/*-host.ts`, `apps/client/src/language/`). Model catalogs and pricing snapshots are kept in ADE CORE. `bun run adecore:link` uses the live `../adecore`, `bun run adecore:npm` restores the pins, and dev restarts after either (`docs/ADECORE-DEVELOPMENT.md`). Commit `db8f1afee` keeps the removed in-repo originals.

## Wire protocol

One WebSocket, or the same frames over a WebRTC DataChannel, as JSON validated by zod on both ends.

- Request `{ id, type, payload }`; reply `{ id, ok: true, result }` or `{ id, ok: false, error: { code, message } }`; event `{ type: 'event', event, payload }`. Both sides derive `RequestMap` and `EventMap` from `REQUEST_SCHEMAS` and `EVENT_SCHEMAS` in `packages/contracts`.
- The one binary frame is a `bytes.read` reply to a request that set `binary` (`packages/contracts/src/bytes.ts`), split into pieces over a DataChannel. Errors stay JSON.
- `PROTOCOL_VERSION` (`packages/contracts/src/protocol.ts`) moves only for an incompatible change; both ends refuse any other. `endpoint.info` lists every request the machine answers (`features`). A client checks a request newer than 0.18.0 with `machineAnswers` (`apps/client/src/transport/features.ts`, `MachineClient.answers` on iOS), never by catching `unknown-request`. A machine without `features` is refused (`transport/protocol.ts`), so 0.18.0 is the oldest a client talks to.
- A client fails a request unanswered within 60 seconds, except `UNBOUNDED_REQUESTS` (`apps/client/src/transport/link-transport.ts`).
- A new request or event is `<area>.<name>`, the area singular and the name lowerCamelCase, never kebab-case or a third level. A subscription is `<area>.watch` with `<area>.unwatch`.
- The client chooses a session id (the node id), so a node reattaches after a reload.
- `session.attach` answers with the serialized screen from `@xterm/headless`, then streams raw output; a client never replays history. A byte is in the screen or in the stream, never both. A client gets a screen only through `Session.snapshotFor`, which holds back its output from the call until the screen is taken, with no await between.
- Agent status comes only from the CLIs' hooks (`POST /hooks/<kind>`), never from parsing output. A chat speaks the CLI's own protocol (stream-json, Codex's app-server or ACP), no SDK.
- Chat events carry a `seq` per chat and are logged, so `chat.attach` with `since` resumes.
- A chat's thread goes only to attached clients; what it is doing goes to every client (`chat.status`, on change). A client asks `chat.list` on every fresh socket. `project.changed` goes only to clients that hold the project; the rest hear `project.summary`.
- Bytes for an `<img>` or `<video>` come only from `useMachineUrl` (`transport/machine-url.ts`).
- A failed direct connection says why and never falls back to the socket.

## Invariants and seams

- A project lives in two files: `.ruimte/project.json`, which a team commits, and `.ruimte/private/project.json`, one person's and kept out of git. Every write goes against the rev it read (`rev-conflict`); drawings and diagrams follow the same discipline. Details: `apps/server/src/projects/CLAUDE.md`.
- The unit of sharing is a whole view, shared only once a person's `project.save` names it in `shared`. A verb never hands back that list, so an agent cannot move a view between the files. A file view outside the project folder cannot be shared.
- Local state (open view, camera, grid layout, panels) is per client and never goes in `project.json`.
- An unknown kind is kept as `unknown`, and every unknown key of a stored node, view, text or layout survives a Ruimte that does not know it. A new kind or stored field is written only from the release after the first one that keeps it.
- A file node or view is a path, relative to the project folder and absolute outside it (`packages/contracts/src/stored-path.ts`); there is no store.
- The source address never grants access. A local process proves itself with `$RUIMTE_HOME/local.key`; every other client comes in through the account on an address book statement and proves its ed25519 key from then on. There are no pairing links. Only the local secret may have the machine sign a registration, and the daemon never holds an account token.
- A remote client reaches a daemon only over a direct channel, signaled over the broker or the door on the local network (`apps/server/src/pulsar/lan-door.ts`), both through one `SignalGate`. The door answers only signaling, the machine proves its key first, and the API stays on loopback.
- Another machine of the account works here only as a peer, answered a fixed list (`dispatcher.ts`), starting everything as an agent within bounds set here (`apps/server/src/peering/CLAUDE.md`). A node's binding to another machine lives in `$RUIMTE_HOME/remote` and rides on the wire as `machine`, never in a project file.
- A client the machine let in, or an agent, is not the owner. No client file request (`fs.*`, `bytes.read`, `archive.*`, `GET /fs/file`) reaches under `$RUIMTE_HOME`, except folders holding a person's own work or a picture made for them (`apps/server/src/fs/machine-home.ts`).
- A visual runs only in the sandbox host page at `VISUAL_HOST_PATH` (`/__visual/`) on the client's own origin, in a frame with `sandbox="allow-scripts allow-forms"`, never `allow-same-origin`, under `VISUAL_HOST_CSP`. The frame never leaves it (`apps/desktop/src/web-guards.ts`, `frame-src 'self'`), and the daemon never serves a visual inline.
- Agents manage views and nodes through `ruimte-context`, validated on the daemon (`apps/server/src/canvas/verbs.ts`), and every project write goes through `ProjectStore.mutate`.
- The daemon types a command from a project file only after a person on this machine approved it for that node (`apps/server/src/sessions/command-approvals.ts`). Until then the session holds it (`heldCommand`, `session.runHeld`). A person's `project.save` that sets the command approves it; a verb never does.
- A child agent never gets a wider permission mode than its parent (`@adecore/agents/modes.ts`, `apps/server/src/canvas/mode.ts`).
- A `--worktree` agent gets its own worktree under the machine's worktree folder (`$RUIMTE_HOME/worktrees` unless a person chose another). A worktree merge (`apps/server/src/git/worktree-merge.ts`) runs in the checkout that has the target branch out, never stashes and never moves a ref behind a working tree. An agent merges only the worktree of a node it opened, into a checkout without tracked changes; a conflict is taken back for it. The child keeps running, and its worktree and branch stay until a person removes them.
- Area rules sit in a `CLAUDE.md` in `apps/desktop`; in `apps/client/src` under `browser`, `canvas`, `dictation`, `shell/panels`, `state`, `transport`; and in `apps/server/src` under `agents`, `artifacts`, `browser`, `canvas`, `chat`, `computer`, `database`, `devices`, `git`, `language`, `launches`, `outbox`, `peering`, `power`, `projects`, `provenance`, `push`, `routines`, `templates`, `visuals`, `voice`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas. Each area keeps its own under the same heading in its `CLAUDE.md`.

- Three things wake a chat, each once: a finished task, a message, and a PR-watch a person turned on. A terminal is never woken (`apps/server/src/outbox`).
- A child that stops on a limit pauses its task, and a task settles only once its child is really done (`apps/server/src/outbox`).
- A waiting child leaves its parent a note and never wakes it (`apps/server/src/outbox`).
- The daemon schedules work on a clock only for the list in `apps/server/src/outbox/CLAUDE.md`. Resuming after a limit is on it only when a person turned that on (`apps/server/src/chat`).
- A chat reaches a node a person referenced with `#` as along a line, and a chat view arranges its canvas with `--view` (`apps/server/src/canvas`).
- A push to a phone waits while a person is at a desktop (`apps/server/src/push`).
- A terminal's permission prompts and questions stay in its TUI. Ruimte only shows that it needs you and never answers for it; approvals are answered from the app or a phone in an AI chat.
- Every shortcut needs a modifier. The only bare keys: a drawing view's tools while no text is typed and no dialog is up; the widget keys in a prompt card (arrows, Home, End, Space, Enter) while the focus is there; Space for Quick Look (Space or Escape closes it) while the focus is on a file in the files panel's tree, on macOS, for a project on this machine.
- Never highlight the canvas grid in the accent color. Only the four type sizes in `@theme`, no bracket sizes, nothing below 12px except a model's badge (11px, capitals). Geist only for the wordmark and as an interface font a person picks; Kalam only for drawing text.
- The wire only gains optional fields, new requests and new events. Never a new `ChatItemSchema` member or enum value in a chat or push payload: the iPhone app validates `chat.attach` and `chat.history` whole.
- Agents never type into or close another node's session and start no command through a verb (only `agent` starts anything); `--cwd` stays inside the project folder or its worktrees. Every other door is a feature's own, with its rules beside its code (`apps/server/src/canvas/CLAUDE.md` lists them).
- What the daemon enforces against an agent (depth, lineage, tasks) lives under `$RUIMTE_HOME`, never in `project.json`, which an agent with a shell can rewrite. An observer only notes; only the outbox acts. Nothing removes a worktree on its own.
- Nothing reads a vendor credential (keychain, `~/.codex/auth.json`, usage endpoints); plan windows come from the CLIs. The exceptions are keys a person typed into Ruimte:
    - a key for a provider with no CLI, also sent to that provider's own usage endpoint (NanoGPT's `/usage`);
    - an Anthropic API key, set only on the local secret, kept 0600 under `$RUIMTE_HOME/anthropic-claude-api` and sent only to `api.anthropic.com` (`apps/server/src/providers/anthropic-claude-api-service.ts`);
    - the OpenAI key for Voice, handed over on the local secret and sent only to OpenAI in the `Authorization` header.
- By Bas's choice the daemon reads one vendor credential: the token `grok login` left in an account's `auth.json` (xAI sign-in only, never an API key). It never renews or writes it and sends it only to the billing endpoint the CLI asks (`apps/server/src/usage/grok-plan.ts`).
- A stuck process gets a warning, never a signal a person did not press.
- Closing a project is one client's. The machine keeps it and its sessions while another client has it open; only the last client out ends them and drops it under Recent. Closing a window is not closing its project. Which projects a person keeps in their menu is that client's. A dropped socket ends nothing.
- A page never sees a refresh token, a daemon never holds an account token, and accounts are never merged.
- A machine is on at most one account and shared only with its owner. Only the local secret puts it on one; another account gets `machine-has-account` until a person there leaves the first (`apps/server/README.md`, "One account per machine").

## Conventions

- TypeScript in the Bun workspaces, Swift in `apps/ios`. 4 spaces, LF; `.editorconfig` is the rule.
- American English in code, comments, commits and UI text. No em dashes or en dashes anywhere.
- Always curly braces, also for one-line early returns. No one-letter names except `i`, `e`, `x`, `y`.
- Named top-level functions are function declarations (`export function`). Functions from factories or wrappers stay `const`, mutable callback slots variables. Arrow functions for callbacks and inside functions; class methods are never arrow properties.
- Comments explain WHY, never what the code already says.
- Shortcuts bind on `window`, once: the window's own in `shell/app-shortcuts.ts`, the project's in `canvas/canvas-shortcuts.ts`. Never per cell or node.
- A new command is a row in `apps/client/src/shell/command-table.ts`; only generated rows stay in `shell/menu/model.ts`.
- A new surface that draws data of its own gets an `ErrorBoundary` (`@adecore/ui`), keyed so it resets only while it holds an error.
- A zustand selector that builds a new array or object per call loops forever under `useShallow`: select the object and derive in render.
- The client and ADE CORE's React packages build with the React Compiler (`apps/client/react-compiler.ts`), enforced by oxlint. No `useMemo`, `useCallback` or `memo` the compiler covers; keep one only where an effect depends on the value, for a row of a long list, or in a function the compiler leaves as written. A value read in render from outside React goes through `useSyncExternalStore`. A hook is called by its `use` name, never passed as a value. A language or region change empties every compiled cache (`src/compiler-runtime.ts`).
- The start screen and the workspace are separate chunks: nothing `main.tsx` or the start screen imports statically may reach `shell/WorkspaceShell.tsx` or what only it draws. A panel, view or dialog not every workspace opens loads through `lazyNamed` or `lazyDialog` inside its `ErrorBoundary`. A chunk that fails to load reloads the page once (`src/stale-chunks.ts`), unless only a prefetch asked for it.
- UI uses only semantic tokens (`@adecore/ui/theme.css`, `@adecore/agents-react/theme.css`, `styles.css`), no raw colors. A border is an alpha over what is behind it, and every surface clips its background to the padding box. Tooltips are `Tooltip`, never `title`. Icon buttons are `IconButton`, related ones in a `ButtonGroup`. Icons are Lucide through `Icon`, except `FileIcon`, `ProviderLogo` and `RuimteMark`. No fractional pixels; a `rem` or `em` resolves to whole pixels.
- UI that knows nothing of Ruimte belongs in `basmilius/adecore`, and so does a fix to it; never copy a shared implementation into Ruimte. Edit a shared repository only through its real path, only when the task authorizes it. Issues and bumps follow `docs/ADECORE-DEVELOPMENT.md`; Ruimte code on a new ADE CORE API is pushed only with the bump to the published version.
- In anything a person reads, a daemon is a **machine**. Code, comments and docs say daemon.
- The interface is in English and Dutch (`apps/client/src/i18n`, its README has the glossary). English is the source and fallback, and `locales.test.ts` fails when the two drift. Tests read English, so assert a label on the sentence, not the key.
- Every number, date, time and duration a person reads comes from `@adecore/ui/format`, the client's only `Intl` formatter builder (`apps/client/src/format/source.ts`). Language and region stay apart on purpose: the language writes the words, the region the order, separators and clock. The region follows the language unless set, and `system` comes from the shell (`app.getSystemLocale()` beside `app.getPreferredSystemLanguages()`), since Chromium's locale is the bundle's language. A surface that would sit still through a region change calls `useFormatLocale()`.
- Tests sit next to the code (`bun run test`). No default test depends on wall-clock timing, a real shell or a file watcher: use a fake (`FakePtyAdapter`, an injected clock, `jest.useFakeTimers()`, `setSystemTime`). `bun run lint` refuses a wall-clock read in a test (`scripts/check-test-clock.ts`). A test that fails on a timeout is made deterministic or deleted, never given a longer timeout.
- Other suites by name: `*.integration.test.ts` for real shells, watchers, sockets or processes, cleaning up after itself (a real `git` fixture once per file, `apps/server/src/git/test-repo.ts`); `*.dom.test.tsx` draws the window (`renderApp`, `apps/client/testing/dom.tsx`) against a `FakeMachine` and asserts what a person sees and what goes over the wire, never an action or command id; `*.device.integration.test.ts` and `*.browser.integration.test.ts` run only on request. A platform-only test skips with `skipIf(process.platform !== '<platform>')` and imports that platform's module inside. Commands and CI: `README.md`.
- `bun run format` and `bun run check` (types, generated files, oxlint with warnings failing, `format:check`) pass before a commit. Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- Written from scratch. Copy no code from another product; ideas and npm packages are fine.

## Releasing

A release runs to the end without asking: Bas names a version, and the next thing he reads is that it is live. Recipe and secrets: `docs/RELEASE.md`.

- CI decides. The `ci.yml` run on the tagged commit must be green; nothing is built or tested here for a release, and a published build is never downloaded to try.
- A red CI is fixed before the tag: fix, push to main, wait for green. Only what Bas alone can decide goes back to him.
- The notes ride on the tag: `git tag -a v<version> -F <file> --cleanup=verbatim`, or git strips every `##` heading. `release.yml` builds macOS and Linux into the draft and publishes it as Latest once the run succeeds.
- Publishing starts `npm.yml` (`ruimte` and its three platform packages, same version) and, for a Latest release, `station.yml` and `bench.yml`. A push to main deploys neither web client.
- ADE CORE libraries release on their own; Ruimte pins the version in its manifests and lockfile. `libraries-v*` tags publish nothing from this repository.
