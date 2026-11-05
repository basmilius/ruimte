import { beforeEach, describe, expect, test } from 'bun:test';
import { designPlaces, type ProjectCanvasView, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { restoreDesignFolders } from './design-folder-refusal';

function design(id: string, path: string): ProjectNode {
    return { id, kind: 'design', title: id, x: 0, y: 0, w: 480, h: 640, provider: 'claude', path };
}

function canvas(id: string, nodes: ProjectNode[]): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] };
}

// A shared canvas with a design on it, and a private one beside it with a design view of its own.
const VIEWS: ProjectView[] = [
    canvas('team', [design('board', 'pricing')]),
    canvas('notes', []),
    { kind: 'design', id: 'landing', name: 'Landing', path: 'landing', node: { provider: 'claude' } }
];
const SHARED = ['team'];

function placeOf(id: string): string | null | undefined {
    return designPlaces(useDocument.getState().exportViews()).find((place) => place.id === id)?.canvasId;
}

beforeEach(() => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: VIEWS, shared: SHARED }, { activeViewId: 'notes', views: {} });
});

describe('restoring design folders after a refused save', () => {
    test('a design node opened as a view goes back on its canvas', () => {
        useDocument.getState().openAsView('board');
        expect(placeOf('board')).toBeNull();

        expect(restoreDesignFolders({ views: VIEWS, shared: SHARED }, useDocument)).toBe(true);
        expect(placeOf('board')).toBe('team');
        expect(useDocument.getState().shared).toEqual(['team']);
    });

    test('a design view put on a shared canvas becomes a view of its own again', () => {
        useDocument.getState().putOnCanvas('landing', 'team');
        expect(placeOf('landing')).toBe('team');

        expect(restoreDesignFolders({ views: VIEWS, shared: SHARED }, useDocument)).toBe(true);
        expect(placeOf('landing')).toBeNull();
        expect(useDocument.getState().shared).toEqual(['team']);
    });

    test('a canvas taken out of the shared file goes back in', () => {
        useDocument.getState().setShared('team', false);

        expect(restoreDesignFolders({ views: VIEWS, shared: SHARED }, useDocument)).toBe(true);
        expect(useDocument.getState().shared).toEqual(['team']);
    });

    test('answers false when no design moved, so the refusal stays on screen', () => {
        expect(restoreDesignFolders({ views: VIEWS, shared: SHARED }, useDocument)).toBe(false);
    });
});
