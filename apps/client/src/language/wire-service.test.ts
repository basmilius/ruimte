import { describe, expect, test } from 'bun:test';
import { TransportError } from '@/transport/transport';
import { FakeLanguageTransport } from './fake-daemon';
import { WireLanguageService } from './wire-service';
import type { DiagnosticsReport } from '@ruimte/smart-editor-lsp';

const folder = '/work/app';
const uri = 'file:///work/app/src/a.ts';
const origin = { line: 0, character: 0 };

async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

function service(texts: Record<string, string> = { [uri]: 'let a = 1;' }) {
    const transport = new FakeLanguageTransport();
    const language = new WireLanguageService({ transport, projectId: 'p1', folder, textOf: (candidate) => texts[candidate] });
    return { transport, language, texts };
}

describe('documents', () => {
    test('opens under the stored path of the file, with its text, and takes the version and providers from the answer', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        expect(transport.callsOf('language.document.open')[0].payload).toEqual({
            projectId: 'p1',
            path: 'src/a.ts',
            languageId: 'typescript',
            text: 'let a = 1;'
        });
        expect(language.supports('textDocument/hover', uri)).toBe(true);
        expect(language.supports('textDocument/rename', uri)).toBe(false);
        expect(language.providerOptions('textDocument/completion', uri)).toEqual({ triggerCharacters: ['.'] });
    });

    test('keeps a path outside the project folder absolute', async () => {
        const { transport, language } = service({ 'file:///elsewhere/x.ts': '' });
        await language.openDocument({ uri: 'file:///elsewhere/x.ts', languageId: 'typescript', text: '' });
        expect(transport.callsOf('language.document.open')[0].payload).toMatchObject({ path: '/elsewhere/x.ts' });
    });

    test('refuses a document that is no file', async () => {
        const { language } = service();
        await expect(language.openDocument({ uri: 'untitled:1', languageId: 'typescript', text: '' })).rejects.toMatchObject({ code: -32603 });
    });

    test('sends changes ahead of their answers, each against the version the one before leaves', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        const first = language.changeDocument(uri, [{ text: 'one' }]);
        const second = language.changeDocument(uri, [{ text: 'two' }]);
        const third = language.changeDocument(uri, [{ text: 'three' }]);
        await Promise.all([first, second, third]);
        expect(transport.callsOf('language.document.change').map((call) => (call.payload as { baseVersion: number }).baseVersion)).toEqual([1, 2, 3]);
        expect(transport.documents.get('src/a.ts')).toMatchObject({ text: 'three', version: 4 });
    });

    test('opens the document again with the text of the view when the daemon refuses a change', async () => {
        const texts = { [uri]: 'let a = 1;' };
        const { transport, language } = service(texts);
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        // Another client set other text, so the version moved under this one.
        transport.documents.get('src/a.ts')!.version = 7;
        texts[uri] = 'let a = 12;';
        await language.changeDocument(uri, [{ text: 'let a = 12;' }]);
        const opens = transport.callsOf('language.document.open');
        expect(opens).toHaveLength(2);
        expect(opens[1].payload).toMatchObject({ text: 'let a = 12;' });
        expect(transport.documents.get('src/a.ts')).toMatchObject({ text: 'let a = 12;', version: 8 });
        await language.changeDocument(uri, [{ text: 'let a = 123;' }]);
        expect(transport.callsOf('language.document.change').at(-1)?.payload).toMatchObject({ baseVersion: 8 });
    });

    test('opens again when the view moved while the daemon took its text', async () => {
        const texts = { [uri]: 'one' };
        const { transport, language } = service(texts);
        await language.openDocument({ uri, languageId: 'typescript', text: 'one' });
        transport.documents.get('src/a.ts')!.version = 5;
        transport.holdNextReply();
        const change = language.changeDocument(uri, [{ text: 'two' }]);
        texts[uri] = 'two';
        await settle();
        // The change is refused and the reopen with 'two' is on its way, held; the view moves on while it is.
        texts[uri] = 'three';
        transport.release();
        await change;
        await settle();
        expect(transport.documents.get('src/a.ts')?.text).toBe('three');
    });

    test('opens every document again when the link comes back', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.documents.clear();
        transport.setStatus('closed');
        transport.setStatus('open');
        await settle();
        expect(transport.documents.get('src/a.ts')).toMatchObject({ text: 'let a = 1;', version: 1 });
    });

    test('closes on the daemon and forgets the document', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        await language.closeDocument(uri);
        expect(transport.documents.size).toBe(0);
        await expect(language.hover(uri, origin)).rejects.toThrow('not open');
    });
});

describe('requests', () => {
    test('asks the daemon for the version it expects and answers with the result', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        expect(await language.hover(uri, origin)).toEqual({ contents: 'hover at 1' });
        expect(transport.callsOf('language.request')[0].payload).toEqual({
            projectId: 'p1',
            path: 'src/a.ts',
            method: 'textDocument/hover',
            params: { position: origin },
            version: 1
        });
    });

    test('rejects a result for text the view has left, and one the daemon calls stale, with the stale error', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.holdNextReply();
        const hover = language.hover(uri, origin);
        const caught = hover.catch((error: unknown) => error);
        await settle();
        void language.changeDocument(uri, [{ text: 'let a = 2;' }]);
        transport.release();
        expect(((await caught) as Error).name).toBe('StaleResultError');

        transport.answers.set('language.request', () => {
            throw new TransportError('stale-document', 'The document is at another version');
        });
        await expect(language.hover(uri, origin)).rejects.toMatchObject({ name: 'StaleResultError' });
    });

    test('lets a newer request of one feature supersede the older, and an aborted one stop waiting', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.holdNextReply();
        const old = language.hover(uri, origin).catch((error: unknown) => error);
        await settle();
        const current = language.hover(uri, { line: 0, character: 1 });
        expect(((await old) as { code: number }).code).toBe(-32800);
        expect(await current).toEqual({ contents: 'hover at 1' });
        const controller = new AbortController();
        transport.holdNextReply();
        const aborted = language.completion(uri, origin, undefined, { signal: controller.signal }).catch((error: unknown) => error);
        await settle();
        controller.abort();
        expect(((await aborted) as { code: number }).code).toBe(-32800);
        transport.release();
    });

    test('lets requests that ask to run in parallel finish side by side, and still supersede the ones that do not', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.holdNextReply();
        const first = language.references(uri, origin, false, { parallel: true }).catch((error: unknown) => error);
        await settle();
        const second = language.references(uri, { line: 0, character: 1 }, false, { parallel: true });
        await second;
        transport.release();
        expect(await first).not.toBeInstanceOf(Error);
        transport.holdNextReply();
        const old = language.references(uri, origin).catch((error: unknown) => error);
        await settle();
        void language.references(uri, { line: 0, character: 1 });
        expect(((await old) as { code: number }).code).toBe(-32800);
        transport.release();
    });

    test('says why the daemon could not answer, in the codes of LSP', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        const refuse = (code: string) =>
            transport.answers.set('language.request', () => {
                throw new TransportError(code, `refused ${code}`);
            });
        refuse('language-unavailable');
        await expect(language.hover(uri, origin)).rejects.toMatchObject({ code: -32002 });
        refuse('language-unsupported');
        await expect(language.hover(uri, origin)).rejects.toMatchObject({ code: -32601 });
        refuse('language-failed');
        await expect(language.hover(uri, origin)).rejects.toMatchObject({ code: -32603, message: 'refused language-failed' });
        refuse('disconnected');
        await expect(language.hover(uri, origin)).rejects.toMatchObject({ code: 'disconnected' });
    });

    test('resolves an item against the process that produced it and only for the text it was made for', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.answers.set('language.request', () => ({ result: { isIncomplete: false, items: [{ label: 'a', data: 1 }] }, server: 'vue', version: 1 }));
        const result = await language.completion(uri, origin);
        const item = !Array.isArray(result) && result ? result.items[0] : null;
        expect(item).toBeTruthy();
        transport.answers.set('language.request', () => ({ result: { label: 'a', detail: 'resolved' }, server: 'vue', version: 1 }));
        await language.resolveCompletion(uri, item!);
        expect(transport.callsOf('language.request').at(-1)?.payload).toMatchObject({
            method: 'completionItem/resolve',
            server: 'vue',
            params: { label: 'a', data: 1 }
        });
        await language.changeDocument(uri, [{ text: 'let b;' }]);
        await expect(language.resolveCompletion(uri, item!)).rejects.toMatchObject({ name: 'StaleResultError' });
    });

    test('resolves an item of a merged list against the process that made that item', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.answers.set('language.request', () => ({
            result: { isIncomplete: false, items: [{ label: 'a' }, { label: 'flex' }] },
            server: 'typescript',
            version: 1,
            itemServers: ['typescript', 'tailwind']
        }));
        const result = await language.completion(uri, origin);
        const items = !Array.isArray(result) && result ? result.items : [];
        transport.answers.set('language.request', () => ({ result: { label: 'flex' }, server: 'tailwind', version: 1 }));
        await language.resolveCompletion(uri, items[1]!);
        expect(transport.callsOf('language.request').at(-1)?.payload).toMatchObject({ method: 'completionItem/resolve', server: 'tailwind' });
        await language.resolveCompletion(uri, items[0]!);
        expect(transport.callsOf('language.request').at(-1)?.payload).toMatchObject({ server: 'typescript' });
    });
});

describe('events', () => {
    test('passes diagnostics of the open documents on with the server that sent them, and drops those of another version', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        const reports: DiagnosticsReport[] = [];
        language.onDiagnostics((report) => reports.push(report));
        const diagnostic = { range: { start: origin, end: origin }, message: 'bad' };
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics: [diagnostic] });
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'vue', version: 9, diagnostics: [diagnostic] });
        transport.emit('language.diagnostics', { projectId: 'p2', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics: [diagnostic] });
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/other.ts', server: 'typescript', version: 1, diagnostics: [diagnostic] });
        expect(reports).toEqual([{ uri, source: 'typescript', version: 1, diagnostics: [diagnostic] }]);
        void language.changeDocument(uri, [{ text: 'let a = 2;' }]);
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics: [] });
        expect(reports).toHaveLength(1);
    });

    test('tells the listeners what a document may ask when a server came up', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        const changed: string[] = [];
        language.onProvidersChanged((changedUri) => changed.push(changedUri));
        transport.emit('language.providers', { projectId: 'p1', path: 'src/a.ts', providers: { 'textDocument/rename': { prepareProvider: true } } });
        expect(changed).toEqual([uri]);
        expect(language.supports('textDocument/rename', uri)).toBe(true);
        expect(language.supports('textDocument/hover', uri)).toBe(false);
    });

    test('stops listening and closes its documents when it is disposed', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        language.dispose();
        await settle();
        expect(transport.documents.size).toBe(0);
        const reports: DiagnosticsReport[] = [];
        language.onDiagnostics((report) => reports.push(report));
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics: [] });
        expect(reports).toEqual([]);
    });
});

describe('commands', () => {
    const command = { title: 'Fix all', command: 'fix.all', arguments: [1] };

    test('runs a command of an item on the server that made it', async () => {
        const { transport, language } = service();
        await language.openDocument({ uri, languageId: 'typescript', text: 'let a = 1;' });
        transport.answers.set('language.request', () => ({ result: [{ title: 'Fix', command }], server: 'vue', version: 1 }));
        transport.answers.set('language.command', () => ({ result: 'done', server: 'vue' }));
        const actions = await language.codeActions(uri, { start: origin, end: origin });
        const item = actions![0] as { command: typeof command };
        expect(await language.executeCommand(uri, item.command)).toBe('done');
        expect(transport.callsOf('language.command')[0].payload).toEqual({
            projectId: 'p1',
            path: 'src/a.ts',
            command: 'fix.all',
            arguments: [1],
            server: 'vue'
        });
    });

    test('hands an edit the server asks for to the host and answers with what it said', async () => {
        const transport = new FakeLanguageTransport();
        const asked: unknown[] = [];
        const language = new WireLanguageService({
            transport,
            projectId: 'p1',
            folder,
            textOf: () => '',
            applyEdit: async (params) => {
                asked.push(params);
                return { applied: false, failureReason: 'read only' };
            }
        });
        transport.answers.set('language.edit.answer', () => ({}));
        transport.emit('language.edit', { projectId: 'p1', editId: 'edit-1', label: 'Fix', edit: { changes: {} } });
        transport.emit('language.edit', { projectId: 'p2', editId: 'edit-2', edit: { changes: {} } });
        await settle();
        expect(asked).toEqual([{ label: 'Fix', edit: { changes: {} } }]);
        expect(transport.callsOf('language.edit.answer').map((call) => call.payload)).toEqual([
            { projectId: 'p1', editId: 'edit-1', applied: false, failureReason: 'read only' }
        ]);
        language.dispose();
    });

    test('refuses an edit while no host is attached', async () => {
        const { transport } = service();
        transport.answers.set('language.edit.answer', () => ({}));
        transport.emit('language.edit', { projectId: 'p1', editId: 'edit-1', edit: {} });
        await settle();
        expect(transport.callsOf('language.edit.answer')[0].payload).toMatchObject({ applied: false });
    });
});

describe('uris', () => {
    test('turns a stored path into the URI the servers use and back', () => {
        const { language } = service();
        expect(language.uriOfPath('src/a.ts')).toBe(uri);
        expect(language.uriOfPath('/elsewhere/x.ts')).toBe('file:///elsewhere/x.ts');
        expect(language.pathOfLocation(uri)).toBe('src/a.ts');
        expect(language.pathOfLocation('https://example.com/a.ts')).toBeNull();
    });
});
