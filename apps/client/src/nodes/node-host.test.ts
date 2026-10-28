import { beforeEach, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { readNodeHost, resetTitle, updateHost } from '@/nodes/node-host';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';

const design = {
    id: 'design-1',
    kind: 'design',
    title: 'Landing',
    titleSource: 'user',
    path: 'landing',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    chats: [{ id: 'later-1', name: 'Second pass', node: { provider: 'claude' } }]
};

beforeEach(() => {
    const canvas = { kind: 'canvas', id: 'a', name: 'Canvas', nodes: [design], texts: [], edges: [], layouts: [] } as unknown as ProjectCanvasView;
    useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: [canvas] }, { activeViewId: 'a', views: {} });
    focusedCanvas().getState().setViewport({ w: 800, h: 600 });
});

test('a later chat of a design node takes a new folder into its node list of chats', () => {
    updateHost('later-1', { cwd: '/repo/wt' });

    expect(focusedCanvas().getState().nodes['design-1']?.chats).toEqual([
        { id: 'later-1', name: 'Second pass', node: { provider: 'claude', cwd: '/repo/wt' } }
    ]);
    expect(readNodeHost('later-1')).toMatchObject({ id: 'later-1', kind: 'chat', cwd: '/repo/wt' });
});

test('clearing the title of a design keeps it named by a person, so a prompt to its chat cannot rename it', () => {
    resetTitle('design-1');

    expect(focusedCanvas().getState().nodes['design-1']).toMatchObject({ title: 'Design', titleSource: 'user' });
});
