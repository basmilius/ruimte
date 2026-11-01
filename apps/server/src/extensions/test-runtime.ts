/*
 * What `ruimte extension test` preloads into `bun test`: the modules Ruimte supplies at run time, as
 * fakes, since npm only has their types. A `define*` is recorded so a test can read what was defined, and
 * a surface draws to a string with the project's own React.
 */
import { plugin } from 'bun';
// @ts-expect-error The author's project has React; the daemon only carries this file as text.
import { createElement } from 'react';
// @ts-expect-error As above.
import { renderToStaticMarkup } from 'react-dom/server';

const defined: { kind: string; definition: unknown }[] = [];
let fakeServer: Record<string, (...args: unknown[]) => unknown> = {};
let nodeData: unknown = {};

function recording(kind: string) {
    return (definition: unknown) => {
        defined.push({ kind, definition });

        return { open: () => undefined, close: () => undefined, setBadge: () => undefined };
    };
}

const client: Record<string, unknown> = {
    definePanel: recording('panel'),
    defineSidebarCard: recording('sidebarCard'),
    defineView: recording('view'),
    defineNode: recording('node'),
    defineCanvasOverlay: recording('canvasOverlay'),
    defineCommand: recording('command'),
    defineExtensionSettings: recording('settings'),
    defineNodeMenuItem: recording('nodeMenuItem'),
    defineCanvasAction: recording('canvasAction'),
    useServer: () =>
        new Proxy(
            {},
            {
                get: (_target, method: string) =>
                    Object.assign(async (...args: unknown[]) => fakeServer[method]?.(...args), {
                        // Answers at once here, since a string render does not wait for a promise.
                        use: (...args: unknown[]) => fakeServer[method]?.(...args)
                    })
            }
        ),
    useNodeData: () => [nodeData, (next: unknown) => (nodeData = next)],
    useStorage: (_key: string, initial: unknown) => [initial, () => undefined],
    useProject: () => ({ id: 'test-project', name: 'Test' }),
    useActiveView: () => ({ id: 'test-view' }),
    useSelection: () => [],
    useCanvasNodes: () => [],
    useAgents: () => [],
    host: { notify: () => undefined, confirm: async () => true, openUrl: () => undefined },
    context: { read: async () => [] },
    agents: { run: async () => ({ text: '' }) },
    canvas: { createNote: () => ({ id: 'note' }), link: () => undefined, reveal: () => undefined }
};

const server: Record<string, unknown> = {
    defineServer: <Api>(api: Api): Api => api,
    onEvent: () => () => undefined,
    emit: () => undefined,
    defineNodeContext: () => undefined,
    defineAgentTool: () => undefined,
    storage: { get: async () => undefined, set: async () => undefined },
    secrets: { get: async () => undefined, set: async () => undefined },
    log: { info: () => undefined, error: () => undefined }
};

const testing = {
    definitions: () => defined,
    renderSurface(component: unknown, options: { server?: typeof fakeServer; data?: unknown; props?: object } = {}): string {
        fakeServer = options.server ?? {};
        nodeData = options.data ?? {};

        return renderToStaticMarkup(createElement(component, options.props ?? {}));
    }
};

plugin({
    name: 'ruimte-extension-fakes',
    setup(build) {
        build.module('@ruimte/extension/client', () => ({ exports: client, loader: 'object' }));
        build.module('@ruimte/extension/server', () => ({ exports: server, loader: 'object' }));
        build.module('@ruimte/extension/testing', () => ({ exports: testing, loader: 'object' }));
    }
});
