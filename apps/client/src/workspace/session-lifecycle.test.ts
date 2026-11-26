import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { browserRegistry } from '@/clients/browser/registry';
import { forgetProjectSessions } from '@/workspace/session-lifecycle';

const destroy = spyOn(browserRegistry, 'destroy').mockImplementation(() => undefined);

afterAll(() => {
    destroy.mockRestore();
});

afterEach(() => {
    destroy.mockClear();
});

test("closing a project ends this client's pages of it, on a canvas and as a view", () => {
    const views = [
        {
            kind: 'canvas',
            id: 'canvas',
            name: 'Canvas',
            nodes: [
                { id: 'page', kind: 'browser', title: 'Docs', x: 0, y: 0, w: 400, h: 300, url: 'https://example.com' },
                { id: 'note', kind: 'note', title: 'Note', x: 0, y: 0, w: 200, h: 100 }
            ],
            texts: [],
            edges: [],
            layouts: []
        },
        { kind: 'browser', id: 'page-view', name: 'Site', url: 'https://example.com' }
    ] as unknown as ProjectView[];

    forgetProjectSessions('machine-1', views);

    expect(destroy.mock.calls.map(([key]) => key).sort()).toEqual(['machine-1:page', 'machine-1:page-view']);
});
