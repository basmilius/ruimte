import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ActionResult } from '@ruimte/actions';
import type { FsEntry, RequestMap, RequestType } from '@ruimte/contracts';
import { createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import type { FilesMachine } from './files-actions';
import { useDocument } from '@/state/document';

type Answers = { [Type in RequestType]?: (payload: RequestMap[Type]['payload']) => RequestMap[Type]['result'] };

const entry = (name: string): FsEntry => ({ name, path: `/repo/${name}`, kind: 'file', size: 1, mtime: 0, hidden: false, ignored: false });

/* A machine with a project in /repo: what it was asked, what the preview has open and what was copied. */
const fakes = (answers: Answers = {}, overrides: Partial<FilesMachine> = {}) => {
    const asked: { type: string; payload: unknown }[] = [];
    const open = new Map<string, number | null>();
    const copied: string[] = [];
    const revealed: string[] = [];
    const machine: Partial<FilesMachine> = {
        transport: () =>
            ({
                request: async (type: RequestType, payload: unknown) => {
                    asked.push({ type, payload });
                    const answer = answers[type] as ((payload: unknown) => unknown) | undefined;
                    if (!answer) {
                        throw new Error(`No answer for ${type}`);
                    }
                    return answer(payload);
                }
            }) as never,
        folder: () => '/repo',
        writeText: async (text) => void copied.push(text),
        isOpen: (path) => open.has(path),
        open: (path, line) => void open.set(path, line),
        close: (path) => void open.delete(path),
        reveal: (path) => void revealed.push(path),
        ...overrides
    };
    return { asked, open, copied, revealed, registry: createClientActionRegistry(useDocument, { files: machine }) };
};

const completed = <Result extends ActionResult>(result: Result): Extract<Result, { status: 'completed' }> => {
    if (result.status !== 'completed') {
        throw new Error(`Expected a completed action, got ${JSON.stringify(result)}`);
    }
    return result as Extract<Result, { status: 'completed' }>;
};

beforeEach(() => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'Atlas', color: '#000', views: [] }, null);
});

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('file actions', () => {
    test('Voice stays inside the project folder; a person names any file a node can show', async () => {
        const { registry, asked } = fakes({ 'fs.read': () => ({ kind: 'text', text: 'secret', encoding: 'utf-8', size: 6, mtime: 0 }) });
        for (const path of ['/etc/hosts', '../elsewhere/a.ts', '/repo/../etc/hosts', '/repo-old/a.ts']) {
            expect(await registry.execute('file.read', { path, fromLine: null, lines: null }, VOICE_ACTION_CALL)).toMatchObject({
                status: 'failed',
                error: { code: 'outside-project' }
            });
        }
        expect(asked).toEqual([]);
        completed(await registry.execute('file.read', { path: '/etc/hosts', fromLine: null, lines: null }, PERSON_ACTION_CALL));
        expect(asked).toEqual([{ type: 'fs.read', payload: { path: '/etc/hosts' } }]);
    });

    test('a read hands over the lines asked for and says what is left', async () => {
        const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
        const { registry } = fakes({ 'fs.read': () => ({ kind: 'text', text, encoding: 'utf-8', size: text.length, mtime: 0 }) });
        const read = completed(await registry.execute('file.read', { path: 'src/a.ts', fromLine: 3, lines: 2 }, VOICE_ACTION_CALL));
        expect(read.output).toMatchObject({ path: '/repo/src/a.ts', text: 'line 3\nline 4', fromLine: 3, toLine: 4, totalLines: 10, truncated: true });
        const binary = fakes({ 'fs.read': () => ({ kind: 'binary', mime: 'image/png', size: 9, mtime: 0 }) });
        expect(
            completed(await binary.registry.execute('file.read', { path: 'logo.png', fromLine: null, lines: null }, VOICE_ACTION_CALL)).output
        ).toMatchObject({
            kind: 'binary',
            text: null
        });
    });

    test('searches run in the project folder, with a small default for Voice and the panel’s own limit for a person', async () => {
        const { registry, asked } = fakes({
            'fs.search': () => ({ files: ['src/a.ts'], truncated: false }),
            'fs.grep': () => ({ matches: [], files: 0, truncated: false })
        });
        completed(await registry.execute('file.search', { query: 'a.ts', limit: null }, VOICE_ACTION_CALL));
        completed(await registry.execute('file.search', { query: '', limit: 200 }, PERSON_ACTION_CALL));
        completed(await registry.execute('file.grep', { query: 'TODO', regex: false, caseSensitive: true, wholeWord: false, limit: null }, VOICE_ACTION_CALL));
        expect(asked.map((ask) => ask.payload)).toEqual([
            { cwd: '/repo', query: 'a.ts', limit: 50 },
            { cwd: '/repo', query: '', limit: 200 },
            { cwd: '/repo', query: 'TODO', regex: false, caseSensitive: true, wholeWord: false, limit: 50 }
        ]);
        expect(await registry.execute('file.search', { query: 'a', limit: 10 }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'forbidden-field' } });
    });

    test('a folder lists whole for a person and cut short for Voice', async () => {
        const entries = Array.from({ length: 250 }, (_, i) => entry(`f${i}`));
        const { registry } = fakes({ 'fs.list': ({ path }) => ({ path, entries, truncated: false }) });
        expect(completed(await registry.execute('file.list', { path: null, hidden: true }, PERSON_ACTION_CALL)).output.entries).toHaveLength(250);
        const cut = completed(await registry.execute('file.list', { path: null, hidden: false }, VOICE_ACTION_CALL)).output;
        expect(cut).toMatchObject({ path: '/repo', truncated: true });
        expect(cut.entries).toHaveLength(200);
    });

    test('a preview opens at a line, and undo closes only a tab it opened', async () => {
        const { registry, open } = fakes();
        const opened = completed(await registry.execute('file.preview', { path: 'src/a.ts', line: 12 }, VOICE_ACTION_CALL));
        expect(opened.output).toEqual({ path: '/repo/src/a.ts', file: 'a.ts', opened: true });
        expect(open.get('/repo/src/a.ts')).toBe(12);
        const again = completed(await registry.execute('file.preview', { path: 'src/a.ts', line: null }, VOICE_ACTION_CALL));
        expect(again.undoToken).toBeUndefined();
        await registry.undo(opened.undoToken!, VOICE_ACTION_CALL);
        expect(open.size).toBe(0);
    });

    test('the files panel only reveals what it lists; a path is copied whole or relative', async () => {
        const { registry, revealed, copied } = fakes();
        completed(await registry.execute('file.reveal', { path: 'src' }, VOICE_ACTION_CALL));
        expect(await registry.execute('file.reveal', { path: '/tmp/x' }, PERSON_ACTION_CALL)).toMatchObject({ error: { code: 'outside-folder' } });
        expect(revealed).toEqual(['/repo/src']);
        completed(await registry.execute('file.copyPath', { path: '/repo/src/a.ts', relative: true }, VOICE_ACTION_CALL));
        completed(await registry.execute('file.copyPath', { path: 'src/a.ts', relative: false }, PERSON_ACTION_CALL));
        expect(copied).toEqual(['src/a.ts', '/repo/src/a.ts']);
    });

    test('a machine that is not connected is said so', async () => {
        const { registry } = fakes({}, { transport: () => null });
        expect(await registry.execute('file.search', { query: 'a', limit: null }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'no-machine' } });
    });
});
