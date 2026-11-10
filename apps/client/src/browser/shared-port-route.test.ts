import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { PortGrant } from '@ruimte/contracts';
import { browserRouteAvailable } from '@/clients/browser/owner-route';
import { browserRegistry } from '@/clients/browser/registry';
import { usePortGrants } from '@/port-tunnel/grants';
import { portTunnelPages, usePortTunnelPartitions } from '@/port-tunnel/tunnel-pages';
import { useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';

const originalGlobals = new Map(['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalEndpoints = useEndpoints.getState();
const originalProject = useProject.getState().current;

class FakeWebview {
    style = {};
    attributes = new Map<string, string>();
    loads: string[] = [];
    removed = false;

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    addEventListener(): void {}

    remove(): void {
        this.removed = true;
    }

    async loadURL(url: string): Promise<void> {
        this.loads.push(url);
    }

    getWebContentsId(): number {
        return 100;
    }
}

const elements: FakeWebview[] = [];
const keys = new Set<string>();
const opened: Array<{ endpointId: string; grantId: string; port: number }> = [];
const closed: string[] = [];

const grant: PortGrant = { id: 'grant-1', projectId: 'project-1', host: '127.0.0.1', port: 3000, sharedBy: 'person', createdAt: 1 };

function key(endpointId: string, id = 'browser'): string {
    const value = endpointKey(endpointId, id);

    keys.add(value);

    return value;
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
        await Promise.resolve();
    }
}

function shell(withTunnels: boolean): object {
    return {
        bindBrowserRoute: async () => true,
        onBrowserRouteBlocked: () => () => {},
        ...(withTunnels
            ? {
                  openPortTunnel: async (request: { endpointId: string; grantId: string; port: number }) => {
                      opened.push(request);

                      return { id: `tunnel-${opened.length}`, partition: `ruimte-port-${opened.length}` };
                  },
                  closePortTunnel: (id: string) => closed.push(id),
                  onPortTunnel: () => () => {},
                  portTunnelSend: () => {}
              }
            : {})
    };
}

beforeEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ruimteDesktop: shell(true) } });
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement: () => {
                const element = new FakeWebview();

                elements.push(element);

                return element;
            }
        }
    });
    useProject.setState({ current: { projectId: 'project-1' } as never });
    usePortGrants.setState({ byEndpoint: { remote: [grant] } });
});

afterEach(() => {
    for (const id of keys) {
        browserRegistry.destroy(id);
    }

    keys.clear();
    elements.length = 0;
    opened.length = 0;
    closed.length = 0;
    usePortGrants.setState({ byEndpoint: {} });
    usePortTunnelPartitions.setState({ byKey: {} });
    useProject.setState({ current: originalProject });
    useEndpoints.setState(originalEndpoints);

    for (const [name, descriptor] of originalGlobals) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, name);
        }
    }
});

test('a loopback address of another machine opens only through a port that machine shares for this project', () => {
    expect(browserRouteAvailable('remote', 'http://localhost:3000/', undefined)).toBe(true);
    expect(browserRouteAvailable('remote', 'http://127.0.0.1:3000/x', undefined)).toBe(true);
    expect(browserRouteAvailable('remote', 'http://localhost:3001/', undefined)).toBe(false);

    useProject.setState({ current: { projectId: 'project-2' } as never });

    expect(browserRouteAvailable('remote', 'http://localhost:3000/', undefined)).toBe(false);
});

test('a shell without the tunnel bridge, or the machine of this very app, gets no shared route', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ruimteDesktop: shell(false) } });

    expect(browserRouteAvailable('remote', 'http://localhost:3000/', undefined)).toBe(false);

    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ruimteDesktop: shell(true) } });
    usePortGrants.setState({ byEndpoint: { local: [grant] } });

    expect(portTunnelPages.grantFor('local', 'http://localhost:3000/')).toBeNull();
});

test('a node bound to another machine than its project has no shared route', () => {
    useEndpoints.setState({
        endpoints: [...originalEndpoints.endpoints, { id: 'remote', label: 'Studio', daemonId: 'studio' } as never]
    });

    expect(browserRouteAvailable('remote', 'http://localhost:3000/', 'studio')).toBe(true);
    expect(browserRouteAvailable('remote', 'http://localhost:3000/', 'attic')).toBe(false);
});

test('the page waits for its tunnel, then opens in the partition of the shell with no route to bind', async () => {
    const id = key('remote');

    expect(browserRegistry.ensure(id, 'http://localhost:3000/')).toBeNull();
    expect(elements).toEqual([]);

    await settle();

    expect(opened).toEqual([{ endpointId: 'remote', grantId: 'grant-1', port: 3000 }]);
    expect(usePortTunnelPartitions.getState().byKey[id]).toBe('ruimte-port-1');

    const view = browserRegistry.ensure(id, 'http://localhost:3000/');

    expect(view).not.toBeNull();
    expect(elements[0]!.attributes.get('partition')).toBe('ruimte-port-1');
    expect(elements[0]!.attributes.get('src')).toBe('http://localhost:3000/');
    expect(browserRegistry.ensure(id, 'http://localhost:3000/other')).toBe(view);
});

test('asking again while the tunnel opens makes one tunnel', async () => {
    const id = key('remote');

    browserRegistry.ensure(id, 'http://localhost:3000/');
    browserRegistry.ensure(id, 'http://localhost:3000/again');
    await settle();

    expect(opened).toHaveLength(1);
});

test('stopping the sharing closes the tunnel of the page', async () => {
    const id = key('remote');

    browserRegistry.ensure(id, 'http://localhost:3000/');
    await settle();
    browserRegistry.ensure(id, 'http://localhost:3000/');

    usePortGrants.getState().set('remote', []);

    expect(closed).toEqual(['tunnel-1']);
    expect(usePortTunnelPartitions.getState().byKey[id]).toBeUndefined();
    expect(browserRouteAvailable('remote', 'http://localhost:3000/', undefined)).toBe(false);
});

test('a list that has not loaded yet does not close a tunnel', async () => {
    const id = key('remote');

    browserRegistry.ensure(id, 'http://localhost:3000/');
    await settle();
    usePortGrants.getState().forget('remote');

    expect(closed).toEqual([]);
    expect(portTunnelPages.partitionOf(id)).toBe('ruimte-port-1');
});

test('leaving the shared port for a public address makes a page of the shared session', async () => {
    const id = key('remote');

    browserRegistry.ensure(id, 'http://localhost:3000/');
    await settle();
    browserRegistry.ensure(id, 'http://localhost:3000/');

    expect(browserRegistry.ensure(id, 'https://example.org/')).not.toBeNull();
    expect(elements[0]!.removed).toBe(true);
    expect(elements[1]!.attributes.get('partition')).toBe('persist:ruimte');
    expect(closed).toEqual(['tunnel-1']);
});

test('deleting the node closes its tunnel', async () => {
    const id = key('remote');

    browserRegistry.ensure(id, 'http://localhost:3000/');
    await settle();
    browserRegistry.destroy(id);

    expect(closed).toEqual(['tunnel-1']);
});
