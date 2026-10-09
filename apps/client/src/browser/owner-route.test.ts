import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { ProjectDocumentSchema, withNodeAsView, withViewAsNode, type ProjectCanvasView } from '@ruimte/contracts';
import { createClientActionRegistry, PERSON_ACTION_CALL } from '@/actions/client-actions';
import { readNodeHost } from '@/nodes/node-host';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { openLinkBeside } from './open-beside';
import { browserRouteAvailable } from './owner-route';
import { browserRegistry } from './registry';

const originalGlobals = new Map(['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalEndpoints = useEndpoints.getState();
const elements: FakeWebview[] = [];
const keys = new Set<string>();
class FakeWebview {
    style = {};
    attributes = new Map<string, string>();
    loads: string[] = [];
    removed = false;
    history = 0;
    getWebContentsId(): number {
        return 100 + elements.indexOf(this);
    }
    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }
    listeners = new Map<string, (() => void)[]>();
    addEventListener(name: string, listener: () => void): void {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }
    async attach(): Promise<void> {
        for (const listener of this.listeners.get('dom-ready') ?? []) {
            listener();
        }
        await Promise.resolve();
        await Promise.resolve();
    }
    remove(): void {
        this.removed = true;
    }
    async loadURL(url: string): Promise<void> {
        this.loads.push(url);
    }
    goBack(): void {
        this.history++;
    }
    goForward(): void {
        this.history++;
    }
    reload(): void {
        this.history++;
    }
    reloadIgnoringCache(): void {
        this.history++;
    }
}

function machine(daemonId: string | null, activeId = 'local'): void {
    useEndpoints.setState({
        activeId,
        endpoints: originalEndpoints.endpoints.map((endpoint) => (endpoint.id === 'local' ? { ...endpoint, daemonId } : endpoint))
    });
}

function key(endpointId: string, id = 'browser'): string {
    const value = endpointKey(endpointId, id);
    keys.add(value);
    return value;
}

beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { ruimteDesktop: { bindBrowserRoute: async () => true, onBrowserRouteBlocked: () => () => {} } }
    });
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement: (tag: string) => {
                expect(tag).toBe('webview');
                const element = new FakeWebview();
                elements.push(element);
                return element;
            }
        }
    });
    machine('owner');
});

afterEach(() => {
    jest.useRealTimers();
    for (const id of keys) {
        browserRegistry.destroy(id);
    }
    keys.clear();
    elements.length = 0;
    useDocument.getState().load(null, null);
    defaultCanvases.release('canvas');
    defaultCanvases.focus(null);
    useEndpoints.setState(originalEndpoints);
    for (const [name, descriptor] of originalGlobals) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, name);
        }
    }
});

test('the real registry binds creation and every drive to the proven local owner', async () => {
    const id = key('local');
    const view = browserRegistry.ensure(id, 'http://127.0.0.1:5173/', 'owner');
    expect(view).not.toBeNull();
    expect(elements[0]!.attributes.get('src')).toBe('about:blank');
    await elements[0]!.attach();
    expect(elements[0]!.attributes.get('partition')).toBe('persist:ruimte');
    expect(elements[0]!.attributes.has('allowpopups')).toBe(false);
    browserRegistry.navigate(id, 'http://127.0.0.1:5173/page');
    expect(elements[0]!.loads).toEqual(['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/page']);
    machine('another-desktop');
    expect(elements[0]!.removed).toBe(true);
    expect(browserRegistry.has(id)).toBe(false);
    browserRegistry.navigate(id, 'http://127.0.0.1:5173/');
    browserRegistry.back(id);
    browserRegistry.forward(id);
    browserRegistry.reload(id, true);
    expect(elements[0]!.history).toBe(0);
    expect(elements[0]!.loads).toHaveLength(2);
    expect(browserRegistry.ensure(id, 'https://example.org')).toBeNull();
    expect(browserRegistry.ensure(id, 'https://example.org', 'another-desktop')).toBeNull();
    expect(elements).toHaveLength(1);
});

test('persisted nodes and views retain the owner across promotion, demotion and reopening on another desktop', async () => {
    const canvas: ProjectCanvasView = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], layouts: [] };
    useDocument.getState().load({ version: 3, rev: 1, name: 'Ports', color: '#000', views: [canvas] }, { activeViewId: 'canvas', views: {} });
    defaultCanvases.of('canvas').getState().loadView(canvas, null);
    defaultCanvases.focus('canvas');
    const actions = createClientActionRegistry(useDocument);
    const created = await actions.execute(
        'node.create',
        {
            viewId: 'canvas',
            kind: 'browser',
            title: null,
            content: null,
            command: null,
            path: null,
            provider: null,
            at: { x: 0, y: 0 },
            url: 'http://127.0.0.1:5173/',
            browserOwner: 'owner'
        },
        PERSON_ACTION_CALL
    );
    expect(created.status).toBe('completed');
    const node = Object.values(defaultCanvases.of('canvas').getState().nodes)[0]!;
    expect(node.browserOwner).toBe('owner');
    browserRegistry.ensure(key('local', node.id), node.url!, node.browserOwner);
    openLinkBeside('http://127.0.0.1:5173/linked', 100);
    await Promise.resolve();
    const linked = Object.values(defaultCanvases.of('canvas').getState().nodes).find((entry) => entry.id !== node.id)!;
    expect(linked).toMatchObject({ kind: 'browser', browserOwner: 'owner', url: 'http://127.0.0.1:5173/linked' });
    browserRegistry.destroy(key('local', node.id));
    elements.length = 0;
    const stored = ProjectDocumentSchema.parse(
        JSON.parse(JSON.stringify({ version: 3, rev: 1, name: 'Ports', color: '#000', views: useDocument.getState().exportViews() }))
    );
    const promoted = withNodeAsView(stored.views, node.id)!;
    expect(promoted.view).toMatchObject({ kind: 'browser', browserOwner: 'owner' });
    const demoted = withViewAsNode(promoted.views, node.id, 'canvas', { x: 10, y: 20 })!;
    expect(demoted.node.browserOwner).toBe('owner');
    defaultCanvases.release('canvas');
    defaultCanvases.focus(null);
    // Both a remote project and a copied local project must keep the original machine binding.
    for (const endpointId of ['owner', 'local']) {
        machine('another-desktop', endpointId);
        for (const views of [stored.views, promoted.views, demoted.views]) {
            useDocument.getState().load({ ...stored, views }, null);
            const board = views.find((view) => view.kind === 'canvas') as ProjectCanvasView;
            defaultCanvases.of('canvas').getState().loadView(board, null);
            const host = readNodeHost(node.id)!;
            expect(host.browserOwner).toBe('owner');
            expect(browserRegistry.ensure(key(endpointId, node.id), host.url!, host.browserOwner)).toBeNull();
            expect(await actions.execute('browser.navigate', { nodeId: node.id, url: 'http://127.0.0.1:5173/next' }, PERSON_ACTION_CALL)).toMatchObject({
                error: { code: 'browser-owner-unavailable' }
            });
            expect(await actions.execute('browser.reload', { nodeId: node.id, hard: false }, PERSON_ACTION_CALL)).toMatchObject({
                error: { code: 'browser-owner-unavailable' }
            });
            defaultCanvases.release('canvas');
        }
    }
    expect(elements).toEqual([]);
});

test('standalone creation persists the owner and refuses an owner without a local route', async () => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'Ports', color: '#000', views: [] }, null);
    const actions = createClientActionRegistry(useDocument);
    expect(
        await actions.execute(
            'view.create',
            { kind: 'browser', name: null, command: null, path: null, provider: null, url: 'http://[::1]:3000/', browserOwner: 'owner' },
            PERSON_ACTION_CALL
        )
    ).toMatchObject({ status: 'completed' });
    const view = useDocument.getState().exportViews()[0]!;
    expect(view).toMatchObject({ kind: 'browser', browserOwner: 'owner' });
    machine('other');
    expect(
        await actions.execute(
            'view.create',
            { kind: 'browser', name: null, command: null, path: null, provider: null, url: 'http://[::1]:3000/', browserOwner: 'owner' },
            PERSON_ACTION_CALL
        )
    ).toMatchObject({ error: { code: 'browser-owner-unavailable' } });
    expect(useDocument.getState().views).toHaveLength(1);
    expect(browserRegistry.ensure(key('local', view.id), 'http://[::1]:3000/', 'owner')).toBeNull();
});

test('legacy remote localhost is blocked on reopen and navigation, and unproven owners have no route', () => {
    expect(browserRegistry.ensure(key('remote'), 'http://localhost:5173/')).toBeNull();
    const remote = key('remote', 'public');
    expect(browserRegistry.ensure(remote, 'https://example.org')).not.toBeNull();
    browserRegistry.navigate(remote, 'http://127.1:5173/');
    expect(elements[0]!.removed).toBe(true);
    expect(elements[0]!.loads).toEqual([]);
    machine(null);
    expect(browserRegistry.ensure(key('local'), 'http://127.0.0.1:5173/', 'owner')).toBeNull();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    expect(browserRouteAvailable('owner', 'http://127.0.0.1:5173/', 'owner')).toBe(false);
    expect(browserRegistry.ensure(key('owner'), 'http://127.0.0.1:5173/', 'owner')).toBeNull();
});

test('a legacy host cannot open remote public guests or owned guests without a navigation guard', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ruimteDesktop: {} } });
    expect(browserRegistry.ensure(key('remote'), 'https://example.org')).toBeNull();
    expect(browserRegistry.ensure(key('local'), 'http://127.0.0.1:5173/', 'owner')).toBeNull();
    expect(browserRegistry.ensure(key('local', 'ordinary'), 'http://127.0.0.1:5173/')).not.toBeNull();
});

test('a delayed host binding cannot load a destroyed or replaced guest', async () => {
    let accept!: (value: boolean) => void;
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            ruimteDesktop: {
                bindBrowserRoute: () =>
                    new Promise<boolean>((resolve) => {
                        accept = resolve;
                    }),
                onBrowserRouteBlocked: () => () => {}
            }
        }
    });
    const id = key('remote');
    browserRegistry.ensure(id, 'https://example.org');
    const first = elements[0]!;
    await first.attach();
    browserRegistry.navigate(id, 'https://example.org/queued');
    expect(first.loads).toEqual([]);
    browserRegistry.destroy(id);
    browserRegistry.ensure(id, 'https://example.org/replacement');
    accept(true);
    await Promise.resolve();
    expect(first.loads).toEqual([]);
    expect(elements[1]!.loads).toEqual([]);
    expect(first.removed).toBe(true);
});

test('navigation waits for the captured route and only loads the latest pending destination', async () => {
    const bindings: unknown[] = [];
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            ruimteDesktop: {
                bindBrowserRoute: async (binding: unknown) => {
                    bindings.push(binding);
                    return true;
                },
                onBrowserRouteBlocked: () => () => {}
            }
        }
    });
    const id = key('remote');
    browserRegistry.ensure(id, 'https://example.org');
    browserRegistry.navigate(id, 'https://example.org/queued');
    machine('owner', 'local');
    expect(elements[0]!.loads).toEqual([]);
    await elements[0]!.attach();
    expect(bindings).toEqual([{ webContentsId: 100, endpointId: 'remote', localMachineId: 'owner', owner: undefined }]);
    expect(elements[0]!.loads).toEqual(['https://example.org/queued']);
});

test('an expired binding fails closed and a late acceptance cannot load the guest', async () => {
    jest.useFakeTimers();
    let accept!: (value: boolean) => void;
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            ruimteDesktop: {
                bindBrowserRoute: () =>
                    new Promise<boolean>((resolve) => {
                        accept = resolve;
                    }),
                onBrowserRouteBlocked: () => () => {}
            }
        }
    });
    const id = key('remote');
    browserRegistry.ensure(id, 'https://example.org');
    const element = elements[0]!;
    await element.attach();
    jest.advanceTimersByTime(5_000);
    expect(element.removed).toBe(true);
    expect(browserRegistry.has(id)).toBe(false);
    accept(true);
    await Promise.resolve();
    expect(element.loads).toEqual([]);
});
