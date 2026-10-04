import { describe, expect, it } from 'bun:test';
import { LspSession } from './session.ts';
import { createMemoryTransportPair, FakeLanguageServer } from './testing.ts';
import { flush, origin } from './test-transport.ts';

async function connect(options: ConstructorParameters<typeof FakeLanguageServer>[1] = {}) {
    const [clientSide, serverSide] = createMemoryTransportPair();
    const server = new FakeLanguageServer(serverSide, options);
    const session = new LspSession(clientSide, { timeoutMs: 0 });
    await session.initialize();
    return { server, session };
}

describe('a session against the fake language server', () => {
    it('keeps the server copy of a document equal to ours through incremental changes', async () => {
        const { server, session } = await connect();
        const document = session.openDocument({ uri: 'file:///a.ts', languageId: 'typescript', text: 'const a = 1;\nconst b = 2;\n' });
        await document.applyChanges([
            { range: { start: { line: 0, character: 10 }, end: { line: 0, character: 11 } }, text: '10' },
            { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: '// two\n' }
        ]);
        await document.updateText('const a = 10;\n// two\nconst b = 3;\n');
        await flush();
        expect(server.documents.get('file:///a.ts')).toEqual({ languageId: 'typescript', text: 'const a = 10;\n// two\nconst b = 3;\n', version: 3 });
        await session.shutdown();
        expect(server.shutdownRequested).toBe(true);
        expect(server.exited).toBe(true);
        expect(server.documents.size).toBe(0);
    });

    it('answers registered requests and refuses the rest', async () => {
        const { server, session } = await connect({ capabilities: { textDocumentSync: 2, hoverProvider: true, renameProvider: true } });
        server.handle('textDocument/hover', () => ({ contents: 'a hover' }));
        const document = session.openDocument({ uri: 'file:///a.ts', languageId: 'typescript', text: '' });
        expect(await document.hover(origin)).toEqual({ contents: 'a hover' });
        await expect(document.rename(origin, 'b')).rejects.toMatchObject({ code: -32601 });
        await session.shutdown();
    });

    it('delivers diagnostics for the version we have and drops those for an older one', async () => {
        const { server, session } = await connect();
        const document = session.openDocument({ uri: 'file:///a.ts', languageId: 'typescript', text: '' });
        const reports: unknown[] = [];
        session.onDiagnostics((params) => reports.push(params));
        await document.updateText('x');
        const diagnostic = { range: { start: origin, end: origin }, message: 'bad' };
        await server.publishDiagnostics(document.uri, [diagnostic], 1);
        await server.publishDiagnostics(document.uri, [diagnostic], 2);
        await flush();
        expect(reports).toEqual([{ uri: document.uri, version: 2, diagnostics: [diagnostic] }]);
        await session.shutdown();
    });

    it('closes the session when the server process goes away', async () => {
        const { server, session } = await connect();
        const document = session.openDocument({ uri: 'file:///a.ts', languageId: 'typescript', text: '' });
        await server.crash();
        await flush();
        expect(session.state).toBe('closed');
        expect(document.isClosed).toBe(true);
    });
});
