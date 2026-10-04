# @ruimte/smart-editor-lsp

A DOM-free LSP 3.17 client, and the `LanguageService` interface the smart editor asks its language features through. It spawns nothing and imports no Node or Bun API outside its tests, so it runs in the daemon, which hosts the language servers, and in a browser. The document model it feeds is `@ruimte/smart-editor-core`; the view is `@ruimte/smart-editor`.

Positions are LSP positions: zero-based lines and UTF-16 characters, with a line ending at `\n`, `\r\n` or a lone `\r`. Turning them into editor offsets is the view's job.

## API

Everything comes from the package root; `@ruimte/smart-editor-lsp/testing` holds the test doubles.

- `LspSession`: one conversation with one server over an `LspTransport`. `initialize` negotiates capabilities (UTF-16 only, snippets off unless asked), `openDocument` returns an `LspDocument`, and `supports` / `providerOptions` answer from static capabilities and dynamic registrations alike. It answers the server's configuration, folder, registration, progress and message requests, and `onDiagnostics`, `onCapabilitiesChanged` (registrations and refresh requests), `onProgress`, `onNotification` and `onError` observe it. `shutdown` closes the documents, then sends `shutdown` and `exit`.
- `LspDocument`: one open file in one session, and the owner of its version. `applyChanges` takes `didChange` entries and sends them as they are to a server that negotiated incremental sync, or the whole text to one that negotiated full sync. `updateText` sends the one range that differs from the held text. Every call raises the version by one. A request is cancelled when the text changes or a newer one for the same feature is made (`cancelPrevious`), and an answer for an older version rejects with `StaleResultError`, so does resolving a completion item, code action, lens or hint of an older version. One method per feature: completion, hover, signature help, the four navigations, references, highlights, symbols, rename, code actions, code lenses, formatting, folding, semantic tokens (full, delta, range), inlay hints and pull diagnostics.
- `JsonRpcConnection`: correlation, `$/cancelRequest`, a request timeout (30 seconds, `0` turns it off) and the requests a server sends. `LspError` carries a JSON-RPC code; `ErrorCodes` names the ones used here.
- Transports: `createStreamTransport` over a `ByteStream` (a child's stdin and stdout, which the host adapts), `ContentLengthDecoder` and `encodeMessage` for the framing, `createMemoryTransportPair` and `connectWebSocket`.
- Edits: `applyTextEdits` and `planWorkspaceEdit` (simultaneous edits and a multi-file plan, which refuses file operations), `applyContentChanges` (sequential), `minimalChange`, `offsetAt`, `positionAt` and `endPosition`.
- `bridgeVueTypeScript` relays Vue's `tsserver/request` to the TypeScript server, and `vueServerOrder` says which of the two servers of a `.vue` document to ask first.
- `pathToFileUri` and `fileUriToPath`.
- `LanguageService`: what the editor asks of the language side (open, change and close a document, every feature above, `supports`, `providerOptions`, `onProvidersChanged` and `onDiagnostics`). Results stay in LSP shapes. The daemon's host and the client's wire adapter (`apps/server/src/language`, `apps/client/src/language`) are what stand behind it.
- `@ruimte/smart-editor-lsp/testing`: `FakeLanguageServer`, a server on the far end of a transport that answers the handshake, mirrors document text and answers whatever a test registers, and `createMemoryTransportPair`.

## Known limits

- Unversioned diagnostics cannot be proven fresh and are accepted while their document is open.
- The package applies no workspace edit and touches no file. File creates, renames and deletes in a `WorkspaceEdit` are the host's.
- Only UTF-16 position encoding is negotiated; a server that insists on another one fails to initialize.
- Servers that negotiated no document changes (`change: 0`) cannot follow an edit.
