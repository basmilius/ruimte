/*
 * `createTestHost` and the `@ruimte/extension/client` a test imports itself: what a test host loaded speaks for that host,
 * and a file the test imports speaks for the host created last, or for one of the manifest alone before any.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type * as PublicClient from '../../../../packages/extension/client';
import type * as PublicTesting from '../../../../packages/extension/testing';
import { clientApi, type ClientApi } from './test-client.ts';
import { render } from './test-dom.ts';
import { TestHost } from './test-host.ts';
import { loadFresh } from './test-loader.ts';

let current: { host: TestHost; api: ClientApi } | null = null;

function currentApi(): ClientApi {
    if (current === null) {
        const host = new TestHost({}, process.cwd());

        current = { host, api: clientApi(host) };
    }

    return current.api;
}

/* Each member of the client API, calling the host of the moment, so an import made once follows every test host. */
function forwarded(): typeof PublicClient {
    const template = clientApi(new TestHost({}, process.cwd()));

    return Object.fromEntries(
        Object.entries(template).map(([name, member]) => [
            name,
            typeof member === 'function'
                ? (...args: unknown[]) => (currentApi()[name as keyof ClientApi] as (...values: unknown[]) => unknown)(...args)
                : new Proxy(member as object, {
                      get: (_target, key) => {
                          const target = currentApi()[name as keyof ClientApi] as object;
                          const value: unknown = Reflect.get(target, key);

                          return typeof value === 'function' ? value.bind(target) : value;
                      }
                  })
        ])
    ) as typeof PublicClient;
}

export const client = forwarded();

function entryIn(folder: string, entry: string | undefined): string | null {
    if (entry !== undefined) {
        return resolve(folder, entry);
    }

    return ['index.ts', 'index.tsx'].map((name) => join(folder, 'client', name)).find((path) => existsSync(path)) ?? null;
}

/* What a test reads and drives of one host. */
function publicHost(host: TestHost, api: ClientApi): PublicTesting.TestHost {
    const created = (): PublicClient.NodeInfo[] => host.createdIds.filter((id) => host.nodes.has(id)).map((id) => host.info(id));

    return {
        definitions: host.definitions,
        action: (id) => host.defined('action', id),
        menu: (id) => host.defined('menu', id),
        widget: (id) => host.defined('widget', id),
        panel: (id) => host.defined('panel', id),
        view: (id) => host.defined('view', id),
        node: (id) => host.defined('node', id),
        card: (id) => host.defined('sidebarCard', id),
        overlay: (id) => host.defined('overlay', id),
        context: (place, extra) => host.context(place, extra) as never,
        slot: (definition, place, extra) => host.slot(definition, place, extra),
        run: (definition, place, extra) => host.run(definition, place, extra),
        menuItems: (menu, place, extra) => host.menuItems(menu, place, extra),
        fire: (name, payload) => host.deliver(name, payload),
        emit: (name, payload) => host.deliver(`server:${name}`, payload),
        select: (ids) => host.select(ids),
        setSetting(key, value) {
            host.settings[key] = value;
            host.changed();
        },
        // A component of the test's own draws against the host it is drawn on.
        render: (drawable, options) => {
            current = { host, api };

            return render(drawable as object, options);
        },
        canvas: {
            nodes: () => host.nodesInFront(),
            notes: () =>
                host.notes.flatMap((id) => {
                    const note = host.nodes.get(id);

                    return note === undefined ? [] : [{ id, title: note.title, text: note.text, color: note.color }];
                }),
            links: () => host.edges.map((edge) => ({ ...edge })),
            created,
            selection: () => [...host.selection],
            revealed: () => [...host.revealed]
        },
        views: () => host.views.map((view) => ({ ...view, active: view.id === host.activeViewId })),
        notifications: host.notifications,
        dialogs: host.dialogs,
        opened: host.opened,
        panels: host.panels,
        copied: host.copied,
        server: {
            get calls() {
                return host.calls.filter((call) => call.method.startsWith('server '));
            }
        },
        agents: {
            get calls() {
                return host.calls.filter((call) => call.method.startsWith('agents.'));
            }
        },
        calls: host.calls,
        storage: host.storage,
        settings: host.settings,
        logs: host.logs
    };
}

export async function createTestHost(options: PublicTesting.TestHostOptions = {}): Promise<PublicTesting.TestHost> {
    const folder = process.cwd();
    const host = new TestHost(options, folder);
    const api = clientApi(host);
    const entry = entryIn(folder, options.entry);

    current = { host, api };

    if (entry !== null) {
        await loadFresh(entry, { '@ruimte/extension/client': api });
    }

    return publicHost(host, api);
}
