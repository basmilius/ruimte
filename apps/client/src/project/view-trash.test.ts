import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from '@/actions/client-actions';
import { undoLatestDeletion } from '@/project/view-trash';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { UNDO_MS, useToasts } from '@/state/toasts';
import { watchNodes } from '@/terminal/lifecycle-watch';
import type { ActionCall } from '@ruimte/actions';

const board: ProjectCanvasView = {
    kind: 'canvas',
    id: 'board',
    name: 'Test 4',
    nodes: [
        { id: 'shell', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 400, h: 300 },
        { id: 'helper', kind: 'chat', title: 'Helper', x: 500, y: 0, w: 400, h: 300 }
    ],
    texts: [],
    edges: [],
    layouts: []
};

const other: ProjectCanvasView = { kind: 'canvas', id: 'other', name: 'Other', nodes: [], texts: [], edges: [], layouts: [] };

const document: ProjectDocument = { version: 3, rev: 1, name: 'p', color: '#000', views: [other, board] };

const registry = createClientActionRegistry(useDocument, {
    viewDeletion: {
        folder: () => '/repo',
        isUnsaved: () => false,
        save: async () => true,
        working: () => false,
        endedBy: async () => []
    }
});

let ended: string[] = [];
let stop: (() => void) | null = null;

const deleteBoard = async (call: ActionCall<void> = PERSON_ACTION_CALL) => {
    const asked = await registry.execute('view.delete', { viewId: 'board' }, call);
    if (asked.status !== 'needs_confirmation') {
        throw new Error('Expected confirmation');
    }
    return registry.confirm(asked.confirmationToken, true, call);
};

const viewIds = (): string[] => useDocument.getState().views.map((view) => view.id);

beforeEach(() => {
    jest.useFakeTimers();
    ended = [];
    focusedCanvas().getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(document, { activeViewId: 'board', views: {} });
    stop = watchNodes((_endpointId, id, kind) => ended.push(`${kind}:${id}`));
});

afterEach(() => {
    stop?.();
    stop = null;
    useDocument.getState().purgeTrash();
    for (const toast of useToasts.getState().toasts) {
        useToasts.getState().dismiss(toast.id);
    }
    jest.useRealTimers();
});

describe('a view a person deletes', () => {
    test('goes at once, with a toast to take it back, while its terminal and chat keep running', async () => {
        expect(await deleteBoard()).toMatchObject({ status: 'completed', output: { viewId: 'board', view: 'Test 4' } });
        expect(viewIds()).toEqual(['other']);
        expect(useDocument.getState().activeViewId).toBe('other');
        expect(useToasts.getState().toasts).toMatchObject([{ kind: 'deleted', title: 'Deleted view “Test 4”', action: { label: 'Undo' } }]);
        // The file still has it, so no other client and no daemon lets go of what runs on it.
        expect(
            useDocument
                .getState()
                .fileViews()
                .map((view) => view.id)
        ).toEqual(['other', 'board']);
        jest.advanceTimersByTime(UNDO_MS - 1);
        expect(ended).toEqual([]);
    });

    test('comes back with the same sessions when the undo key is pressed in time', async () => {
        await deleteBoard();
        jest.advanceTimersByTime(UNDO_MS - 1);

        expect(undoLatestDeletion(useDocument)).toBe(true);
        expect(viewIds()).toEqual(['other', 'board']);
        expect(useDocument.getState().activeViewId).toBe('board');
        expect(focusedCanvas().getState().order).toEqual(['shell', 'helper']);
        expect(useToasts.getState().toasts).toEqual([]);

        jest.advanceTimersByTime(UNDO_MS);
        expect(ended).toEqual([]);
        expect(useDocument.getState().trashed).toEqual([]);
        expect(undoLatestDeletion(useDocument)).toBe(false);
    });

    test('comes back from the button on the toast the same way', async () => {
        await deleteBoard();
        useToasts.getState().toasts[0]!.action!.run();
        expect(viewIds()).toEqual(['other', 'board']);
        expect(useToasts.getState().toasts).toEqual([]);
        expect(ended).toEqual([]);
    });

    test('ends its sessions and leaves the file once the toast runs out', async () => {
        await deleteBoard();
        const edits = useDocument.getState().edits;
        jest.advanceTimersByTime(UNDO_MS);

        expect(ended.sort()).toEqual(['chat:helper', 'terminal:shell']);
        expect(useToasts.getState().toasts).toEqual([]);
        expect(
            useDocument
                .getState()
                .fileViews()
                .map((view) => view.id)
        ).toEqual(['other']);
        // The purge is the edit, so the next save writes the view out of the file.
        expect(useDocument.getState().edits).toBe(edits + 1);
        expect(undoLatestDeletion(useDocument)).toBe(false);
    });

    test('ends its sessions at once when the toast is dismissed', async () => {
        await deleteBoard();
        useToasts.getState().dismiss(useToasts.getState().toasts[0]!.id);
        expect(ended.sort()).toEqual(['chat:helper', 'terminal:shell']);
        expect(viewIds()).toEqual(['other']);
    });

    test('can be taken back through the undo of the action as well', async () => {
        const done = await deleteBoard();
        if (done.status !== 'completed' || !done.undoToken) {
            throw new Error('Expected an undo');
        }
        expect(await registry.undo(done.undoToken, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(viewIds()).toEqual(['other', 'board']);
        expect(useToasts.getState().toasts).toEqual([]);
    });
});

describe('a view voice deletes', () => {
    test('goes for good after the confirmation, without a toast', async () => {
        expect(await deleteBoard(VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(ended.sort()).toEqual(['chat:helper', 'terminal:shell']);
        expect(useToasts.getState().toasts).toEqual([]);
        expect(
            useDocument
                .getState()
                .fileViews()
                .map((view) => view.id)
        ).toEqual(['other']);
    });
});
