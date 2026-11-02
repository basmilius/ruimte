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

type Result = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

/* What a call of the API answers here: done, as a Result, with nothing behind it. */
function done(value?: unknown): Result {
    return { ok: true, value };
}

const answers = (value?: unknown) => async (): Promise<Result> => done(value);

/* A fake method of `server/` answers as `useServer` would: its value, `failed` for a throw, `not-found` for none. */
function serverAnswer(method: string, args: unknown[]): Result | Promise<Result> {
    const handler = fakeServer[method];

    if (handler === undefined) {
        return { ok: false, error: { code: 'not-found', message: `No method ${method}` } };
    }

    const failed = (e: unknown): Result => ({ ok: false, error: { code: 'failed', message: e instanceof Error ? e.message : String(e) } });

    try {
        const value = handler(...args);

        return value instanceof Promise ? value.then(done, failed) : done(value);
    } catch (e) {
        return failed(e);
    }
}

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
    definePaletteSource: recording('paletteSource'),
    launches: new Proxy({}, { get: () => answers({}) }),
    routines: new Proxy({}, { get: () => answers({}) }),
    artifacts: new Proxy({}, { get: () => answers({}) }),
    browser: new Proxy({}, { get: () => answers({}) }),
    devices: new Proxy({}, { get: () => answers({}) }),
    terminals: { read: answers(''), open: () => done({ id: 'terminal' }) },
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
    database: { connections: answers([]), query: answers({ columns: [], rows: [], hasMore: false }) },
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
                    Object.assign(async (...args: unknown[]) => serverAnswer(method, args), {
                        // Answers at once here, since a string render does not wait for a promise; a fake for `.use()` answers without one.
                        use: (...args: unknown[]) => serverAnswer(method, args)
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
    context: { read: answers([]) },
    agents: {
        run: answers({ text: '' }),
        stream: async function* () {
            yield done({ text: '' });
        },
        start: answers({ id: 'chat' })
    },
    files: { readText: answers(''), write: answers(), list: answers([]), watch: () => done(() => undefined), open: () => undefined },
    git: {
        status: answers({ repository: false, root: null, branch: null, upstream: null, ahead: 0, behind: 0, files: [], truncated: false }),
        diff: answers({ path: '', diff: '', added: 0, deleted: 0, binary: false, kind: null }),
        log: answers([])
    },
    chats: { list: answers([]), read: answers(''), send: answers() },
    views: { open: () => undefined, createCanvas: () => done({ id: 'view' }), rename: () => done() },
    canvas: new Proxy(
        { select: () => undefined, reveal: () => undefined, remove: answers() },
        // Every other call makes or changes a node, and answers the node it is about.
        { get: (target: Record<string, unknown>, name: string) => target[name] ?? (() => done({ id: 'node' })) }
    )
};

const server: Record<string, unknown> = {
    defineServer: <Api>(api: Api): Api => api,
    onEvent: () => () => undefined,
    emit: () => undefined,
    defineNodeContext: () => undefined,
    schedule: () => undefined,
    defineAgentTool: () => undefined,
    agents: { run: answers({ text: '' }), start: answers({ id: 'chat' }) },
    chats: { list: answers([]), read: answers(''), send: answers() },
    machine: { platform: 'test', dataFolder: '', run: answers({}) },
    defineLanguageServer: answers(),
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
