import { describe, expect, it } from 'bun:test';
import { StaleResultError } from './connection.ts';
import { flush, rejecting, origin, sessionWith } from './test-transport.ts';

describe('versioned language documents', () => {
    it('sends one range per update, with UTF-16 and CRLF coordinates', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: '🙂\r\nlast' });
        const one = document.updateText('🙂\r\nnext');
        const two = document.updateText('🙂\r\nfinal');
        await Promise.all([document.ready, one, two]);
        expect(document.version).toBe(3);
        expect(transport.sent.filter((message) => 'method' in message && message.method.startsWith('textDocument/'))).toEqual([
            {
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri: document.uri, languageId: 'typescript', text: '🙂\r\nlast', version: 1 } }
            },
            {
                jsonrpc: '2.0',
                method: 'textDocument/didChange',
                params: {
                    textDocument: { uri: document.uri, version: 2 },
                    contentChanges: [{ text: 'nex', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } }]
                }
            },
            {
                jsonrpc: '2.0',
                method: 'textDocument/didChange',
                params: {
                    textDocument: { uri: document.uri, version: 3 },
                    contentChanges: [{ text: 'final', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } }]
                }
            }
        ]);
        await document.updateText('🙂\r\nfinal');
        expect(document.version).toBe(3);
        await session.shutdown();
    });

    it('forwards incremental changes as they are and raises the version once per call', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'abc' });
        const changes = [
            { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, text: 'XY' },
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, text: '!' }
        ];
        await document.applyChanges(changes);
        expect(document.text).toBe('aXY!c');
        expect(document.version).toBe(2);
        expect(transport.sent.at(-1)).toEqual({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: { textDocument: { uri: document.uri, version: 2 }, contentChanges: changes }
        });
        await document.applyChanges([{ text: 'aXY!c' }]);
        expect(document.version).toBe(3);
        await session.shutdown();
    });

    it('refuses a change outside the text before anything is sent or counted', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'abc' });
        const refused = document.applyChanges([{ range: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } }, text: 'x' }]);
        await expect(refused).rejects.toThrow('outside');
        expect(document.version).toBe(1);
        expect(document.text).toBe('abc');
        expect(transport.methods()).not.toContain('textDocument/didChange');
        await session.shutdown();
    });

    it('keeps a surrogate pair whole when the change starts or ends inside the shared text', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'a😀b' });
        await document.updateText('a😁b');
        expect(transport.sent.at(-1)).toMatchObject({
            params: { contentChanges: [{ text: '😁', range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } } }] }
        });
        await session.shutdown();
    });

    it('sends the whole text to a server that negotiated full synchronization, and the text on save when asked', async () => {
        const { session, transport } = await sessionWith({ textDocumentSync: { openClose: true, change: 1, save: { includeText: true } } });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'old' });
        await document.applyChanges([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, text: 'new' }]);
        await document.save();
        expect(transport.sent).toContainEqual({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: { textDocument: { uri: document.uri, version: 2 }, contentChanges: [{ text: 'new' }] }
        });
        expect(transport.sent).toContainEqual({ jsonrpc: '2.0', method: 'textDocument/didSave', params: { textDocument: { uri: document.uri }, text: 'new' } });
        await session.shutdown();
    });

    it('refuses changes when the server negotiated none', async () => {
        const { session } = await sessionWith({ textDocumentSync: { openClose: true, change: 0 } });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'old' });
        await expect(document.updateText('new')).rejects.toMatchObject({ code: -32601 });
        await session.shutdown();
    });

    it('starts at the version it is given', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: '', version: 7 });
        await document.ready;
        expect(document.version).toBe(7);
        expect(transport.sent.at(-1)).toMatchObject({ params: { textDocument: { version: 7 } } });
        await session.shutdown();
    });

    it('flushes queued edits before shutdown and rejects new attachments while closing', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'old' });
        const update = document.updateText('new');
        const shutdown = session.shutdown();
        expect(() => session.openDocument({ uri: 'file:///second.ts', languageId: 'typescript', text: '' })).toThrow('closing');
        await Promise.all([update, shutdown]);
        expect(transport.methods().slice(-4)).toEqual(['textDocument/didChange', 'textDocument/didClose', 'shutdown', 'exit']);
    });

    it('rejects old results and old completion resolves after an edit', async () => {
        const { session, transport } = await sessionWith({ hoverProvider: true, completionProvider: { resolveProvider: true } });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'old' });
        const completion = document.completion(origin);
        await flush();
        transport.respond('textDocument/completion', { items: [{ label: 'old', data: { server: 7 } }], isIncomplete: false });
        const result = await completion;
        const item = !Array.isArray(result) && result?.items[0];
        const hover = document.hover(origin);
        const rejected = rejecting(hover, (error) => expect(error).toBeInstanceOf(StaleResultError));
        await flush();
        await document.updateText('new');
        await rejected;
        transport.respond('textDocument/hover', { contents: 'stale' });
        expect(item).toBeTruthy();
        if (item) {
            await expect(document.resolveCompletion(item)).rejects.toBeInstanceOf(StaleResultError);
        }
        expect(transport.request('completionItem/resolve')).toBeUndefined();
        await session.shutdown();
    });

    it('supersedes one feature while allowing independent and explicitly concurrent requests', async () => {
        const { session, transport } = await sessionWith({ hoverProvider: true, completionProvider: {} });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'hello' });
        const old = document.hover(origin);
        const oldRejected = rejecting(old, (error) => expect(error).toMatchObject({ code: -32800 }));
        await flush();
        const current = document.hover(origin);
        const completion = document.completion(origin);
        await flush();
        transport.respond('textDocument/hover', { contents: 'new' });
        transport.respond('textDocument/completion', []);
        await oldRejected;
        expect(await current).toEqual({ contents: 'new' });
        expect(await completion).toEqual([]);
        const first = document.hover(origin, { cancelPrevious: false });
        await flush();
        const firstId = transport.request('textDocument/hover').id;
        const second = document.hover(origin, { cancelPrevious: false });
        await flush();
        transport.respond('textDocument/hover', null);
        transport.emit({ jsonrpc: '2.0', id: firstId, result: null });
        expect(await Promise.all([first, second])).toEqual([null, null]);
        await session.shutdown();
    });

    it('drops versioned stale diagnostics and clears diagnostics on close', async () => {
        const { session, transport } = await sessionWith();
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: '' });
        const observed: unknown[] = [];
        session.onDiagnostics((params) => observed.push(params));
        await document.updateText('text');
        const diagnostic = { range: { start: origin, end: origin }, message: 'current' };
        transport.emit({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, version: 1, diagnostics: [diagnostic] } });
        transport.emit({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, version: 2, diagnostics: [diagnostic] } });
        await document.close();
        transport.emit({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, version: 2, diagnostics: [diagnostic] } });
        expect(observed).toEqual([
            { uri: document.uri, version: 2, diagnostics: [diagnostic] },
            { uri: document.uri, diagnostics: [] }
        ]);
        await session.shutdown();
    });

    it('holds a closing URI until didClose has been sent, so reopening cannot reorder lifecycle messages', async () => {
        const { session, transport } = await sessionWith({ hoverProvider: true });
        const item = { uri: 'file:///main.ts', languageId: 'typescript', text: '' };
        const document = session.openDocument(item);
        const pending = document.hover(origin);
        const rejected = rejecting(pending, (error) => expect(error).toBeInstanceOf(StaleResultError));
        await flush();
        const closing = document.close();
        expect(() => session.openDocument(item)).toThrow('already open');
        await closing;
        await rejected;
        await session.openDocument(item).ready;
        const lifecycle = transport.methods().filter((method) => ['textDocument/didOpen', 'textDocument/didClose'].includes(method));
        expect(lifecycle).toEqual(['textDocument/didOpen', 'textDocument/didClose', 'textDocument/didOpen']);
        await session.shutdown();
    });

    it('refuses unsupported requests and preserves opaque inlay resolve data', async () => {
        const { session, transport } = await sessionWith({ inlayHintProvider: { resolveProvider: true } });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'x' });
        await expect(document.rename(origin, 'y')).rejects.toMatchObject({ code: -32601 });
        const hint = { position: origin, label: ': number', data: { opaque: ['plugin', 7] } };
        const resolved = document.resolveInlayHint(hint);
        await flush();
        expect(transport.request('inlayHint/resolve').params).toEqual(hint);
        transport.respond('inlayHint/resolve', { ...hint, tooltip: 'number' });
        expect(await resolved).toMatchObject({ tooltip: 'number', data: hint.data });
        await session.shutdown();
    });

    it('asks for folding ranges and code lenses and resolves a lens only when the server can', async () => {
        const { session, transport } = await sessionWith({ foldingRangeProvider: true, codeLensProvider: { resolveProvider: true } });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'x' });
        const folding = document.foldingRanges();
        const lenses = document.codeLenses();
        await flush();
        expect(transport.request('textDocument/foldingRange').params).toEqual({ textDocument: { uri: document.uri } });
        transport.respond('textDocument/foldingRange', [{ startLine: 0, endLine: 3 }]);
        transport.respond('textDocument/codeLens', [{ range: { start: origin, end: origin }, data: 1 }]);
        expect(await folding).toEqual([{ startLine: 0, endLine: 3 }]);
        const lens = (await lenses)?.[0];
        expect(lens).toBeTruthy();
        const resolved = document.resolveCodeLens(lens!);
        await flush();
        transport.respond('codeLens/resolve', { ...lens, command: { title: '1 reference', command: 'x' } });
        expect(await resolved).toMatchObject({ command: { title: '1 reference' } });
        await session.shutdown();
    });
    it('asks for the selection ranges around positions and refuses when the server has none', async () => {
        const { session, transport } = await sessionWith({ selectionRangeProvider: true });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'x' });
        const ranges = document.selectionRanges([origin]);
        await flush();
        expect(transport.request('textDocument/selectionRange').params).toEqual({ textDocument: { uri: document.uri }, positions: [origin] });
        const chain = { range: { start: origin, end: origin }, parent: { range: { start: origin, end: { line: 0, character: 1 } } } };
        transport.respond('textDocument/selectionRange', [chain]);
        expect(await ranges).toEqual([chain]);
        await session.shutdown();
        const { session: bare } = await sessionWith({});
        const other = bare.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'x' });
        await expect(other.selectionRanges([origin])).rejects.toMatchObject({ code: -32601 });
        await bare.shutdown();
    });

    it('runs a feature by its method name, resolve methods included', async () => {
        const { session, transport } = await sessionWith({ hoverProvider: true, completionProvider: { resolveProvider: true } });
        const document = session.openDocument({ uri: 'file:///main.ts', languageId: 'typescript', text: 'x' });
        const hover = document.request('textDocument/hover', { position: origin });
        await flush();
        expect(transport.request('textDocument/hover').params).toEqual({ position: origin, textDocument: { uri: document.uri } });
        transport.respond('textDocument/hover', { contents: 'h' });
        expect(await hover).toEqual({ contents: 'h' });
        const item = { label: 'a', data: 1 };
        const resolved = document.request('completionItem/resolve', item);
        await flush();
        expect(transport.request('completionItem/resolve').params).toEqual(item);
        transport.respond('completionItem/resolve', { ...item, detail: 'd' });
        expect(await resolved).toEqual({ ...item, detail: 'd' });
        await session.shutdown();
    });
});
