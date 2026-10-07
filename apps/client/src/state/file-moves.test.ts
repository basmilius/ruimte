import { beforeEach, describe, expect, test } from 'bun:test';
import { viewStateKey, viewStates } from '@/shell/panels/editor-view-state-host';
import type { Transport } from '@/transport/transport';
import { followMove, moveFile, saveBeforeMove } from './file-moves.ts';
import { useFiles } from './files.ts';
import { useTextDrafts, type TextDraft, type TextDrafts } from './text-drafts.ts';

const row = (text: string): TextDraft => ({ disk: 'disk', mtime: 1, text, saving: false, problem: null });

/* Saves what it is asked to and says which of them it could not. */
function drafts(refuse: string[] = []): { fake: TextDrafts; saved: string[] } {
    const saved: string[] = [];
    const fake = {
        save: async (_endpointId: string, path: string) => {
            saved.push(path);
            return !refuse.includes(path);
        }
    } as unknown as TextDrafts;
    return { fake, saved };
}

beforeEach(() => {
    useTextDrafts.setState({
        rows: {
            'm:/p/src/a.ts': row('changed'),
            'm:/p/src/b.ts': row('disk'),
            'm:/p/src2/c.ts': row('changed'),
            'other:/p/src/d.ts': row('changed')
        }
    });
});

describe('saving before a move', () => {
    test('saves the unsaved files of the folder, and nothing beside it or on another machine', async () => {
        const { fake, saved } = drafts();
        expect(await saveBeforeMove('m', '/p/src', fake)).toBeNull();
        expect(saved).toEqual(['/p/src/a.ts']);
    });

    test('names the file that could not be saved', async () => {
        const { fake } = drafts(['/p/src/a.ts']);
        expect(await saveBeforeMove('m', '/p/src/a.ts', fake)).toBe('/p/src/a.ts');
    });
});

describe('moving a file', () => {
    function machine() {
        const asked: unknown[] = [];
        const transport = {
            request: async (type: string, payload: unknown) => {
                asked.push({ type, payload });
                return {};
            }
        } as unknown as Pick<Transport, 'request'>;
        return { asked, transport };
    }

    beforeEach(() => {
        useFiles.setState({ tabs: [{ key: '/p/a.ts', path: '/p/a.ts', pinned: false }], active: '/p/a.ts', caret: null });
        viewStates.clear();
    });

    test('asks the machine, tells the project so its servers hear of it, and takes the tabs and places along', async () => {
        const { asked, transport } = machine();
        viewStates.set('m:/p/a.ts', { scrollTop: 5, line: 3, column: 1, folds: { collapsed: [], custom: [] } });
        useTextDrafts.setState({ rows: {} });
        await moveFile(transport, 'm', 'p1', '/p/a.ts', '/p/b.ts', { edits: true });
        expect(asked).toEqual([{ type: 'fs.rename', payload: { path: '/p/a.ts', to: '/p/b.ts', projectId: 'p1', edits: true } }]);
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/p/b.ts']);
        expect(useFiles.getState().active).toBe('/p/b.ts');
        expect([...viewStates.keys()]).toEqual(['m:/p/b.ts']);
        expect(viewStateKey('m:/p/a.ts')).toBe('m:/p/b.ts');
    });

    test('moves without the project when there is none, and says an edit was made when the caller made it', async () => {
        const { asked, transport } = machine();
        useTextDrafts.setState({ rows: {} });
        await moveFile(transport, 'm', null, '/p/a.ts', '/p/b.ts', { edits: true });
        await moveFile(transport, 'm', 'p1', '/p/b.ts', '/p/c.ts', { edits: false, focus: true });
        expect(asked).toEqual([
            { type: 'fs.rename', payload: { path: '/p/a.ts', to: '/p/b.ts' } },
            { type: 'fs.rename', payload: { path: '/p/b.ts', to: '/p/c.ts', projectId: 'p1', edits: false } }
        ]);
        expect(useFiles.getState().caret).toMatchObject({ key: '/p/c.ts' });
    });

    test('moves nothing when what is unsaved in it cannot be saved', async () => {
        const { asked, transport } = machine();
        useTextDrafts.setState({ rows: { 'm:/p/a.ts': row('changed') } });
        const fake = drafts(['/p/a.ts']).fake;
        await expect(moveFile(transport, 'm', 'p1', '/p/a.ts', '/p/b.ts', { edits: true }, fake)).rejects.toThrow(
            'a.ts has changes that could not be saved, so nothing moved.'
        );
        expect(asked).toEqual([]);
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/p/a.ts']);
    });

    test('keeps the keyboard where it is unless asked', () => {
        followMove('m', '/p/a.ts', '/p/b.ts');
        expect(useFiles.getState().caret).toBeNull();
    });
});
