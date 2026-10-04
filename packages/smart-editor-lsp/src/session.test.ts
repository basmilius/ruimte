import { describe, expect, it, jest } from 'bun:test';
import { LspSession } from './session.ts';
import type { DocumentHighlight, WorkspaceSymbol } from './protocol.ts';
import { flush, origin, rejecting, ScriptedTransport, sessionWith } from './test-transport.ts';

describe('capabilities and server requests', () => {
    it('sends configured workspace settings after initialization and before documents open', async () => {
        const transport = new ScriptedTransport();
        transport.autoInitialize = { textDocumentSync: 2 };
        const configuration = { implicitProjectConfiguration: { checkJs: true, strict: true } };
        const session = new LspSession(transport, { configuration });
        await session.initialize();
        const document = session.openDocument({ uri: 'file:///inferred.js', languageId: 'javascript', text: 'let count = 1;' });
        await document.ready;
        expect(transport.methods().slice(0, 4)).toEqual(['initialize', 'initialized', 'workspace/didChangeConfiguration', 'textDocument/didOpen']);
        expect(transport.sent).toContainEqual({ jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: configuration } });
        await session.shutdown();
    });

    it('negotiates semantic occurrence kinds, hierarchical symbols, folding and code lenses', async () => {
        const { session, transport } = await sessionWith({ documentHighlightProvider: true, documentSymbolProvider: true });
        const initialize = transport.request('initialize').params as {
            capabilities: { textDocument: Record<string, unknown>; workspace: Record<string, unknown> };
        };
        expect(initialize.capabilities.textDocument.documentHighlight).toEqual({ dynamicRegistration: true });
        expect(initialize.capabilities.textDocument.documentSymbol).toMatchObject({ dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true });
        expect(initialize.capabilities.textDocument.foldingRange).toMatchObject({ dynamicRegistration: true });
        expect(initialize.capabilities.textDocument.codeLens).toEqual({ dynamicRegistration: true });
        expect(initialize.capabilities.workspace.symbol).toMatchObject({ dynamicRegistration: true, resolveSupport: { properties: ['location.range'] } });
        const document = session.openDocument({ uri: 'file:///symbols.ts', languageId: 'typescript', text: 'let x = 1; x++;' });
        const highlights = document.documentHighlights({ line: 0, character: 4 });
        await flush();
        expect(transport.request('textDocument/documentHighlight').params).toEqual({
            textDocument: { uri: document.uri },
            position: { line: 0, character: 4 }
        });
        const result: DocumentHighlight[] = [
            { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, kind: 3 },
            { range: { start: { line: 0, character: 11 }, end: { line: 0, character: 12 } }, kind: 2 }
        ];
        transport.respond('textDocument/documentHighlight', result);
        expect(await highlights).toEqual(result);
        await session.shutdown();
    });

    it('cancels superseded highlights and rejects obsolete symbol results after edits', async () => {
        const { session, transport } = await sessionWith({ documentHighlightProvider: true, documentSymbolProvider: true });
        const document = session.openDocument({ uri: 'file:///symbols.ts', languageId: 'typescript', text: 'let x = 1;' });
        const first = document.documentHighlights(origin);
        const cancelled = rejecting(first, (error) => expect(error).toMatchObject({ code: -32800 }));
        await flush();
        const firstId = transport.request('textDocument/documentHighlight').id;
        const second = document.documentHighlights({ line: 0, character: 4 });
        await cancelled;
        await flush();
        expect(transport.sent).toContainEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: firstId } });
        transport.emit({ jsonrpc: '2.0', id: firstId, result: [{ range: { start: origin, end: origin } }] });
        transport.respond('textDocument/documentHighlight', []);
        expect(await second).toEqual([]);
        const stale = rejecting(document.documentSymbols(), (error) => expect((error as Error).name).toBe('StaleResultError'));
        await flush();
        await document.updateText('let y = 1;');
        await stale;
        await session.shutdown();
    });

    it('honors dynamic selectors and makes unsupported features explicit', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///symbols.ts', languageId: 'typescript', text: 'x' });
        await expect(document.documentHighlights(origin)).rejects.toMatchObject({ code: -32601 });
        expect(transport.request('textDocument/documentHighlight')).toBeUndefined();
        transport.emit({
            jsonrpc: '2.0',
            id: 140,
            method: 'client/registerCapability',
            params: {
                registrations: [
                    { id: 'highlight', method: 'textDocument/documentHighlight', registerOptions: { documentSelector: [{ language: 'typescript' }] } },
                    { id: 'symbols', method: 'textDocument/documentSymbol', registerOptions: { documentSelector: [{ language: 'typescript' }] } }
                ]
            }
        });
        await flush();
        expect(session.supports('textDocument/documentHighlight', document)).toBe(true);
        expect(session.supports('textDocument/documentSymbol', document)).toBe(true);
        expect(session.supports('textDocument/documentHighlight', { uri: 'file:///x.php', languageId: 'php' })).toBe(false);
        transport.emit({
            jsonrpc: '2.0',
            id: 141,
            method: 'client/unregisterCapability',
            params: { unregisterations: [{ id: 'highlight', method: 'textDocument/documentHighlight' }] }
        });
        await flush();
        expect(session.supports('textDocument/documentHighlight', document)).toBe(false);
        expect(session.supports('textDocument/documentSymbol', document)).toBe(true);
        await session.shutdown();
    });

    it('queries and resolves workspace symbols only when advertised', async () => {
        const { session, transport } = await sessionWith({ workspaceSymbolProvider: { resolveProvider: true } });
        const symbols = session.workspaceSymbols('greet');
        await flush();
        expect(transport.request('workspace/symbol').params).toEqual({ query: 'greet' });
        const unresolved: WorkspaceSymbol = { name: 'greet', kind: 12, location: { uri: 'file:///helpers.ts' }, data: { id: 1 } };
        transport.respond('workspace/symbol', [unresolved]);
        expect(await symbols).toEqual([unresolved]);
        const resolved = session.resolveWorkspaceSymbol(unresolved);
        await flush();
        expect(transport.request('workspaceSymbol/resolve').params).toEqual(unresolved);
        const symbol = { ...unresolved, location: { uri: unresolved.location.uri, range: { start: origin, end: origin } } };
        transport.respond('workspaceSymbol/resolve', symbol);
        expect(await resolved).toEqual(symbol);
        await session.shutdown();
        const unsupported = await sessionWith({ workspaceSymbolProvider: true });
        await expect(unsupported.session.resolveWorkspaceSymbol(unresolved)).rejects.toMatchObject({ code: -32601 });
        await unsupported.session.shutdown();
    });

    it('matches dynamic selectors and unregisters only the requested registration', async () => {
        const { session, transport } = await sessionWith({ hoverProvider: true });
        const ts = { uri: 'file:///src/test.ts', languageId: 'typescript' };
        const php = { uri: 'file:///src/test.php', languageId: 'php' };
        transport.emit({
            jsonrpc: '2.0',
            id: 100,
            method: 'client/registerCapability',
            params: {
                registrations: [
                    {
                        id: 'format-php',
                        method: 'textDocument/formatting',
                        registerOptions: { documentSelector: [{ language: 'php', scheme: 'file', pattern: '**/*.{php,phtml}' }] }
                    },
                    {
                        id: 'tokens',
                        method: 'textDocument/semanticTokens',
                        registerOptions: { legend: { tokenTypes: ['variable'], tokenModifiers: [] }, full: { delta: true } }
                    }
                ]
            }
        });
        await flush();
        expect(session.supports('textDocument/formatting', php)).toBe(true);
        expect(session.supports('textDocument/formatting', ts)).toBe(false);
        expect(session.supports('textDocument/semanticTokens/full/delta', ts)).toBe(true);
        expect(session.supports('textDocument/semanticTokens/range', ts)).toBe(false);
        transport.emit({
            jsonrpc: '2.0',
            id: 101,
            method: 'client/unregisterCapability',
            params: { unregisterations: [{ id: 'format-php', method: 'textDocument/formatting' }] }
        });
        await flush();
        expect(session.supports('textDocument/formatting', php)).toBe(false);
        expect(session.supports('textDocument/hover', ts)).toBe(true);
        await session.shutdown();
    });

    it('tells listeners when a registration or a refresh request can change what a document may ask', async () => {
        const { session, transport } = await sessionWith();
        const changed = jest.fn();
        session.onCapabilitiesChanged(changed);
        transport.emit({ jsonrpc: '2.0', id: 1, method: 'workspace/inlayHint/refresh' });
        transport.emit({ jsonrpc: '2.0', id: 2, method: 'workspace/codeLens/refresh' });
        await flush();
        expect(changed).toHaveBeenCalledTimes(2);
        expect(transport.sent).toContainEqual({ jsonrpc: '2.0', id: 1, result: null });
        await session.shutdown();
    });

    it('answers configuration, refuses unhandled workspace writes and reports progress', async () => {
        const { session, transport } = await sessionWith();
        await session.setConfiguration({ typescript: { format: { tabSize: 2 } } });
        const progress = jest.fn();
        session.onProgress(progress);
        transport.emit({
            jsonrpc: '2.0',
            id: 'config',
            method: 'workspace/configuration',
            params: { items: [{ section: 'typescript.format' }, { section: 'missing' }] }
        });
        transport.emit({ jsonrpc: '2.0', id: 'edit', method: 'workspace/applyEdit', params: { edit: { changes: {} } } });
        transport.emit({ jsonrpc: '2.0', method: '$/progress', params: { token: 1, value: { kind: 'begin', title: 'Indexing' } } });
        await flush();
        expect(transport.sent).toContainEqual({ jsonrpc: '2.0', id: 'config', result: [{ tabSize: 2 }, null] });
        expect(transport.sent).toContainEqual({
            jsonrpc: '2.0',
            id: 'edit',
            result: { applied: false, failureReason: 'No workspace edit handler is attached' }
        });
        expect(progress).toHaveBeenCalledWith({ token: 1, value: { kind: 'begin', title: 'Indexing' } });
        await session.shutdown();
    });

    it('rejects an incompatible position encoding at initialization', async () => {
        const transport = new ScriptedTransport();
        transport.autoInitialize = { positionEncoding: 'utf-8' };
        const session = new LspSession(transport);
        await expect(session.initialize()).rejects.toThrow('position encoding');
        expect(session.state).toBe('closed');
    });

    it('refuses to open a document before the handshake is done', () => {
        const session = new LspSession(new ScriptedTransport());
        expect(() => session.openDocument({ uri: 'file:///a.ts', languageId: 'typescript', text: '' })).toThrow('await initialize');
    });
});
