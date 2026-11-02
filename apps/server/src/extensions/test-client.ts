/*
 * `@ruimte/extension/client` under `ruimte extension test`, as a fake: a `define*` is recorded so a test can read
 * what was defined, a call answers done with an empty value of its shape, and a surface draws to a string with
 * the project's own React. Held to the public types, so a member the API gains and the fake lacks breaks the
 * check rather than an author's test.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as PublicClient from '../../../../packages/extension/client';

type Result<Value> = PublicClient.Result<Value>;
type Machine = PublicClient.MachineActions;
type Format = ReturnType<typeof PublicClient.useLocale>['format'];

// Resolved from the preload, which sits in the project; a bundler leaves a require through this alone.
const fromProject = createRequire(import.meta.url);

const defined: { kind: string; definition: object }[] = [];
let fakeServer: Record<string, (...args: never[]) => unknown> = {};
let nodeData: unknown = {};
const stored = new Map<string, unknown>();

function done<Value>(value: Value): Result<Value> {
    return { ok: true, value };
}

/* What a call of the API answers here: done, with an empty value of its shape and nothing behind it. */
function answers<Value>(value: Value): () => Promise<Result<Value>> {
    return async () => done(value);
}

function failed(e: unknown): Result<never> {
    return { ok: false, error: { code: 'failed', message: e instanceof Error ? e.message : String(e) } };
}

/* A fake method of `server/` answers as `useServer` would: its value, `failed` for a throw, `not-found` for none. */
function serverAnswer(method: string, args: unknown[]): Result<unknown> | Promise<Result<unknown>> {
    const handler = fakeServer[method] as ((...values: unknown[]) => unknown) | undefined;

    if (handler === undefined) {
        return { ok: false, error: { code: 'not-found', message: `No method ${method}` } };
    }

    try {
        const value = handler(...args);

        return value instanceof Promise ? value.then(done, failed) : done(value);
    } catch (e) {
        return failed(e);
    }
}

function record(kind: string, definition: object): void {
    defined.push({ kind, definition });
}

function recording(kind: string): (definition: object) => void {
    return (definition) => record(kind, definition);
}

/* The default of a field that `defineExtensionSettings` named, as `useSetting` reads before a person changed it. */
function settingDefault(key: string): unknown {
    for (const { kind, definition } of defined) {
        if (kind !== 'settings') {
            continue;
        }

        const settings = definition as { fields?: PublicClient.SettingField[]; groups?: PublicClient.SettingGroup[] };
        const fields = settings.fields ?? settings.groups?.flatMap((group) => group.fields) ?? [];
        const field = fields.find((each) => each.key === key);

        if (field !== undefined) {
            return field.default;
        }
    }

    return undefined;
}

/* The project's `locales/en.json`, so a test reads the words a person reads. */
function englishWords(): Record<string, string> {
    try {
        return JSON.parse(readFileSync(join(process.cwd(), 'locales', 'en.json'), 'utf8')) as Record<string, string>;
    } catch {
        return {};
    }
}

const NO_GIT_STATUS: PublicClient.GitStatus = { repository: false, root: null, branch: null, upstream: null, ahead: 0, behind: 0, files: [], truncated: false };
const NO_BROWSER = (node: PublicClient.NodeRef): PublicClient.BrowserState => ({ node, open: false, page: null, error: null });
const NO_ARTIFACT: PublicClient.ArtifactInfo = { id: 'artifact', title: '', kind: 'report', key: null, createdAt: 0 };
const NO_DEVICE: PublicClient.DeviceState = {
    node: { id: 'device' },
    device: { name: '', platform: 'ios', kind: 'simulator', runtime: '' },
    present: false,
    state: null,
    screen: null,
    buttons: [],
    can: { shot: false, input: false, type: false, launch: false }
};
const NODE = { id: 'node' };

function launch(input: { launch: string }): Machine['launch.start']['output'] {
    return { id: input.launch, name: input.launch };
}

function routine(input: { routine: string }): Machine['routine.pause']['output'] {
    return { id: input.routine, title: input.routine };
}

export const client = {
    definePanel<Params>(panel: object): PublicClient.PanelHandle<Params> {
        record('panel', panel);

        return { open: () => undefined, close: () => undefined, setBadge: () => undefined, setTitle: () => undefined };
    },
    defineSidebarCard: recording('sidebarCard'),
    defineView<Params>(view: object): { open(params?: Params): void } {
        record('view', view);

        return { open: () => undefined };
    },
    defineNode: recording('node'),
    defineCanvasOverlay: recording('canvasOverlay'),
    defineFileViewer: recording('fileViewer'),
    defineMarkdownBlock: recording('markdownBlock'),
    defineOverlay<Params, Answer>(overlay: object): { open(params: Params): Promise<Answer | null>; close(): void } {
        record('overlay', overlay);

        return { open: async () => null, close: () => undefined };
    },
    defineToolResult: recording('toolResult'),
    definePaletteSource: recording('paletteSource'),
    defineSlashCommand: recording('slashCommand'),
    defineReference: recording('reference'),
    defineDiffViewer: recording('diffViewer'),
    defineFileIcon: recording('fileIcon'),
    defineVoiceAction: recording('voiceAction'),
    defineTemplate: recording('template'),
    defineCommand: recording('command'),
    defineExtensionSettings: recording('settings'),
    useSetting: <Value extends boolean | string>(key: string): Value => settingDefault(key) as Value,
    useMachine: () => ({ id: 'test-machine' }),
    useTheme: () => ({ side: 'dark' as const }),
    useChat: (_id: string): PublicClient.ChatSummary | null => null,
    defineAction(action: object): PublicClient.ActionHandle {
        record('action', action);

        return { run: async () => undefined, useRunning: () => false };
    },
    defineMenu: recording('menu'),
    defineWidget: recording('widget'),
    useServer: <Server>(): PublicClient.ServerClient<Server> =>
        new Proxy({} as PublicClient.ServerClient<Server>, {
            get: (_target, method: string) =>
                Object.assign(async (...args: unknown[]) => serverAnswer(method, args), {
                    // Answers at once here, since a string render does not wait for a promise; a fake for `.use()` answers without one.
                    use: (...args: unknown[]) => serverAnswer(method, args)
                })
        }),
    useServerEvent: (_name: string, _listener: (payload: never) => void): void => undefined,
    useNodeData: <Data>(): [Data, (next: Data) => void] => [nodeData as Data, (next: Data) => void (nodeData = next)],
    useStorage: <Value>(key: string, initial: Value, scope: 'computer' | 'project' | 'machine' = 'computer'): [Value, (next: Value) => void] => [
        (stored.has(`${scope}:${key}`) ? stored.get(`${scope}:${key}`) : initial) as Value,
        (next: Value) => void stored.set(`${scope}:${key}`, next)
    ],
    useProject: () => ({ id: 'test-project', name: 'Test' }),
    useActiveView: () => ({ id: 'test-view' }),
    useViews: (): { id: string; kind: string; name: string }[] => [],
    useSelection: (): PublicClient.NodeInfo[] => [],
    useNode: (id: string): PublicClient.NodeInfo => ({
        id,
        kind: 'note',
        title: '',
        color: null,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        groupId: null,
        viewId: 'test-view',
        machine: null,
        linkedTo: []
    }),
    useNodes: (_filter?: (node: PublicClient.NodeInfo) => boolean): PublicClient.NodeInfo[] => [],
    useLocale() {
        const words = englishWords();

        return {
            language: 'en',
            // The formatters come with Ruimte; a test of a surface that formats reads them in `ruimte extension dev`.
            format: {} as Format,
            t: (key: string, values?: Record<string, string | number>) =>
                Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), words[key] ?? key)
        };
    },
    useEvent: (_name: keyof PublicClient.ClientEvents, _listener: (event: never) => void): void => undefined,
    onEvent: (_name: keyof PublicClient.ClientEvents, _listener: (event: never) => void) => () => undefined,
    useAgents: (): { id: string; title: string; status: PublicClient.AgentStatus }[] => [],
    useUsageLimits: (): ReturnType<typeof PublicClient.useUsageLimits> => [],
    host: {
        busy: async <Value>(_work: object, run: (signal: AbortSignal) => Value | Promise<Value>): Promise<Value> => run(new AbortController().signal),
        notify: () => undefined,
        pickFolder: async () => null,
        openSettings: () => undefined,
        confirm: async () => true,
        prompt: async () => null,
        pick: async <Item>(): Promise<Item | null> => null,
        openUrl: () => undefined,
        copy: () => undefined
    },
    files: {
        readText: answers(''),
        write: answers(undefined),
        list: answers<PublicClient.FileEntry[]>([]),
        watch: () => done(() => undefined),
        open: () => undefined
    },
    git: {
        status: answers(NO_GIT_STATUS),
        diff: async ({ path }: { path: string }) => done<PublicClient.GitFileDiff>({ path, diff: '', added: 0, deleted: 0, binary: false, kind: null }),
        log: answers<PublicClient.GitCommit[]>([])
    },
    chats: { list: answers<PublicClient.ChatSummary[]>([]), read: answers(''), send: answers(undefined) },
    launches: {
        list: answers<Machine['launch.list']['output']>({ launches: [] }),
        read: async (input: { launch: string }) => done({ ...launch(input), text: null }),
        start: async (input: { launch: string }) => done(launch(input)),
        restart: async (input: { launch: string }) => done(launch(input)),
        stop: async (input: { launch: string }) => done({ ...launch(input), stopping: 0 })
    },
    routines: {
        list: answers<Machine['routine.list']['output']>({ routines: [] }),
        run: async (input: { routine: string }) => done({ ...routine(input), runId: 'run' }),
        pause: async (input: { routine: string }) => done(routine(input)),
        resume: async (input: { routine: string }) => done(routine(input))
    },
    artifacts: {
        list: answers<Machine['artifact.list']['output']>({ artifacts: [] }),
        read: answers<Machine['artifact.read']['output']>({
            artifact: NO_ARTIFACT,
            version: { id: 'version', number: 1 },
            file: { name: '', mime: 'text/plain', size: 0 },
            text: null,
            truncated: false
        }),
        publish: answers<Machine['artifact.publish']['output']>({ artifact: NO_ARTIFACT, version: { id: 'version', number: 1 }, existing: false })
    },
    browser: {
        inspect: async ({ node }: { node: PublicClient.NodeRef }) => done(NO_BROWSER(node)),
        navigate: async ({ node }: { node: PublicClient.NodeRef }) => done(NO_BROWSER(node)),
        back: async ({ node }: { node: PublicClient.NodeRef }) => done(NO_BROWSER(node)),
        forward: async ({ node }: { node: PublicClient.NodeRef }) => done(NO_BROWSER(node)),
        reload: async ({ node }: { node: PublicClient.NodeRef }) => done(NO_BROWSER(node)),
        screenshot: async ({ node }: { node: PublicClient.NodeRef }) => done({ ...NO_BROWSER(node), path: null })
    },
    devices: {
        list: answers<Machine['device.list']['output']>({ devices: [] }),
        inspect: async ({ node }: { node: PublicClient.NodeRef }) => done({ ...NO_DEVICE, node }),
        screenshot: async ({ node }: { node: PublicClient.NodeRef }) => done({ node, path: '', width: 0, height: 0 }),
        tap: async ({ node }: { node: PublicClient.NodeRef }) => done({ node }),
        launch: async ({ node }: { node: PublicClient.NodeRef }) => done({ node })
    },
    terminals: { read: answers(''), open: () => done({ id: 'terminal' }) },
    database: {
        connections: answers<{ id: string; name: string }[]>([]),
        query: answers<{ columns: string[]; rows: PublicClient.DatabaseValue[][]; hasMore: boolean }>({ columns: [], rows: [], hasMore: false })
    },
    views: { open: () => undefined, createCanvas: () => done({ id: 'view' }), rename: () => done(undefined) },
    context: { read: answers<PublicClient.ContextSource[]>([]) },
    agents: {
        run: answers({ text: '' }),
        async *stream() {
            yield done({ text: '' });
        },
        start: answers({ id: 'chat' })
    },
    canvas: {
        createNote: () => done(NODE),
        arrange: () => done(undefined),
        remove: answers(undefined),
        createFile: () => done(NODE),
        createBrowser: () => done(NODE),
        createNode: () => done(NODE),
        update: () => done(undefined),
        writeNote: () => done(undefined),
        group: () => done(NODE),
        link: () => done(undefined),
        unlink: () => done(undefined),
        select: () => undefined,
        reveal: () => undefined
    }
} satisfies typeof PublicClient;

export const clientTesting = {
    definitions: () => defined,
    slotAnswer(definition: { slots?: object }, slot: PublicClient.SlotName, context: object): PublicClient.SlotAnswer {
        const answer = (definition.slots as Record<string, unknown> | undefined)?.[slot];

        if (typeof answer === 'function') {
            return (answer as (context: object) => PublicClient.SlotAnswer)(context);
        }

        return answer === true;
    },
    renderSurface<Props extends object>(
        component: unknown,
        options: { server?: Record<string, (...args: never[]) => unknown>; data?: object; props?: Props } = {}
    ): string {
        // The project's own React, loaded only here, so a project of `server/` alone needs none.
        const { createElement } = fromProject('react') as { createElement(component: unknown, props: object): unknown };
        const { renderToStaticMarkup } = fromProject('react-dom/server') as { renderToStaticMarkup(element: unknown): string };

        fakeServer = options.server ?? {};
        nodeData = options.data ?? {};

        return renderToStaticMarkup(createElement(component, options.props ?? {}));
    }
};
