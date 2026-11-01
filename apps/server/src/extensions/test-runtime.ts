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
    defineSlashCommand: recording('slashCommand'),
    defineReference: recording('reference'),
    defineDiffViewer: recording('diffViewer'),
    defineFileIcon: recording('fileIcon'),
    defineVoiceAction: recording('voiceAction'),
    defineTemplate: recording('template'),
    useSetting: () => undefined,
    useMachine: () => ({ id: 'test-machine' }),
    useTheme: () => ({ side: 'dark' }),
    useChat: () => null,
    database: { connections: async () => [], query: async () => ({ columns: [], rows: [], hasMore: false }) },
    defineToolResult: recording('toolResult'),
    defineOverlay: (definition: unknown) => {
        defined.push({ kind: 'overlay', definition });

        return { open: async () => null, close: () => undefined };
    },
    defineFileViewer: recording('fileViewer'),
    defineMarkdownBlock: recording('markdownBlock'),
    defineExtensionSettings: recording('settings'),
    defineAction: (definition: unknown) => {
        defined.push({ kind: 'action', definition });

        return { run: async () => undefined, useRunning: () => false };
    },
    defineMenu: recording('menu'),
    defineWidget: recording('widget'),
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
    useNodes: () => [],
    useNode: (id: string) => ({ id, kind: 'note', title: '' }),
    useViews: () => [],
    useLocale: () => ({ language: 'en', t: (key: string) => key, format: {} }),
    useEvent: () => undefined,
    onEvent: () => () => undefined,
    useAgents: () => [],
    useUsageLimits: () => [],
    useServerEvent: () => undefined,
    host: { busy: (_work: unknown, run: () => unknown) => run(), notify: () => undefined, confirm: async () => true, openUrl: () => undefined },
    context: { read: async () => [] },
    agents: {
        run: async () => ({ text: '' }),
        stream: async function* () {
            yield { text: '' };
        },
        start: async () => ({ id: 'chat' })
    },
    files: { readText: async () => '', write: async () => undefined, list: async () => [], watch: () => () => undefined, open: () => undefined },
    git: { status: async () => ({}), diff: async () => ({}), log: async () => ({}) },
    chats: { list: async () => [], read: async () => '', send: async () => undefined },
    views: { open: () => undefined, createCanvas: () => ({ id: 'view' }), rename: () => undefined },
    canvas: { createNote: () => ({ id: 'note' }), link: () => undefined, reveal: () => undefined }
};

const server: Record<string, unknown> = {
    defineServer: <Api>(api: Api): Api => api,
    onEvent: () => () => undefined,
    emit: () => undefined,
    defineNodeContext: () => undefined,
    schedule: () => undefined,
    defineAgentTool: () => undefined,
    agents: { run: async () => ({ text: '' }), start: async () => ({ nodeId: 'chat' }) },
    chats: { list: async () => [], send: async () => undefined },
    machine: { platform: 'test', dataFolder: '' },
    storage: { get: async () => undefined, set: async () => undefined, delete: async () => undefined },
    secrets: { get: async () => undefined, set: async () => undefined },
    log: { info: () => undefined, error: () => undefined }
};

const testing = {
    definitions: () => defined,
    slotAnswer(definition: { slots?: Record<string, unknown> }, slot: string, context: object): unknown {
        const answer = definition.slots?.[slot];

        return typeof answer === 'function' ? answer(context) : (answer ?? false);
    },
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
