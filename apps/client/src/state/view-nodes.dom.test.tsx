import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { act, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useViewNodes } from '@/state/view-nodes';
import { mount, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ id: 'chat', kind: 'chat', title: 'Plan', x: 0, y: 0, w: 400, h: 300 }],
    texts: [],
    edges: [],
    layouts: []
};

let page: Mounted;
let renders = 0;

function Titles() {
    const nodes = useViewNodes((views, nodesOf) => views.flatMap(nodesOf), shallow);
    useEffect(() => {
        renders += 1;
    });
    return <p>{nodes.map((node) => node.title).join(',')}</p>;
}

beforeEach(async () => {
    renders = 0;
    useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: [MAIN] }, null);
    page = mount();
    await page.render(<Titles />);
});

afterEach(async () => {
    await page.unmount();
    defaultCanvases.keep([]);
});

describe('useViewNodes', () => {
    test('draws the editor of a canvas on screen, and again only when one of its nodes changes', async () => {
        expect(page.host.textContent).toBe('Plan');
        const editor = defaultCanvases.of('main');
        await act(async () => editor.getState().loadView(MAIN, null));
        await act(async () => editor.getState().renameNode('chat', 'Ship'));
        expect(page.host.textContent).toBe('Ship');
        const settled = renders;
        await act(async () => editor.setState({ selection: ['chat'] }));
        expect(renders).toBe(settled);
    });

    test('goes back to the document when the canvas leaves the screen', async () => {
        const editor = defaultCanvases.of('main');
        await act(async () => editor.getState().loadView(MAIN, null));
        await act(async () => editor.getState().renameNode('chat', 'Ship'));
        await act(async () => defaultCanvases.release('main'));
        expect(page.host.textContent).toBe('Plan');
    });
});
