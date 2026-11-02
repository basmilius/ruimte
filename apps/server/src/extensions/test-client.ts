/*
 * `@ruimte/extension/client` under `ruimte extension test`, over one test host: each `define*` is recorded, a call answers
 * what the host holds or what the test scripted, and a hook reads the host as React draws. Held to the public types, so a
 * member the API gains and the fake lacks breaks the check rather than an author's test.
 */
import { lazyComponentProblem, shortcutProblem } from '@ruimte/contracts/extension-client';
import { contextSelection } from '@ruimte/contracts/extension-context';
import { parseExtensionActionInput, type ExtensionActionName } from '@ruimte/contracts/extension-actions';
import type * as PublicClient from '../../../../packages/extension/client';
import { callHandler, MissingHandler } from './server-api.ts';
import { formatModule, nodeContextOf, react } from './test-react.ts';
import { NEW_NODE, Refused, wire, type Entry, type TestHost } from './test-host.ts';

type Result<Value> = PublicClient.Result<Value>;
type NodeRef = PublicClient.NodeRef;
type Format = ReturnType<typeof PublicClient.useLocale>['format'];
type Slots = Record<string, unknown>;
type Lazy = { component?: unknown; frame?: unknown };

const ARRANGE_GAP = 40;

function assertLazy(surface: Lazy, what: string): void {
    const problem = lazyComponentProblem(surface, what);

    if (problem !== null) {
        throw new TypeError(problem);
    }
}

/* Reads the host again whenever it changes, so a hook draws what it holds now. */
function useHost(host: TestHost): void {
    react().useSyncExternalStore(
        (listener) => host.subscribe(listener),
        () => host.snapshot()
    );
}

function removeTitle(count: number): string {
    return count === 1 ? 'Remove 1 node?' : `Remove ${count} nodes?`;
}

function removeBody(count: number, name: string): string {
    return count === 1 ? `${name} asks to remove it.` : `${name} asks to remove them.`;
}

/* A method of `server/` answers as `useServer` reads it: the value as JSON, `failed` for a throw, `not-found` for none. */
async function serverCall(host: TestHost, method: string, args: unknown[]): Promise<Result<unknown>> {
    const server = host.answers.server;

    if (server !== undefined && typeof (server as { call?: unknown }).call === 'function' && 'asked' in server) {
        const result = (await (server as { call(method: string, ...args: unknown[]): Promise<Result<unknown>> }).call(method, ...args)) as Result<unknown>;

        host.calls.push({ method: `server ${method}`, args, result });

        if (!result.ok) {
            host.logs.push(`server ${method}: ${result.error.code}: ${result.error.message}`);
        }

        return result;
    }

    return host.settle(`server ${method}`, args, async () => {
        try {
            return wire(await callHandler((server ?? {}) as Record<string, unknown>, method, wire<unknown[]>(args))) ?? null;
        } catch (e) {
            if (e instanceof MissingHandler) {
                throw new Refused('not-found', e.message);
            }

            // Any throw of `server/` answers `failed` on the machine, a TypeError too.
            throw e instanceof TypeError ? new Error(e.message) : e;
        }
    });
}

function serverClient(host: TestHost): unknown {
    return new Proxy(
        {},
        {
            get(_target, method) {
                if (typeof method !== 'string') {
                    return undefined;
                }

                return Object.assign((...args: unknown[]) => serverCall(host, method, args), {
                    use(...args: unknown[]) {
                        const key = JSON.stringify([method, args]);
                        let pending = host.serverCache.get(key);

                        if (pending === undefined) {
                            pending = serverCall(host, method, args);
                            host.serverCache.set(key, pending);
                        }

                        return react().use(pending);
                    },
                    reload(...args: unknown[]) {
                        if (host.serverCache.delete(JSON.stringify([method, args]))) {
                            host.changed();
                        }
                    }
                });
            }
        }
    );
}

/* `launches.start` for `launch.start`, each behind the permission of its action and checked by the machine's own schema. */
function machineCalls<Name extends ExtensionActionName>(
    host: TestHost,
    area: string,
    names: readonly Name[]
): Record<string, (input?: object) => Promise<Result<unknown>>> {
    return Object.fromEntries(
        names.map((action) => {
            const verb = action.slice(action.indexOf('.') + 1);
            const path = `${area}.${verb}`;

            return [
                verb,
                (input: object = {}) =>
                    host.settle(path, [input], async () => {
                        const project = host.projectId();
                        const parsed = parseExtensionActionInput(action, wire(input));

                        if (!parsed.ok) {
                            throw new TypeError(`${path}: ${parsed.message}`);
                        }

                        const run = (host.answers['machine.run'] as Record<string, ((input: unknown, project: NodeRef) => unknown) | undefined> | undefined)?.[
                            action
                        ];

                        if (run === undefined) {
                            throw new Refused('unavailable', `Nothing answers ${action} in this test. Give it under answers['machine.run']`);
                        }

                        return wire(await run(parsed.input, { id: project }));
                    })
            ];
        })
    );
}

/* What an agent reads of a node of this kind: its `text`, which a test seeds. Each kind takes its own permission, so another kind reads nothing. */
function nodeText(host: TestHost, id: string, kind: 'terminal' | 'chat'): string {
    host.projectId();

    // A chat is the machine's, with or without a node, so one in a view of its own reads too.
    const chat = kind === 'chat' ? host.chats.get(id) : undefined;

    if (chat !== undefined) {
        return chat.text;
    }

    const node = host.nodes.get(id);

    if (node?.kind !== kind) {
        throw new Refused('not-found', `No ${kind} ${id} in this project`);
    }

    return node.text;
}

function settingDefault(host: TestHost, key: string): unknown {
    for (const { kind, definition } of host.definitions) {
        if (kind !== 'settings') {
            continue;
        }

        const settings = definition as { fields?: PublicClient.SettingField[]; groups?: PublicClient.SettingGroup[] };
        const field = (settings.fields ?? settings.groups?.flatMap((group) => group.fields) ?? []).find((each) => each.key === key);

        if (field !== undefined) {
            return field.default;
        }
    }

    return undefined;
}

function ask<Value>(answer: Value | ((options: never) => Value) | undefined, options: object, fallback: Value): Value {
    if (typeof answer === 'function') {
        return (answer as (options: object) => Value)(options);
    }

    return answer === undefined ? fallback : answer;
}

export function clientApi(host: TestHost) {
    const fullId = (id: string): string => `${host.id}/${id}`;
    // A call that reads under a folder of the project, which the client host checks before it asks the machine.
    const inFolder = <Value>(what: string, path: string, args: unknown[]): Promise<Result<Value>> =>
        host.settle(what, args, () => {
            host.inProject(path);

            return host.scripted<Value>(what, args);
        });
    const entry = (definition: object, details: Omit<Entry, 'slots'> & { slots?: Slots }): void =>
        host.addEntry(definition, { ...details, slots: details.slots ?? {} });
    const actionHandle = (id: string): PublicClient.ActionHandle & { actionId: string } => ({
        actionId: id,
        run: async (context?: object) => {
            const found = host.entries.find((each) => each.id === id);

            if (found !== undefined) {
                await host.runEntry(found, found.title, { ...host.baseContext(), ...context }, 'code');
            }
        },
        useRunning: () => {
            useHost(host);

            return host.runs.some((run) => run.actionId === id);
        }
    });

    return {
        definePanel<Params>(panel: { id: string; title: string } & Lazy): PublicClient.PanelHandle<Params> {
            assertLazy(panel, `definePanel ${panel.id}`);
            host.record('panel', panel);
            host.panels[panel.id] = { title: panel.title, badge: null, open: false, params: undefined };

            const state = () => host.panels[panel.id] as (typeof host.panels)[string];

            return {
                open: (params?: Params) => {
                    Object.assign(state(), { open: true, params });
                    host.opened.push({ kind: 'panel', id: panel.id, params });
                    host.changed();
                },
                close: () => {
                    state().open = false;
                    host.changed();
                },
                setBadge: (text: string | null) => {
                    state().badge = text;
                    host.changed();
                },
                setTitle: (title: string) => {
                    state().title = title;
                    host.changed();
                }
            };
        },
        defineSidebarCard(card: { id: string; title: string; component: unknown }): void {
            assertLazy(card, `defineSidebarCard ${card.id}`);
            host.record('sidebarCard', card);
        },
        defineView<Params>(view: { id: string; title: string } & Lazy): { open(params?: Params): void } {
            assertLazy(view, `defineView ${view.id}`);
            host.record('view', view);

            return {
                open: (params?: Params) => {
                    // Kept as a view of a kind Ruimte does not know, as the client's project keeps it, and so `useViews` reads it.
                    const { id } = host.addView('unknown', view.title);

                    host.opened.push({ kind: 'view', id: view.id, params });
                    host.openView(id);
                }
            };
        },
        defineNode(node: {
            id: string;
            title: string;
            icon?: string;
            size?: { width: number; height: number };
            initialData?: unknown;
            dataVersion?: number;
            addFrom?: Slots;
            component?: unknown;
            frame?: unknown;
        }): void {
            assertLazy(node, `defineNode ${node.id}`);
            host.record('node', node);
            // Adding is an action like any other, by default where a person adds nodes.
            entry(node, {
                id: fullId(`node/${node.id}`),
                kind: 'action',
                title: node.title,
                ...(node.icon === undefined ? {} : { icon: node.icon }),
                slots: node.addFrom ?? { canvasMenu: true, commandPalette: true },
                run: (context) => {
                    host.addNode(
                        'extension',
                        (context as { at?: { x: number; y: number } }).at ?? { x: 0, y: 0 },
                        {
                            title: node.title,
                            extension: { id: host.id, type: node.id },
                            data: wire(node.initialData ?? {}),
                            ...(node.dataVersion === undefined ? {} : { dataVersion: node.dataVersion })
                        },
                        node.size ?? NEW_NODE
                    );
                }
            });
        },
        defineCanvasOverlay(overlay: { id: string; component: unknown }): void {
            assertLazy(overlay, `defineCanvasOverlay ${overlay.id}`);
            host.record('canvasOverlay', overlay);
        },
        defineFileViewer(viewer: { id: string; component: unknown }): void {
            assertLazy(viewer, `defineFileViewer ${viewer.id}`);
            host.record('fileViewer', viewer);
        },
        defineMarkdownBlock(block: { language: string; component: unknown }): void {
            assertLazy(block, `defineMarkdownBlock ${block.language}`);
            host.record('markdownBlock', block);
        },
        defineOverlay<Params, Answer>(overlay: { id: string; component: unknown }): { open(params: Params): Promise<Answer | null>; close(): void } {
            assertLazy(overlay, `defineOverlay ${overlay.id}`);
            host.record('overlay', overlay);

            return {
                open: async (params: Params) => {
                    host.opened.push({ kind: 'overlay', id: overlay.id, params });

                    const answer = host.answers.overlays?.[overlay.id] as ((params: Params) => Answer | null) | undefined;

                    return answer === undefined ? null : ((await answer(params)) ?? null);
                },
                close: () => undefined
            };
        },
        defineToolResult(result: { id: string; component: unknown }): void {
            assertLazy(result, `defineToolResult ${result.id}`);
            host.record('toolResult', result);
        },
        definePaletteSource: (source: object): void => host.record('paletteSource', source),
        defineSlashCommand: (command: object): void => host.record('slashCommand', command),
        defineReference: (reference: object): void => host.record('reference', reference),
        defineDiffViewer(viewer: { id: string; component: unknown }): void {
            assertLazy(viewer, `defineDiffViewer ${viewer.id}`);
            host.record('diffViewer', viewer);
        },
        defineFileIcon: (icon: object): void => host.record('fileIcon', icon),
        defineVoiceAction: (action: object): void => host.record('voiceAction', action),
        defineTemplate(template: { id: string; title: string; icon?: string; create(context: never): void | Promise<void> }): void {
            host.record('template', template);
            entry(template, {
                id: fullId(`template/${template.id}`),
                kind: 'action',
                title: template.title,
                ...(template.icon === undefined ? {} : { icon: template.icon }),
                slots: { canvasMenu: true },
                run: template.create as (context: object) => unknown
            });
        },
        defineCommand: (command: object): void => host.record('command', command),
        defineExtensionSettings(settings: { component?: unknown; fields?: unknown; groups?: unknown }): void {
            if (settings.fields === undefined && settings.groups === undefined) {
                assertLazy(settings, `defineExtensionSettings ${host.id}`);
            }

            host.record('settings', settings);
        },
        defineAction(action: { id: string; title: string; icon?: string; shortcut?: string; slots?: Slots; run(context: never): void | Promise<void> }) {
            const problem = action.shortcut === undefined ? null : shortcutProblem(action.shortcut);

            if (problem !== null) {
                throw new Error(problem);
            }

            host.record('action', action);
            entry(action, {
                id: fullId(action.id),
                kind: 'action',
                title: action.title,
                ...(action.icon === undefined ? {} : { icon: action.icon }),
                slots: action.slots ?? {},
                run: action.run as (context: object) => unknown
            });

            return actionHandle(fullId(action.id));
        },
        defineMenu(menu: { id: string; title: string; icon?: string; slots: object; items: unknown }): void {
            host.record('menu', menu);
            entry(menu, {
                id: fullId(menu.id),
                kind: 'menu',
                title: menu.title,
                ...(menu.icon === undefined ? {} : { icon: menu.icon }),
                slots: menu.slots as Slots,
                items: menu.items
            });
        },
        defineWidget(widget: { id: string; slots: object; component: unknown }): void {
            assertLazy(widget, `defineWidget ${widget.id}`);
            host.record('widget', widget);
            entry(widget, { id: fullId(widget.id), kind: 'widget', title: widget.id, slots: widget.slots as Slots });
        },
        useServer: <Server>(): PublicClient.ServerClient<Server> => {
            // Drawn again when `reload` drops a kept answer, so `.use()` asks once more.
            useHost(host);

            return serverClient(host) as PublicClient.ServerClient<Server>;
        },
        useServerEvent<Payload>(name: string, listener: (payload: Payload) => void): void {
            react().useEffect(() => host.listen(`server:${name}`, listener as (payload: never) => void), [name, listener]);
        },
        useUsageLimits(): ReturnType<typeof PublicClient.useUsageLimits> {
            host.hookPermission('useUsageLimits');

            return host.answers['usage.limits'] ?? [];
        },
        useNodeData<Data>(): [Data, (next: Data) => void] {
            const module = react();
            const nodeId = module.useContext<string | null>(nodeContextOf(module));

            useHost(host);

            if (nodeId === null) {
                throw new Error('useNodeData only works in a node');
            }

            return [host.nodes.get(nodeId)?.data as Data, (next) => host.changeNode(nodeId, { data: wire(next) })];
        },
        useStorage<Value>(key: string, initial: Value, scope: 'computer' | 'project' | 'machine' = 'computer'): [Value, (next: Value) => void] {
            useHost(host);

            const values = host.storage[scope];

            return [
                (Object.hasOwn(values, key) ? values[key] : initial) as Value,
                (next) => {
                    // Undefined crosses as no value at all, so the key reads its initial value again.
                    if (next === undefined) {
                        delete values[key];
                    } else {
                        values[key] = wire(next);
                    }

                    host.changed();
                }
            ];
        },
        useProject: () => {
            useHost(host);

            return { id: host.project?.id ?? '', name: host.project?.name ?? '' };
        },
        useActiveView: () => {
            useHost(host);

            return { id: host.activeViewId ?? '' };
        },
        useViews: () => {
            useHost(host);

            return host.views.map((view) => ({ ...view }));
        },
        useSelection: () => {
            useHost(host);

            return host.selection.map((id) => host.info(id));
        },
        useSetting<Value extends boolean | string>(key: string): Value {
            useHost(host);

            return (Object.hasOwn(host.settings, key) ? host.settings[key] : settingDefault(host, key)) as Value;
        },
        useMachine: () => ({ id: host.machineId }),
        useTheme: () => ({ side: host.theme }),
        // Any chat of the machine, on a canvas or in a view of its own, as the client reads it from the chats it hears of.
        useChat(chatId: string): PublicClient.ChatSummary | null {
            useHost(host);

            const chat = host.chats.get(chatId);

            if (chat === undefined) {
                return null;
            }

            const agent = host.nodes.has(chatId) ? host.info(chatId).agent : undefined;

            return {
                id: chatId,
                provider: agent?.provider ?? chat.provider,
                status: agent?.status ?? chat.status,
                model: null,
                cwd: agent?.cwd ?? host.project?.folder ?? ''
            };
        },
        // Only a node of the canvas the surface is on, the one in front unless it draws a node: any other reads as unknown.
        useNode: (id: string) => {
            const module = react();
            const nodeId = module.useContext<string | null>(nodeContextOf(module));

            useHost(host);

            const canvas = (nodeId === null ? undefined : host.nodes.get(nodeId)?.viewId) ?? host.activeViewId ?? '';

            return host.nodes.get(id)?.viewId === canvas ? host.info(id) : host.unknownNode(id, canvas);
        },
        useNodes: (filter?: (node: PublicClient.NodeInfo) => boolean) => {
            useHost(host);

            const nodes = host.nodesInFront();

            return filter === undefined ? nodes : nodes.filter(filter);
        },
        useLocale() {
            const { words } = host;

            return {
                language: host.language,
                // The same formatters a surface reads in Ruimte, in the language of this host.
                get format(): Format {
                    const format = formatModule<Format & { setFormatSource(source: object): unknown; FORMAT_LANGUAGE: string }>();

                    format.setFormatSource({ language: () => host.language, region: () => format.FORMAT_LANGUAGE, subscribe: () => () => undefined });

                    return format;
                },
                t: (key: string, values?: Record<string, string | number>) =>
                    Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), words[key] ?? key)
            };
        },
        useEvent<Name extends keyof PublicClient.ClientEvents>(name: Name, listener: (event: PublicClient.ClientEvents[Name]) => void): void {
            react().useEffect(() => host.listen(name, listener as (payload: never) => void), [name, listener]);
        },
        onEvent: <Name extends keyof PublicClient.ClientEvents>(name: Name, listener: (event: PublicClient.ClientEvents[Name]) => void) =>
            host.listen(name, listener as (payload: never) => void),
        useAgents() {
            host.hookPermission('useAgents');
            useHost(host);

            return host
                .nodesInFront()
                .filter((node) => node.kind === 'chat' || node.kind === 'terminal')
                .map((node) => ({ id: node.id, title: node.title, status: node.agent?.status ?? 'idle' }));
        },
        host: {
            async busy<Value>(work: { title: string; nodes?: NodeRef[] }, run: (signal: AbortSignal) => Value | Promise<Value>): Promise<Value> {
                const tracked = { actionId: null, nodeIds: (work.nodes ?? []).map((node) => node.id) };

                host.runs.push(tracked);
                host.changed();

                try {
                    return await run(new AbortController().signal);
                } finally {
                    host.runs.splice(host.runs.indexOf(tracked), 1);
                    host.changed();
                }
            },
            notify(text: string, options?: { tone?: 'neutral' | 'error'; action?: { title: string; run(): void } }): void {
                host.notifications.push({ text, tone: options?.tone ?? 'neutral', ...(options?.action === undefined ? {} : { action: options.action.title }) });
            },
            pickFolder: async (initial?: string) => host.ask('folder', initial ?? '', host.answers.pickFolder ?? null),
            openSettings(): void {
                host.opened.push({ kind: 'settings' });
            },
            confirm: async (options: { title: string; body: string; danger?: boolean }) =>
                host.ask('confirm', options.title, ask(host.answers.confirm, options, true), options.body),
            prompt: async (options: { title: string; placeholder?: string; initial?: string }) =>
                host.ask('prompt', options.title, ask(host.answers.prompt, options, null)),
            async pick<Item>(options: { title: string; items: readonly Item[]; label(item: Item): string }): Promise<Item | null> {
                const labels = options.items.map(options.label);
                const answer = host.ask('pick', options.title, ask(host.answers.pick, { title: options.title, labels }, null));

                return answer === null ? null : (options.items[labels.indexOf(answer)] ?? null);
            },
            openUrl(url: string): void {
                host.opened.push({ kind: 'url', id: url });
            },
            copy(text: string): void {
                host.copied.push(text);
            }
        },
        files: {
            readText: (path: string) => inFolder<string>('files.readText', path, [path]),
            write: (path: string, text: string) =>
                host.settle('files.write', [path, text], async () => {
                    host.inProject(path);
                    await host.scripted<void>('files.write', [path, text]);
                }),
            list: (folder: string) => inFolder<PublicClient.FileEntry[]>('files.list', folder, [folder]),
            // Called back by `changeFile` of the test host, for this path or anything under it.
            watch: (path: string, listener: () => void) =>
                host.attempt('files.watch', [path], () => {
                    const watch = { path: host.inProject(path), listener };

                    host.watches.add(watch);

                    return () => {
                        host.watches.delete(watch);
                    };
                }),
            open(path: string): void {
                host.opened.push({ kind: 'file', id: path });
            }
        },
        git: {
            status: (options: { repository?: string } = {}) => inFolder<PublicClient.GitStatus>('git.status', options.repository ?? '.', [options]),
            diff: (options: { path: string; repository?: string; staged?: boolean }) =>
                inFolder<PublicClient.GitFileDiff>('git.diff', options.repository ?? '.', [options]),
            log: (options: { repository?: string; limit?: number } = {}) => inFolder<PublicClient.GitCommit[]>('git.log', options.repository ?? '.', [options])
        },
        launches: machineCalls(host, 'launches', [
            'launch.list',
            'launch.read',
            'launch.start',
            'launch.restart',
            'launch.stop'
        ]) as unknown as typeof PublicClient.launches,
        routines: machineCalls(host, 'routines', ['routine.list', 'routine.run', 'routine.pause', 'routine.resume']) as unknown as typeof PublicClient.routines,
        artifacts: machineCalls(host, 'artifacts', ['artifact.list', 'artifact.read', 'artifact.publish']) as unknown as typeof PublicClient.artifacts,
        browser: machineCalls(host, 'browser', [
            'browser.inspect',
            'browser.navigate',
            'browser.back',
            'browser.forward',
            'browser.reload',
            'browser.screenshot'
        ]) as unknown as typeof PublicClient.browser,
        devices: machineCalls(host, 'devices', [
            'device.list',
            'device.inspect',
            'device.screenshot',
            'device.tap',
            'device.launch'
        ]) as unknown as typeof PublicClient.devices,
        terminals: {
            read: (terminal: NodeRef) =>
                host.settle('terminals.read', [terminal], () => host.scripted('terminals.read', [terminal], () => nodeText(host, terminal.id, 'terminal'))),
            open: (options: { title?: string; cwd?: string; near?: NodeRef[] } = {}) =>
                host.attempt('terminals.open', [options], () =>
                    host.addNode('terminal', host.beside(options.near), {
                        ...(options.title === undefined ? {} : { title: options.title }),
                        ...(options.cwd === undefined ? {} : { path: options.cwd })
                    })
                )
        },
        database: {
            connections: () => host.settle('database.connections', [], () => host.scripted<{ id: string; name: string }[]>('database.connections', [])),
            query: (connection: string, sql: string) =>
                host.settle('database.query', [connection, sql], () => {
                    host.projectId();

                    return host.scripted<{ columns: string[]; rows: PublicClient.DatabaseValue[][]; hasMore: boolean }>('database.query', [connection, sql]);
                })
        },
        chats: {
            list: () => host.settle('chats.list', [], () => host.scripted<PublicClient.ChatSummary[]>('chats.list', [])),
            read: (chatId: string) => host.settle('chats.read', [chatId], () => host.scripted('chats.read', [chatId], () => nodeText(host, chatId, 'chat'))),
            send: (chatId: string, text: string) =>
                host.settle('chats.send', [chatId, text], async () => {
                    await host.scripted<void>('chats.send', [chatId, text]);
                })
        },
        views: {
            open(view: { id: string }): void {
                host.openView(view.id);
            },
            createCanvas: (name: string) =>
                host.attempt('views.createCanvas', [name], () => {
                    host.projectId();

                    // Opened as it is made, as a person's new canvas is, so a node made next lands on it.
                    const view = host.addView('canvas', name);

                    host.openView(view.id);

                    return view;
                }),
            rename: (view: { id: string }, name: string) =>
                host.attempt('views.rename', [view, name], () => {
                    const found = host.views.find((each) => each.id === view.id);

                    if (found === undefined) {
                        throw new Refused('not-found', `No view ${view.id} in this project`);
                    }

                    found.name = name;
                    host.changed();
                })
        },
        context: {
            read: (of: { nodes?: NodeRef[]; view?: { id: string } }) =>
                host.settle('context.read', [of], () => {
                    host.projectId();

                    return host.scripted<PublicClient.ContextSource[]>('context.read', [of], () => {
                        const selects = contextSelection({ nodeIds: of.nodes?.map((node) => node.id), viewId: of.view?.id });

                        return [...host.nodes.values()]
                            .filter((node) => selects(node.id, node.viewId))
                            .map((node) => ({ id: node.id, kind: node.kind, title: node.title, text: node.text }));
                    });
                })
        },
        agents: {
            run: (options: { prompt: string; context?: string[]; provider?: string }) =>
                host.settle('agents.run', [options], () => {
                    host.projectId();

                    return host.scripted<{ text: string }>('agents.run', [options]);
                }),
            async *stream(options: { prompt: string; context?: string[]; provider?: string; signal?: AbortSignal }): AsyncGenerator<Result<{ text: string }>> {
                const { signal, ...asked } = options;

                const refused = (): boolean => {
                    try {
                        host.permitCall('agents.stream');
                        host.projectId();

                        return false;
                    } catch {
                        return true;
                    }
                };

                // Aborted before it began, so no run starts, as in Ruimte; a refusal still answers first, below.
                if (signal?.aborted === true && !refused()) {
                    return;
                }

                // The run sees the signal, so a fixture that waits on its own can end once it is stopped.
                const stop = new AbortController();
                const stopRun = (): void => stop.abort(signal?.reason);
                const answer = (host.answers as Record<string, unknown>)['agents.stream'];
                const pieces = await host.settle('agents.stream', [asked], () => {
                    host.projectId();

                    if (typeof answer !== 'function') {
                        return host.scripted<string[] | AsyncIterable<string>>('agents.stream', [asked]);
                    }

                    // An iterable is read as it goes, so a fixture can give some pieces and then fail.
                    return (answer as (options: object) => unknown)({ ...wire<object>(asked), signal: stop.signal }) as
                        | string[]
                        | AsyncIterable<string>
                        | Promise<string[]>;
                });

                if (!pieces.ok) {
                    yield pieces;

                    return;
                }

                const source: AsyncIterator<string> | Iterator<string> =
                    Symbol.asyncIterator in pieces.value ? pieces.value[Symbol.asyncIterator]() : pieces.value[Symbol.iterator]();

                const stopped = new Promise<IteratorResult<string>>((resolve) => {
                    stop.signal.addEventListener('abort', () => resolve({ done: true, value: undefined }));
                });

                signal?.addEventListener('abort', stopRun);

                try {
                    while (!stop.signal.aborted) {
                        let next: IteratorResult<string>;

                        try {
                            next = await Promise.race([source.next(), stopped]);
                        } catch (e) {
                            yield host.failure('agents.stream', [asked], e);

                            return;
                        }

                        // A run stopped while a piece was on its way says no more, and no error, as in Ruimte.
                        if (next.done === true || stop.signal.aborted) {
                            return;
                        }

                        yield { ok: true, value: { text: String(next.value) } };
                    }
                } finally {
                    signal?.removeEventListener('abort', stopRun);

                    // A loop that broke off stops the run with it, without waiting on a fixture that never ends.
                    stop.abort();
                    void Promise.resolve(source.return?.()).catch(() => undefined);
                }
            },
            // A chat a person can see, unless the test answers otherwise: beside the node it is about on the canvas in front, or a view of its own with none there.
            start: (options: { prompt?: string; provider?: string; title?: string; near?: NodeRef[] }) =>
                host.settle('agents.start', [options], () => {
                    host.projectId();

                    return host.scripted<NodeRef>('agents.start', [options], () => {
                        const title = options.title ?? 'Chat';

                        const provider = options.provider ?? 'claude';

                        if (host.views.find((view) => view.id === host.activeViewId)?.kind !== 'canvas') {
                            return host.addChatView(title, provider);
                        }

                        const created = host.addNode('chat', host.beside(options.near), { title, agent: { provider, status: 'running' } });

                        host.chats.set(created.id, { id: created.id, title, text: '', provider, status: 'running' });

                        return created;
                    });
                })
        },
        canvas: {
            createNote: (note: { title?: string; text: string; near?: NodeRef[]; color?: PublicClient.NodeColor }) =>
                host.attempt('canvas.createNote', [note], () => {
                    const created = host.addNode('note', host.beside(note.near), {
                        ...(note.title === undefined ? {} : { title: note.title }),
                        text: note.text,
                        color: note.color ?? null
                    });

                    host.notes.push(created.id);

                    return created;
                }),
            createFile: (path: string, options: { near?: NodeRef[] } = {}) =>
                host.attempt('canvas.createFile', [path, options], () => host.addNode('file', host.beside(options.near), { path })),
            createBrowser: (url: string, options: { near?: NodeRef[] } = {}) =>
                host.attempt('canvas.createBrowser', [url, options], () => host.addNode('browser', host.beside(options.near), { url })),
            createNode: <Data>(type: string, options: { data?: Data; title?: string; near?: NodeRef[] } = {}) => {
                const node = host.definitions.find((each) => each.kind === 'node' && (each.definition as { id: string }).id === type);

                // A type the extension never defined is its own mistake, as a wrong argument is.
                if (node === undefined) {
                    throw new TypeError(`${host.name} has no node ${type}`);
                }

                const defined = node.definition as { title: string; size?: { width: number; height: number }; initialData?: unknown; dataVersion?: number };

                return host.attempt('canvas.createNode', [type, options], () =>
                    host.addNode(
                        'extension',
                        options.near === undefined ? { x: 0, y: 0 } : host.beside(options.near),
                        {
                            title: options.title ?? defined.title,
                            extension: { id: host.id, type },
                            data: wire(options.data ?? defined.initialData ?? {}),
                            ...(defined.dataVersion === undefined ? {} : { dataVersion: defined.dataVersion })
                        },
                        defined.size ?? NEW_NODE
                    )
                );
            },
            update: (node: NodeRef, patch: { title?: string; x?: number; y?: number; width?: number; height?: number }) =>
                host.attempt('canvas.update', [node, patch], () => {
                    const { bounds, title } = host.nodeOnCanvas(node);

                    host.changeNode(node.id, {
                        title: patch.title ?? title,
                        bounds: { x: patch.x ?? bounds.x, y: patch.y ?? bounds.y, width: patch.width ?? bounds.width, height: patch.height ?? bounds.height }
                    });
                }),
            writeNote: (node: NodeRef, text: string) =>
                host.attempt('canvas.writeNote', [node, text], () => {
                    host.nodeOnCanvas(node);
                    host.changeNode(node.id, { text });
                }),
            arrange: (nodes: NodeRef[], layout: 'row' | 'column' | 'grid') =>
                host.attempt('canvas.arrange', [nodes, layout], () => {
                    const viewId = host.canvasInFront();
                    const placed = nodes.flatMap((node) => {
                        const found = host.nodes.get(node.id);

                        return found?.viewId === viewId ? [found] : [];
                    });
                    const first = placed[0];

                    if (first === undefined) {
                        throw new Refused('not-found', 'None of these nodes is on the canvas in front');
                    }

                    const columns = layout === 'row' ? placed.length : layout === 'column' ? 1 : Math.ceil(Math.sqrt(placed.length));
                    const width = Math.max(...placed.map((node) => node.bounds.width));
                    const height = Math.max(...placed.map((node) => node.bounds.height));
                    const { x, y } = first.bounds;

                    placed.forEach((node, index) => {
                        host.changeNode(node.id, {
                            bounds: {
                                ...node.bounds,
                                x: x + (index % columns) * (width + ARRANGE_GAP),
                                y: y + Math.floor(index / columns) * (height + ARRANGE_GAP)
                            }
                        });
                    });
                }),
            // A person confirms, as anywhere a node goes away.
            remove: (nodes: NodeRef[]) =>
                host.settle('canvas.remove', [nodes], () => {
                    host.canvasInFront();

                    const title = removeTitle(nodes.length);
                    const body = removeBody(nodes.length, host.name);

                    if (!host.ask('confirm', title, ask(host.answers.confirm, { title, body }, true), body)) {
                        throw new Refused('refused', 'The person kept them');
                    }

                    host.remove(nodes.map((node) => node.id));
                }),
            group: (nodes: NodeRef[]) =>
                host.attempt('canvas.group', [nodes], () => {
                    const group = host.addGroup(nodes.map((node) => node.id));

                    if (group === null) {
                        throw new Refused('refused', 'These nodes make no group on the canvas in front');
                    }

                    return group;
                }),
            link: (from: NodeRef, to: NodeRef) =>
                host.attempt('canvas.link', [from, to], () => {
                    host.nodeOnCanvas(from);
                    host.addEdge(from.id, to.id);
                    host.changed();
                }),
            unlink: (from: NodeRef, to: NodeRef) =>
                host.attempt('canvas.unlink', [from, to], () => {
                    host.nodeOnCanvas(from);

                    const at = host.edges.findIndex((edge) => (edge.from === from.id && edge.to === to.id) || (edge.from === to.id && edge.to === from.id));

                    if (at >= 0) {
                        host.edges.splice(at, 1);
                        host.changed();
                    }
                }),
            select(nodes: NodeRef[]): void {
                host.select(nodes.map((node) => node.id));
            },
            reveal(target: NodeRef): void {
                host.revealed.push(target.id);
            }
        }
    } satisfies typeof PublicClient;
}

export type ClientApi = ReturnType<typeof clientApi>;
