import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { useEndpoints } from '@/state/endpoints';
import { defaultCanvases, NODE_SIZE } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { openVerifiedSessionPort } from './open-session-port';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalEndpoints = useEndpoints.getState();

const source: ProjectCanvasView = { kind: 'canvas', id: 'source', name: 'Source', nodes: [], texts: [], edges: [], layouts: [] };
const other: ProjectCanvasView = { ...source, id: 'other', name: 'Other' };

beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { ruimteDesktop: { bindBrowserRoute: async () => true, onBrowserRouteBlocked: () => () => {} } }
    });
    useEndpoints.setState({
        activeId: 'local',
        endpoints: originalEndpoints.endpoints.map((endpoint) => (endpoint.id === 'local' ? { ...endpoint, daemonId: 'owner-machine' } : endpoint))
    });
    useDocument.getState().load({ version: 3, rev: 1, name: 'Ports', color: '#000', views: [source, other] }, { activeViewId: 'other', views: {} });
    defaultCanvases.of('source').getState().loadView(source, null);
    defaultCanvases.of('other').getState().loadView(other, null);
    useDocument.getState().splitFocused('right', 'source');
    useDocument.getState().showView('other');
    defaultCanvases.focus('other');
});

afterEach(() => {
    if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
        Reflect.deleteProperty(globalThis, 'window');
    }
    useEndpoints.setState(originalEndpoints);
    useDocument.getState().load(null, null);
    defaultCanvases.release('source');
    defaultCanvases.release('other');
    defaultCanvases.focus(null);
});

test('the verified chip uses browser and link actions beside its own terminal, even on another canvas', async () => {
    const canvas = defaultCanvases.of('source');
    const id = canvas.getState().addNode('terminal', { x: 400, y: 400 })!;
    const terminal = canvas.getState().nodes[id]!;
    await openVerifiedSessionPort(id, 'http://127.0.0.1:5173/', 'owner-machine');
    const browsers = Object.values(canvas.getState().nodes).filter((node) => node.kind === 'browser');
    expect(browsers).toHaveLength(1);
    expect(browsers[0]).toMatchObject({
        url: 'http://127.0.0.1:5173/',
        browserOwner: 'owner-machine',
        x: terminal.x + terminal.w + 32,
        y: terminal.y,
        w: NODE_SIZE.browser.w
    });
    expect(canvas.getState().edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: id, to: browsers[0]!.id })]));
    expect(Object.values(defaultCanvases.of('other').getState().nodes)).toEqual([]);
});

test('a removed source cannot fall back to opening an unrelated browser view', async () => {
    await openVerifiedSessionPort('gone', 'http://127.0.0.1:5173/', 'owner-machine');
    expect(useDocument.getState().views).toHaveLength(2);
});

test('a standalone terminal opens a browser view through the existing view action', async () => {
    const id = useDocument.getState().addStandaloneView({ kind: 'terminal', name: 'Shell', node: {} })!;
    await openVerifiedSessionPort(id, 'http://[::1]:3000/', 'owner-machine');
    expect(useDocument.getState().views).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'browser', url: 'http://[::1]:3000/', browserOwner: 'owner-machine' })])
    );
});

test('an owner mismatch refuses creation before any browser or edge is added', async () => {
    const canvas = defaultCanvases.of('source');
    const id = canvas.getState().addNode('terminal', { x: 0, y: 0 })!;
    await expect(openVerifiedSessionPort(id, 'http://127.0.0.1:5173/', 'other-machine')).rejects.toThrow('cannot reach');
    expect(Object.values(canvas.getState().nodes).filter((node) => node.kind === 'browser')).toEqual([]);
    expect(canvas.getState().edges).toEqual([]);
});
