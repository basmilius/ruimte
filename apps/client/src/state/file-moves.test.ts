import { beforeEach, describe, expect, test } from 'bun:test';
import { viewStateKey, viewStates } from '@adecore/editor-react';
import type { Transport } from '@/transport-api/transport';
import { useDocument } from './document.ts';
import { followMove, moveFile, saveBeforeMove } from './file-moves.ts';
import { useFiles } from './files.ts';
import { useProject } from './project.ts';
import { useTextDrafts, type TextDraft, type TextDrafts } from './text-drafts.ts';

const row = (text: string): TextDraft => ({ disk: 'disk', mtime: 1, text, saving: false, problem: null });

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
        useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: [] }, null);
        useFiles.setState({ tabs: [{ key: '/p/a.ts', path: '/p/a.ts', pinned: false }], caret: null });
        useDocument.getState().showLoose('/p/a.ts');
        viewStates.clear();
    });

    test('asks the machine, tells the project so its servers hear of it, and takes the tabs and places along', async () => {
        const { asked, transport } = machine();
        viewStates.set('m:/p/a.ts', { scrollTop: 5, line: 3, column: 1, folds: { collapsed: [], custom: [] } });
        useTextDrafts.setState({ rows: {} });
        await moveFile(transport, 'm', 'p1', '/p/a.ts', '/p/b.ts', { edits: true });
        expect(asked).toEqual([{ type: 'fs.rename', payload: { path: '/p/a.ts', to: '/p/b.ts', projectId: 'p1', edits: true } }]);
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/p/b.ts']);
        expect(useDocument.getState().activeViewId).toBe('/p/b.ts');
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
            'Could not save the changes in a.ts, so nothing moved.'
        );
        expect(asked).toEqual([]);
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/p/a.ts']);
    });

    test('the cell that holds the tab follows the file', () => {
        followMove('m', '/p/a.ts', '/p/b.ts');
        expect(useDocument.getState().layout!.columns[0]!.cells[0]).toEqual({ viewId: '/p/b.ts', size: 1 });
    });

    describe('the file views of a project', () => {
        const views = () => useDocument.getState().views.map((view) => (view.kind === 'file' ? [view.name, view.path] : [view.kind]));

        beforeEach(() => {
            useDocument.getState().load(
                {
                    version: 3,
                    rev: 1,
                    name: 'p',
                    color: '#000',
                    views: [
                        { kind: 'file', id: 'v1', name: 'a.ts', path: 'src/a.ts' },
                        { kind: 'file', id: 'v2', name: 'Entry point', path: 'src/b.ts' },
                        { kind: 'file', id: 'v3', name: 'other.ts', path: 'src2/other.ts' },
                        { kind: 'file', id: 'v4', name: 'outside.ts', path: '/elsewhere/outside.ts' },
                        { kind: 'drawing', id: 'v5', name: 'Sketch' }
                    ]
                },
                null
            );
        });

        test('follow a file that moved, and take the new name when they were named after the file', () => {
            const edits = useDocument.getState().edits;
            useDocument.getState().followMovedFiles('/p', '/p/src/a.ts', '/p/lib/renamed.ts');
            useDocument.getState().followMovedFiles('/p', '/p/src/b.ts', '/p/src/c.ts');

            expect(views()).toEqual([
                ['renamed.ts', 'lib/renamed.ts'],
                ['Entry point', 'src/c.ts'],
                ['other.ts', 'src2/other.ts'],
                ['outside.ts', '/elsewhere/outside.ts'],
                ['drawing']
            ]);
            expect(useDocument.getState().edits).toBe(edits + 2);
        });

        test('follow a folder that moved, one beside it staying where it is, and a file outside the project keeps an absolute path', () => {
            useDocument.getState().followMovedFiles('/p', '/p/src', '/p/lib');
            useDocument.getState().followMovedFiles('/p', '/elsewhere', '/p/vendor');

            expect(views()).toEqual([
                ['a.ts', 'lib/a.ts'],
                ['Entry point', 'lib/b.ts'],
                ['other.ts', 'src2/other.ts'],
                ['outside.ts', 'vendor/outside.ts'],
                ['drawing']
            ]);
        });

        test('claim no edit when no view is at the path, and follow a move through followMove', () => {
            const edits = useDocument.getState().edits;
            useDocument.getState().followMovedFiles('/p', '/p/nothing.ts', '/p/other.ts');
            expect(useDocument.getState().edits).toBe(edits);

            useProject.setState({ current: { folder: '/p' } as never });
            followMove('m', '/p/src/a.ts', '/p/src/z.ts');
            useProject.setState({ current: null });

            expect(views()[0]).toEqual(['z.ts', 'src/z.ts']);
        });
    });

    test('keeps the keyboard where it is unless asked', () => {
        followMove('m', '/p/a.ts', '/p/b.ts');
        expect(useFiles.getState().caret).toBeNull();
    });
});
