# Language servers

`apps/server/README.md#language-servers` has the kinds, install locations and pins.

- The PHP and SQL servers come from `basmilius/language-server-php` and `basmilius/language-server-sql`. A development daemon builds the checkout beside Ruimte or its primary checkout (`../language-servers/php`, `../language-servers/sql`, or `RUIMTE_PHP_LANGUAGE_SERVER_SOURCE` and `RUIMTE_SQL_LANGUAGE_SERVER_SOURCE`) and never changes a repository. Otherwise, and always in a compiled daemon, Install takes the release pinned in `php-native-release.json` or `sql-native-release.json`, checked against checksum and version.
- The daemon alone owns a document's text and version. A change on another `baseVersion` is refused as `stale-document`, and the client reopens the document whole. A path goes through `MachineHome` like `fs.read`.
- A document opens on every kind that serves it (`SharedDocument.kinds`); `eslint` and `tailwind` join only where a project calls for them (`profiles.ts`). Completion, code actions and hover merge across servers (`merge.ts`); other features are the first offering server's. The first server has no deadline, every other `MERGE_DEADLINE_MS`.
- A server silent on `initialize` past `INITIALIZE_TIMEOUT_MS` is ended and `crashed`. The restart rule is decided on the exit event (`STABLE_AFTER_MS`). A pair of processes goes down and up together.
- The `typescript` kind runs a TypeScript 6 sidecar (`typescript-actions`) only for code actions, started on the first one, its diagnostics dropped (`SIDECAR_START_DEADLINE_MS`). Vue stays on TypeScript 6, and a Vue project's scripts go to the `vue` kind. A project's own TypeScript wins when new enough (`ownNativeTypescript`).
- File watching runs only while a server registered for it (`file-watch.ts`), with no clock of its own.
- Each server runs one client command at a time, since LSP does not tie `workspace/applyEdit` to its command. The edit goes to that command's client (`language.edit`), never applied by the daemon, and is refused when no command of that client runs or it stays silent 30 seconds. Rename edits follow `fs.create` and `fs.write` rules.
- `didSave` goes out only when `fs.write` wrote exactly the text the daemon holds (`LanguageHost.saved`). `willSave` never holds up a save. `willSaveWaitUntil` goes only to the document's first server that offers it.
- A `window/showMessageRequest` waits without a timer; the first `language.messageAnswer` wins. It settles with null when its server leaves `ready` or `indexing`, or the project has no holder (left or never had one). Only error and warning notifications reach a person.
- A whole-project pull (`language.workspaceProblems`) runs only on a person's press, one per process at a time, never on a clock or on `workspace/diagnostic/refresh`.
- Trace and message lines never go into a crash report (`LanguageLog.serverOutput`), `telemetry/event` is dropped, and the trace starts `off`.
- `window/showDocument` is answered only while a client's command runs on the server, and only to that client. A `file:` document inside the project opens in its editor; an `http(s)` address is an offer, answered no, that a person's press opens; everything else is refused and logged. Pending Bas's confirmation as a product rule.
- An agent uses the servers through `AgentLanguage` (`agent-language.ts`) for one call. It never installs a server, and a file read against a connection agents may not use is refused (`database-access-off`).
- Work another machine sent (`UntrustedFolders.inFolder`) gets no kind that runs project code (`runsProjectCode`), no server of a person's own, and only the pinned TypeScript.
- A package set (`packages/<setId>`, `package-store.ts`) is immutable and shared; installs only link `node_modules` to it and keep mutable storage in their own folder. `removeInstallFolder` unlinks before `rm`. Only `PackageStore.collect` removes a set, one no install refers to and no lease holds, and nothing when the disk cannot be read in full. Adopting a real `node_modules` tree runs before any server starts and links only after every file proved identical.
- Ruimte reads the PHP server's owner manifests (`owner-*.json`) and never derives a cache file name. A cache pass (`php-cache.ts`) runs inside `StorageGate.hold`, which a `php-native` start awaits. It never removes the cache of a folder a server is live in, removes nothing on an unknown manifest format, and removes files without a manifest only while no PHP process runs. A checkout counts as vanished only after repeated `ENOENT` over a week with no known project folder around it.
- A native server never fetches anything; Install downloads PHP's stubs.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Language servers are installed, updated and set back only when a person presses Install, Update or the previous version, never by an agent or a verb. A pin that moved with a Ruimte update never stops a server; it runs what it has until a person updates.
- The daemon runs one server per project per kind, shared by every client. A server that ends by itself after a minute of being ready is started again once, at once. One that ends sooner, or whose restart ends within that minute, stays crashed until a person restarts it.
- A server starts with the first document that needs it and ends only when its project closes on the machine (or the daemon stops).
- A server of a person's own (a command they typed) is saved only through a local secret request, which approves exactly that command, arguments and environment. It lives under `$RUIMTE_HOME`, never in a project file; no verb or agent adds or changes one.
