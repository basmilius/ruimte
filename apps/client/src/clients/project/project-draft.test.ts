import { describe, expect, test } from 'bun:test';
import { ProjectDocumentSchema, type ProjectCanvasView } from '@ruimte/contracts';
import { fakeStorage } from '../../project/fixtures';
import { readProjectDraft, writeProjectDraft } from './project-draft';

// The way a newer machine sends it: keys on a node, a view and a text that this version has no field for.
const NEWER = ProjectDocumentSchema.parse({
    version: 3,
    rev: 4,
    name: 'p',
    color: '#000',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'main',
            futureView: true,
            nodes: [{ id: 'file', kind: 'file', title: 'File', x: 0, y: 0, w: 320, h: 200, path: 'a.ts', location: { line: 3 } }],
            texts: [{ id: 'label', x: 0, y: 0, text: 'Note', size: 16, futureStyle: 'wavy' }],
            edges: [],
            layouts: []
        }
    ]
});

describe('a local draft', () => {
    test('restores the fields this version does not know', () => {
        const storage = fakeStorage(new Map());
        writeProjectDraft(storage, 'daemon-a', 'p1', NEWER, NEWER);

        const draft = readProjectDraft(storage, 'daemon-a', 'p1')!;
        const view = draft.document.views[0] as ProjectCanvasView;
        expect(view).toMatchObject({ futureView: true });
        expect(view.nodes[0]).toMatchObject({ location: { line: 3 } });
        expect(view.texts[0]).toMatchObject({ futureStyle: 'wavy' });
        expect(draft.base).toEqual(draft.document);
    });
});
