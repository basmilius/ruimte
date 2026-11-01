import { createContext, createElement, lazy, Suspense, use, useContext, useEffect, useRef, useState, type ComponentType } from 'react';
import { icons, Package, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { databaseConnections } from '@/database/connections';
import { desktop } from '@/desktop/bridge';
import { assertShortcut } from '@/extensions/action-shortcuts';
import { addFileIcons } from '@/extensions/file-icons';
import { settingKey, useExtensionStorage, writeExtensionStorage } from '@/extensions/host/extension-storage';
import { useTheme as useUiTheme } from '@/state/theme';
import * as format from '@adecore/ui/format';
import { ErrorBoundary } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import type { ExtensionManifest, NodeAccent, RequestMap } from '@ruimte/contracts';
import { revealNode } from '@/project/views';
import { ExtensionGlyph } from '@/extensions/ExtensionTile';
import { runAction, trackRun, useActionRuns } from '@/extensions/action-runs';
import { sendDevLog } from '@/extensions/dev-log';
import { DevReport } from '@/extensions/DevReport';
import { contribute, useContributions, type ExtensionSurfaceProps, type SettingField, type SlotEntry, type SlotName } from '@/extensions/registry';
import { baseContext, nodeInfoOf, type NodeInfo } from '@/extensions/slots';
import { onClientEvent, type ClientEvents } from '@/extensions/client-events';
import { askHost, openOverlay, type OpenOverlay } from '@/extensions/host/host-dialog-state';
import { openFileLink } from '@/shell/panels/file-links';
import { currentEndpointId } from '@/state/keys';
import { canvasOfNode, focusedCanvas, useCanvas, useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { nodeStatus, nodeWaitAsk, useSessions } from '@/state/sessions';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useFocusedMachine } from '@/transport/connections';
import { transport as activeTransport, type Transport } from '@/transport';

export interface LoadedExtension {
    manifest: ExtensionManifest;
    // Where its files are on the app's origin, ending in a slash.
    base: string;
    // Its `assets/icon.svg`, for a surface that names no Lucide icon of its own.
    iconUrl?: string | null;
    // Linked by `ruimte extension dev`, so what it says also goes to that terminal.
    dev?: boolean;
    disposers: (() => void)[];
    settings: ComponentType | null;
}

const usePanelParams = create<{ params: Record<string, unknown> }>(() => ({ params: {} }));

type UsageLimitsResult = RequestMap['usage.limits']['result'];
type LazyComponent<Props = {}> = () => Promise<{ default: ComponentType<Props> }>;
type Surface<Props = {}> = { component: LazyComponent<Props> } | { frame: string };

const ExtensionContext = createContext<LoadedExtension | null>(null);
const NodeContext = createContext<string | null>(null);

/* A surface's icon: the Lucide one it names, or the extension's own mark in the ink around it. */
function iconOf(name: string | undefined, extension: LoadedExtension): LucideIcon {
    const { iconUrl } = extension;

    if (name === undefined && iconUrl !== undefined && iconUrl !== null) {
        // oxlint-disable-next-line react/only-export-components -- Made per extension, and never hot-reloaded.
        const Mark = ({ size, className }: { size?: number | string; className?: string }) => (
            <ExtensionGlyph url={iconUrl} size={Number(size ?? 16)} {...(className === undefined ? {} : { className })} />
        );

        return Mark as unknown as LucideIcon;
    }

    const key = (name ?? '')
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

    return (icons as Record<string, LucideIcon>)[key] ?? Package;
}

function useExtension(): LoadedExtension {
    const extension = useContext(ExtensionContext);

    if (extension === null) {
        throw new Error('This hook only works inside something an extension draws');
    }

    return extension;
}

function frameHostFor(extension: LoadedExtension, path: string): ComponentType {
    // oxlint-disable-next-line react/only-export-components -- Made per extension, and never hot-reloaded.
    return function ExtensionFrame() {
        const { transport } = useFocusedMachine();
        const frame = useRef<HTMLIFrameElement>(null);

        // The one way out of a frame: it asks, and this answers with what a client of this machine may do.
        useEffect(() => {
            const listen = (event: MessageEvent<{ ruimte?: number; method?: string; args?: unknown[] }>) => {
                if (event.source !== frame.current?.contentWindow || event.data.ruimte === undefined || event.data.method === undefined) {
                    return;
                }

                const { ruimte: callId, method, args = [] } = event.data;

                void transport
                    .request('extension.call', { id: extension.manifest.id, method, args })
                    .then(({ result }) => frame.current?.contentWindow?.postMessage({ ruimte: callId, result }, '*'))
                    .catch((e: unknown) => frame.current?.contentWindow?.postMessage({ ruimte: callId, error: String(e) }, '*'));
            };

            window.addEventListener('message', listen);

            return () => window.removeEventListener('message', listen);
        }, [transport]);

        return (
            <iframe
                ref={frame}
                title={extension.manifest.name}
                src={`${extension.base}${path}`}
                sandbox="allow-scripts allow-forms"
                className="h-full w-full border-0"
            />
        );
    };
}

/* What every surface of an extension sits in: its own name for the hooks, and a boundary of its own so a failure stays in its rectangle. */
function surfaceOf<Props extends object>(extension: LoadedExtension, surface: Surface<Props>): ComponentType<Props & ExtensionSurfaceProps> {
    const Body =
        'frame' in surface
            ? (frameHostFor(extension, surface.frame) as unknown as ComponentType<Props>)
            : (lazy(surface.component) as unknown as ComponentType<Props>);

    // oxlint-disable-next-line react/only-export-components -- Made per extension, and never hot-reloaded.
    return function ExtensionSurface(props) {
        return (
            <ExtensionContext value={extension}>
                <NodeContext value={props.nodeId ?? null}>
                    <ErrorBoundary label={`${extension.manifest.name} could not be shown`} resetKeys={[extension.base]} compact>
                        <DevReport id={extension.manifest.id} dev={extension.dev === true}>
                            <Suspense fallback={null}>{createElement(Body as ComponentType<object>, props)}</Suspense>
                        </DevReport>
                    </ErrorBoundary>
                </NodeContext>
            </ExtensionContext>
        );
    };
}

type PublicSlots = Partial<
    Record<SlotName, true | ((context: never) => boolean | { title?: string; icon?: string; disabled?: boolean | string; badge?: string; order?: number })>
>;

function assertLazy(surface: { component?: unknown; frame?: unknown }, what: string): void {
    if (
        surface.frame === undefined &&
        (typeof surface.component !== 'function' || surface.component.length !== 0 || /^(class|function [A-Z])/.test(String(surface.component)))
    ) {
        throw new TypeError(`${what}: component must be a lazy import, such as () => import('./Panel')`);
    }
}

/* Where a new node goes: right of the one it is about, as a person would drag it. */
function besideNode(nodeId: string | undefined): { x: number; y: number } {
    const canvas = focusedCanvas().getState();
    const anchor = nodeId === undefined ? undefined : canvas.nodes[nodeId];

    return anchor === undefined ? { x: 0, y: 0 } : { x: anchor.x + anchor.w + 240, y: anchor.y + anchor.h / 2 };
}

/* A file request stays inside the project folder, whatever an extension asks for. */
function inProject(path: string): string {
    const folder = useProject.getState().current?.folder;

    if (folder === undefined) {
        throw new Error('This needs a project with a folder');
    }

    const full = path.startsWith('/') ? path : path === '.' ? folder : `${folder}/${path}`;

    if (full !== folder && (!full.startsWith(`${folder}/`) || full.split('/').includes('..'))) {
        throw new Error(`${path} is outside the project folder`);
    }

    return full;
}

const wordsCache = new Map<string, Promise<Record<string, string>>>();

function wordsOf(extension: LoadedExtension, language: string): Promise<Record<string, string>> {
    const key = `${extension.base}${language}`;
    let words = wordsCache.get(key);

    if (words === undefined) {
        const read = (name: string) =>
            fetch(`${extension.base}locales/${name}.json`)
                .then((answer) => (answer.ok ? (answer.json() as Promise<Record<string, string>>) : {}))
                .catch(() => ({}));

        words = Promise.all([read('en'), read(language)]).then(([english, own]) => ({ ...english, ...own }));
        wordsCache.set(key, words);
    }

    return words;
}

const ARRANGE_GAP = 40;

function requiresPermission(extension: LoadedExtension, permission: string): void {
    if (!Object.hasOwn(extension.manifest.permissions ?? {}, permission)) {
        throw new Error(`${extension.manifest.name} did not ask for the permission ${permission} in its manifest`);
    }
}

/* The `.use()` of a server method suspends, so its answers are kept by what was asked. */
function serverClient(extension: LoadedExtension, transport: Pick<Transport, 'request'>): unknown {
    const cache = new Map<string, Promise<unknown>>();
    const call = (method: string, args: unknown[]): Promise<unknown> =>
        transport.request('extension.call', { id: extension.manifest.id, method, args }).then(({ result }) => result);

    return new Proxy(
        {},
        {
            get(_target, method) {
                if (typeof method !== 'string') {
                    return undefined;
                }

                return Object.assign((...args: unknown[]) => call(method, args), {
                    use(...args: unknown[]) {
                        const key = JSON.stringify([method, args]);
                        let pending = cache.get(key);

                        if (pending === undefined) {
                            pending = call(method, args);
                            cache.set(key, pending);
                        }

                        return use(pending);
                    }
                });
            }
        }
    );
}

export function clientApiFor(extension: LoadedExtension) {
    const { id } = extension.manifest;
    const servers = new WeakMap<object, unknown>();
    const reportFailure = (what: string) => (text: string) => {
        if (extension.dev === true) {
            sendDevLog(id, 'error', [`${what}: ${text}`]);
        }
    };
    /* A slot names its icon by a word; what a host draws is the icon itself. */
    const slotsOf = (slots: PublicSlots): SlotEntry['slots'] =>
        Object.fromEntries(
            Object.entries(slots).map(([place, slot]) => [
                place,
                slot === true
                    ? true
                    : (context: object) => {
                          const answer = (slot as (context: object) => boolean | { icon?: string })(context);

                          return typeof answer === 'object' && answer.icon !== undefined ? { ...answer, icon: iconOf(answer.icon, extension) } : answer;
                      }
            ])
        ) as SlotEntry['slots'];
    const add = <Kind extends Parameters<typeof contribute>[0]>(kind: Kind, item: Parameters<typeof contribute<Kind>>[1]): (() => void) => {
        const dispose = contribute(kind, item);

        extension.disposers.push(dispose);

        return dispose;
    };

    return {
        definePanel<Params>(panel: { id: string; title: string; icon?: string; minWidth?: number } & Surface<{ params: Params }>) {
            assertLazy(panel, `definePanel ${panel.id}`);

            const kind = `extension:${id}/${panel.id}` as const;
            const Body = surfaceOf(extension, panel) as ComponentType<{ params: Params | undefined }>;
            let title = panel.title;
            let badge: string | null = null;
            // A panel's label is read when it draws, so a change has to make the rail draw again.
            const relabel = (): void => useContributions.setState(({ panels }) => ({ panels: [...panels] }));

            add('panels', {
                kind,
                icon: iconOf(panel.icon, extension),
                minWidth: panel.minWidth ?? 280,
                toolbar: true,
                group: 'extensions',
                label: () => (badge === null ? title : `${title} (${badge})`),
                badge: () => badge,
                component: function ExtensionPanel() {
                    const params = usePanelParams((state) => state.params[kind]) as Params | undefined;

                    return createElement(Body, { params });
                }
            });

            return {
                open: (params?: Params) => {
                    usePanelParams.setState(({ params: all }) => ({ params: { ...all, [kind]: params } }));
                    useUi.getState().setPanel({ open: true, kind });
                },
                close: () => useUi.getState().setPanel({ open: false }),
                setBadge: (text: string | null) => {
                    badge = text;
                    relabel();
                },
                setTitle: (next: string) => {
                    title = next;
                    relabel();
                }
            };
        },
        defineSidebarCard(card: { id: string; title: string; component: LazyComponent }) {
            assertLazy(card, `defineSidebarCard ${card.id}`);
            add('sidebarCards', { id: `${id}/${card.id}`, title: card.title, component: surfaceOf(extension, card) as ComponentType });
        },
        defineView(view: { id: string; title: string; icon?: string } & Surface<{ params: unknown }>) {
            assertLazy(view, `defineView ${view.id}`);

            const open = (params?: unknown) => {
                useDocument.getState().addExtensionView(view.title, id, view.id, params);
            };

            add('extensionViews', { id: `${id}/${view.id}`, title: view.title, component: surfaceOf(extension, view) as ComponentType<{ params: unknown }> });
            add('commands', { id: `extension:${id}/view/${view.id}`, title: `New ${view.title}`, run: open });

            return { open };
        },
        defineNode(
            node: {
                id: string;
                title: string;
                icon?: string;
                size?: { width: number; height: number };
                initialData?: unknown;
                dataVersion?: number;
                migrate?: (stored: unknown, from: number) => unknown;
                addFrom?: PublicSlots;
            } & Surface
        ) {
            assertLazy(node, `defineNode ${node.id}`);
            add('extensionNodes', {
                id: `${id}/${node.id}`,
                title: node.title,
                icon: iconOf(node.icon, extension),
                component: surfaceOf(extension, node) as ComponentType<ExtensionSurfaceProps>,
                ...(node.migrate === undefined || node.dataVersion === undefined ? {} : { migrate: node.migrate, dataVersion: node.dataVersion })
            });
            // Adding is an action like any other, so an extension chooses where it shows; by default where a person adds nodes.
            add('slotEntries', {
                id: `${id}/node/${node.id}`,
                kind: 'action',
                title: node.title,
                addsNode: true,
                icon: iconOf(node.icon, extension),
                slots: slotsOf(node.addFrom ?? { canvasMenu: true, commandPalette: true }),
                run: (context) => {
                    focusedCanvas()
                        .getState()
                        .addExtensionNode(
                            id,
                            node.id,
                            node.title,
                            node.size ?? { width: 420, height: 300 },
                            node.initialData ?? {},
                            node.dataVersion,
                            (context as { at?: { x: number; y: number } }).at
                        );
                }
            });
        },
        defineCanvasOverlay(overlay: { id: string; component: LazyComponent }) {
            assertLazy(overlay, `defineCanvasOverlay ${overlay.id}`);
            add('canvasLayers', { id: `${id}/${overlay.id}`, place: 'screen', component: surfaceOf(extension, overlay) as ComponentType<{ z: number }> });
        },
        defineFileViewer(viewer: { id: string; title: string; extensions: string[]; component: LazyComponent<{ file: object }> }) {
            assertLazy(viewer, `defineFileViewer ${viewer.id}`);
            add('fileViewers', {
                id: `${id}/${viewer.id}`,
                title: viewer.title,
                extensions: viewer.extensions.map((name) => name.toLowerCase()),
                component: surfaceOf(extension, viewer) as ComponentType<{ file: { path: string; name: string; extension: string; text: string | null } }>
            });
        },
        defineMarkdownBlock(block: { language: string; component: LazyComponent<{ source: string }> }) {
            assertLazy(block, `defineMarkdownBlock ${block.language}`);
            add('markdownBlocks', {
                id: `${id}/${block.language}`,
                language: block.language,
                component: surfaceOf(extension, block) as ComponentType<{ source: string }>
            });
        },
        defineOverlay<Params, Result>(overlay: {
            id: string;
            title: string;
            size?: 'sm';
            component: LazyComponent<{ params: Params; close: (result?: Result) => void }>;
        }) {
            assertLazy(overlay, `defineOverlay ${overlay.id}`);

            const component = surfaceOf(extension, overlay) as unknown as OpenOverlay['component'];
            const closers = new Set<(result?: unknown) => void>();

            extension.disposers.push(() => closers.forEach((close) => close()));

            return {
                open(params: Params): Promise<Result | null> {
                    const { result, close } = openOverlay({ title: overlay.title, size: overlay.size, component, params });

                    closers.add(close);

                    return result.finally(() => closers.delete(close)) as Promise<Result | null>;
                },
                close: () => closers.forEach((close) => close())
            };
        },
        defineToolResult(result: { id: string; tools: string[]; component: LazyComponent<{ call: object }> }) {
            assertLazy(result, `defineToolResult ${result.id}`);
            add('toolResults', {
                id: `${id}/${result.id}`,
                tools: result.tools,
                component: surfaceOf(extension, result) as ComponentType<{ call: { name: string; input: unknown; output: string | null; state: string } }>
            });
        },
        defineSlashCommand(command: { name: string; description: string; run: (args: string) => string | Promise<string> }) {
            add('slashCommands', {
                id: `${id}/${command.name}`,
                name: command.name,
                description: command.description,
                expand: async (args) => command.run(args)
            });
        },
        defineReference(reference: {
            id: string;
            title: string;
            list: () => Promise<readonly { id: string; name: string }[]>;
            read: (item: { id: string; name: string }) => Promise<string>;
        }) {
            add('references', { id: `${id}/${reference.id}`, title: reference.title, list: reference.list, read: reference.read });
        },
        defineDiffViewer(viewer: { id: string; title: string; extensions: string[]; component: LazyComponent<{ file: object; diff: string }> }) {
            assertLazy(viewer, `defineDiffViewer ${viewer.id}`);
            add('diffViewers', {
                id: `${id}/${viewer.id}`,
                title: viewer.title,
                extensions: viewer.extensions.map((name) => name.toLowerCase()),
                component: surfaceOf(extension, viewer) as ComponentType<{ file: { path: string; name: string; extension: string }; diff: string }>
            });
        },
        defineFileIcon(icon: { extensions: string[]; path: string }) {
            extension.disposers.push(addFileIcons(`${extension.base}${icon.path}`, icon.extensions));
        },
        defineVoiceAction(action: { id: string; description: string; parameters?: object; run: (input: unknown) => string | Promise<string> }) {
            add('voiceActions', {
                id: `${id}/${action.id}`,
                description: action.description,
                parameters: action.parameters ?? { type: 'object', properties: {} },
                run: async (input) => action.run(input)
            });
        },
        defineTemplate(template: { id: string; title: string; icon?: string; create: (context: object) => void | Promise<void> }) {
            add('slotEntries', {
                id: `${id}/template/${template.id}`,
                kind: 'action',
                addsNode: true,
                title: template.title,
                ...(template.icon === undefined ? {} : { icon: iconOf(template.icon, extension) }),
                slots: { canvasMenu: true },
                run: template.create,
                onFailure: reportFailure(template.id)
            });
        },
        defineCommand(command: { id: string; title: string; run: () => void | Promise<void> }) {
            add('commands', { id: `extension:${id}/${command.id}`, title: command.title, run: command.run });
        },
        defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] } | { fields: SettingField[] }) {
            if ('fields' in settings) {
                add('extensionSchemas', { id, fields: settings.fields });

                return;
            }

            assertLazy(settings, `defineExtensionSettings ${id}`);
            add('extensionSettings', { id, component: surfaceOf(extension, settings) as ComponentType, keywords: settings.keywords ?? [] });
        },
        defineAction(action: {
            id: string;
            title: string;
            icon?: string;
            shortcut?: string;
            slots?: PublicSlots;
            run: (context: never) => void | Promise<void>;
        }) {
            if (action.shortcut !== undefined) {
                assertShortcut(action.shortcut);
            }

            const entry: SlotEntry = {
                id: `${id}/${action.id}`,
                kind: 'action',
                title: action.title,
                ...(action.icon === undefined ? {} : { icon: iconOf(action.icon, extension) }),
                ...(action.shortcut === undefined ? {} : { shortcut: action.shortcut }),
                slots: slotsOf(action.slots ?? {}),
                run: action.run as (context: object) => void | Promise<void>,
                onFailure: reportFailure(action.id)
            };

            add('slotEntries', entry);

            return {
                actionId: entry.id,
                run: (context?: object) => runAction(entry, { ...baseContext(), ...context }, 'code'),
                useRunning: () => useActionRuns((state) => state.runs.some((run) => run.actionId === entry.id))
            };
        },
        defineMenu(menu: { id: string; title: string; icon?: string; slots: PublicSlots; items: SlotEntry['items'] }) {
            add('slotEntries', {
                id: `${id}/${menu.id}`,
                kind: 'menu',
                title: menu.title,
                ...(menu.icon === undefined ? {} : { icon: iconOf(menu.icon, extension) }),
                slots: slotsOf(menu.slots),
                ...(menu.items === undefined ? {} : { items: menu.items }),
                onFailure: reportFailure(menu.id)
            });
        },
        defineWidget(widget: { id: string; slots: PublicSlots; component: LazyComponent<{ context: object }> }) {
            assertLazy(widget, `defineWidget ${widget.id}`);
            add('slotEntries', {
                id: `${id}/${widget.id}`,
                kind: 'widget',
                title: widget.id,
                slots: slotsOf(widget.slots),
                component: surfaceOf(extension, widget) as ComponentType<{ context: object; nodeId?: string | undefined }>,
                onFailure: reportFailure(widget.id)
            });
        },
        useServer<Server>(): Server {
            const extensionNow = useExtension();
            const { transport } = useFocusedMachine();
            // Kept per machine, or `.use()` would ask again on every render and never settle.
            let server = servers.get(transport);

            if (server === undefined) {
                server = serverClient(extensionNow, transport);
                servers.set(transport, server);
            }

            return server as Server;
        },
        useServerEvent(name: string, listener: (payload: unknown) => void) {
            const extensionNow = useExtension();
            const { transport } = useFocusedMachine();

            useEffect(
                () =>
                    transport.on('extension.message', (message) => {
                        if (message.id === extensionNow.manifest.id && message.name === name) {
                            listener(message.payload);
                        }
                    }),
                [extensionNow, transport, name, listener]
            );
        },
        useUsageLimits() {
            requiresPermission(useExtension(), 'usage.read');

            const { transport } = useFocusedMachine();
            const [limits, setLimits] = useState<UsageLimitsResult | null>(null);

            useEffect(() => {
                let current = true;

                void transport.request('usage.limits', {}).then((next) => {
                    if (current) {
                        setLimits(next);
                    }
                });

                const stop = transport.on('usage.limitsChanged', setLimits);

                return () => {
                    current = false;
                    stop();
                };
            }, [transport]);

            return (limits?.providers ?? []).map((provider) => ({
                provider: provider.kind,
                plan: provider.plan,
                windows: provider.windows.map((window) => ({ label: window.label, used: window.used, resetsAt: window.resetsAt }))
            }));
        },
        useNodeData<Data>(): [Data, (next: Data) => void] {
            const nodeId = useContext(NodeContext);

            if (nodeId === null) {
                throw new Error('useNodeData only works in a node');
            }

            const data = useCanvas((state) => state.nodes[nodeId]?.raw?.data) as Data;
            const store = useCanvasStore();

            return [data, (next) => store.getState().updateExtensionNode(nodeId, { data: next })];
        },
        useStorage<Value>(key: string, initial: Value, scope: 'computer' | 'project' | 'machine' = 'computer'): [Value, (next: Value) => void] {
            const extensionNow = useExtension();
            const full = `ruimte.extension.${extensionNow.manifest.id}.${key}`;
            const local = useExtensionStorage(full, initial);
            const { transport } = useFocusedMachine();
            const projectId = useProject((state) => state.current?.projectId ?? '');
            const remoteKey = scope === 'project' ? `project:${projectId}:${key}` : key;
            const [remote, setRemote] = useState<Value>(initial);

            useEffect(() => {
                if (scope === 'computer') {
                    return undefined;
                }

                let current = true;

                void transport.request('extension.storageGet', { id: extensionNow.manifest.id, key: remoteKey }).then(
                    ({ value }) => {
                        if (current && value !== undefined) {
                            setRemote(value as Value);
                        }
                    },
                    // Without a machine it starts from the initial value, as for a key never written.
                    () => undefined
                );

                return () => {
                    current = false;
                };
            }, [transport, extensionNow, scope, remoteKey]);

            if (scope === 'computer') {
                return [local, (next) => writeExtensionStorage(full, next)];
            }

            return [
                remote,
                (next) => {
                    setRemote(next);
                    void transport.request('extension.storageSet', { id: extensionNow.manifest.id, key: remoteKey, value: next }).catch(() => undefined);
                }
            ];
        },
        useProject() {
            const projectId = useProject((state) => state.current?.projectId ?? '');
            const name = useProject((state) => state.current?.name ?? '');

            return { id: projectId, name };
        },
        useActiveView() {
            return { id: useDocument((state) => state.activeViewId ?? '') };
        },
        useSelection() {
            return useCanvas((state) => state.selection).map(nodeInfoOf);
        },
        useSetting<Value>(key: string): Value {
            const extensionNow = useExtension();
            const fields = useContributions((state) => state.extensionSchemas.find((schema) => schema.id === extensionNow.manifest.id)?.fields);
            const initial = fields?.find((field) => field.key === key)?.default;

            return useExtensionStorage(settingKey(extensionNow.manifest.id, key), initial as Value);
        },
        useMachine() {
            return { id: useFocusedMachine().endpointId };
        },
        useTheme() {
            return { side: useUiTheme((state) => state.resolved) };
        },
        useChat(chatId: string) {
            const endpointId = useEndpointId();
            const info = useChats((state) => state.byKey[endpointKey(endpointId, chatId)]?.info);

            return info === undefined ? null : { id: chatId, status: info.status, provider: info.provider };
        },
        useNode(nodeId: string) {
            useCanvas((state) => state.nodes[nodeId]);

            return nodeInfoOf(nodeId);
        },
        useNodes(filter?: (node: NodeInfo) => boolean) {
            const nodes = Object.keys(useCanvas((state) => state.nodes)).map(nodeInfoOf);

            return filter === undefined ? nodes : nodes.filter(filter);
        },
        useViews() {
            return useDocument((state) => state.views).map((view) => ({ id: view.id, kind: view.kind, name: view.name ?? '' }));
        },
        useLocale() {
            const extensionNow = useExtension();
            const { i18n } = useTranslation();
            const words = use(wordsOf(extensionNow, i18n.language));

            return {
                language: i18n.language,
                format,
                t: (key: string, values?: Record<string, unknown>) =>
                    Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), words[key] ?? key)
            };
        },
        useEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void) {
            useEffect(() => onClientEvent(name, listener), [name, listener]);
        },
        onEvent: onClientEvent,
        useAgents() {
            requiresPermission(useExtension(), 'agents.status');

            const nodes = useCanvas((state) => state.nodes);
            const sessions = useSessions((state) => state.byKey);
            const chats = useChats((state) => state.byKey);
            const endpointId = useEndpointId();

            return Object.values(nodes)
                .filter((node) => node.kind === 'chat' || node.kind === 'terminal')
                .map((node) => ({
                    id: node.id,
                    title: node.title,
                    status: nodeStatus(node, sessions, chats, endpointId),
                    needsYou: nodeWaitAsk(node, sessions, chats, endpointId) !== null
                }));
        },
        host: {
            busy<Result>(work: { title: string; nodes?: { id: string }[] }, run: (signal: AbortSignal) => Result | Promise<Result>) {
                return trackRun({ actionId: null, title: work.title, nodeIds: (work.nodes ?? []).map((node) => node.id) }, run);
            },
            notify(text: string, options?: { tone?: 'neutral' | 'error'; action?: { title: string; run: () => void } }) {
                useToasts.getState().show({
                    kind: options?.tone === 'error' ? 'error' : 'success',
                    title: text,
                    ...(options?.action === undefined ? {} : { action: { label: options.action.title, run: options.action.run } })
                });
            },
            pickFolder: (initial?: string) => desktop()?.pickFolder?.(initial) ?? Promise.resolve(null),
            openSettings() {
                useUi.getState().setSettings({ open: true, section: 'extensions' });
            },
            confirm: async ({ title, body, danger }: { title: string; body: string; danger?: boolean }) =>
                (await askHost({ title, body, ...(danger === undefined ? {} : { danger }) })) !== null,
            prompt: ({ title, placeholder, initial }: { title: string; placeholder?: string; initial?: string }) =>
                askHost({ title, field: { ...(placeholder === undefined ? {} : { placeholder }), ...(initial === undefined ? {} : { initial }) } }),
            async pick<Item>({ title, items, label }: { title: string; items: readonly Item[]; label: (item: Item) => string }) {
                const words = items.map(label);
                const answer = await askHost({ title, choices: words });

                return answer === null ? null : (items[words.indexOf(answer)] ?? null);
            },
            openUrl(url: string) {
                window.open(url, '_blank', 'noopener');
            },
            copy(text: string) {
                void navigator.clipboard.writeText(text);
            }
        },
        files: {
            async readText(path: string) {
                requiresPermission(extension, 'files.read');

                const answer = await activeTransport.request('fs.read', { path: inProject(path) });

                if (answer.kind !== 'text') {
                    throw new Error(`${path} is not a text file`);
                }

                return answer.text;
            },
            async write(path: string, text: string) {
                requiresPermission(extension, 'files.write');
                const full = inProject(path);
                const existing = await activeTransport.request('fs.read', { path: full }).catch(() => null);

                if (existing?.kind !== 'text') {
                    await activeTransport.request('fs.create', { path: full, kind: 'file', text });
                } else {
                    await activeTransport.request('fs.write', { path: full, text, expectedMtime: existing.mtime });
                }
            },
            async list(folder: string) {
                requiresPermission(extension, 'files.read');

                const { entries } = await activeTransport.request('fs.list', { path: inProject(folder) });

                return entries.map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind }));
            },
            watch(path: string, listener: () => void) {
                requiresPermission(extension, 'files.read');

                const full = inProject(path);
                const stop = activeTransport.on('fs.changed', ({ root, changedPaths }) => {
                    if (root === full || changedPaths?.some((changed) => changed === full || changed.startsWith(`${full}/`))) {
                        listener();
                    }
                });

                void activeTransport.request('fs.watch', { path: full }).catch(() => undefined);

                return () => {
                    stop();
                    void activeTransport.request('fs.unwatch', { path: full }).catch(() => undefined);
                };
            },
            open(path: string) {
                void openFileLink(useProject.getState().current?.folder ?? null, { path, directory: false }, currentEndpointId());
            }
        },
        git: {
            status(repository?: string) {
                requiresPermission(extension, 'git.read');

                return activeTransport.request('git.status', { cwd: repository ?? inProject('.') });
            },
            async diff(options?: { repository?: string; path?: string }) {
                requiresPermission(extension, 'git.read');

                return activeTransport.request('git.diff', {
                    cwd: options?.repository ?? inProject('.'),
                    scope: 'worktree',
                    ...(options?.path === undefined ? {} : { path: options.path })
                });
            },
            log(options?: { repository?: string; limit?: number }) {
                requiresPermission(extension, 'git.read');

                return activeTransport.request('git.log', { cwd: options?.repository ?? inProject('.'), limit: options?.limit ?? 30 });
            }
        },
        database: {
            async connections() {
                requiresPermission(extension, 'database.read');

                return ((await databaseConnections.ready()) ?? []).map((connection: { id: string; name: string }) => ({
                    id: connection.id,
                    name: connection.name
                }));
            },
            query(connection: string, sql: string) {
                requiresPermission(extension, 'database.read');

                return activeTransport.request('extension.databaseQuery', { projectId: useProject.getState().current?.projectId ?? '', connection, sql });
            }
        },
        chats: {
            list: () => {
                requiresPermission(extension, 'chats.read');

                return activeTransport.request('chat.list', {}).then(({ chats }) => chats);
            },
            async read(chatId: string) {
                requiresPermission(extension, 'chats.read');

                const { sources } = await activeTransport.request('extension.contextRead', {
                    projectId: useProject.getState().current?.projectId ?? '',
                    nodeIds: [chatId]
                });

                return sources[0]?.text ?? '';
            },
            async send(chatId: string, text: string) {
                requiresPermission(extension, 'chats.send');
                await activeTransport.request('chat.send', { chatId, text });
            }
        },
        views: {
            open(view: { id: string }) {
                useDocument.getState().setActiveView(view.id);
            },
            createCanvas(name: string) {
                requiresPermission(extension, 'views.write');

                return { id: useDocument.getState().addCanvasView(name) };
            },
            rename(view: { id: string }, name: string) {
                requiresPermission(extension, 'views.write');
                useDocument.getState().renameView(view.id, name);
            }
        },
        context: {
            read: (of: { nodes?: { id: string }[]; view?: { id: string } }) => {
                requiresPermission(extension, 'context.read');

                return activeTransport
                    .request('extension.contextRead', {
                        projectId: useProject.getState().current?.projectId ?? '',
                        ...(of.nodes === undefined ? {} : { nodeIds: of.nodes.map((node) => node.id) }),
                        ...(of.view === undefined ? {} : { viewId: of.view.id })
                    })
                    .then(({ sources }) => sources);
            }
        },
        agents: {
            run: (options: { prompt: string; context?: string[]; provider?: string }) => {
                requiresPermission(extension, 'agents.run');

                return activeTransport
                    .request('extension.agentRun', {
                        prompt: [options.prompt, ...(options.context ?? [])].join('\n\n'),
                        ...(options.provider === undefined ? {} : { provider: options.provider }),
                        projectId: useProject.getState().current?.projectId ?? ''
                    })
                    .then(({ text }) => ({ text }));
            },
            async *stream(options: { prompt: string; context?: string[]; provider?: string; signal?: AbortSignal }): AsyncGenerator<{ text: string }> {
                requiresPermission(extension, 'agents.run');

                const runId = crypto.randomUUID();
                const pieces: string[] = [];
                let wake = (): void => undefined;
                let done = false;
                const stop = activeTransport.on('extension.agentChunk', (chunk) => {
                    if (chunk.runId === runId) {
                        pieces.push(chunk.text);
                        wake();
                    }
                });
                const finished = activeTransport
                    .request('extension.agentStream', {
                        runId,
                        prompt: [options.prompt, ...(options.context ?? [])].join('\n\n'),
                        ...(options.provider === undefined ? {} : { provider: options.provider }),
                        projectId: useProject.getState().current?.projectId ?? ''
                    })
                    .finally(() => {
                        done = true;
                        wake();
                    });

                options.signal?.addEventListener('abort', () => void activeTransport.request('extension.agentStop', { runId }).catch(() => undefined));

                try {
                    while (!done || pieces.length > 0) {
                        const text = pieces.shift();

                        if (text !== undefined) {
                            yield { text };
                        } else if (!done) {
                            await new Promise<void>((resolve) => {
                                wake = resolve;
                            });
                        }
                    }

                    await finished;
                } finally {
                    stop();
                }
            },
            // A chat a person can see, follow and stop: on the canvas in front, or a view of its own with none there.
            async start(options: { prompt?: string; provider?: string; title?: string; near?: { id: string }[] }) {
                requiresPermission(extension, 'agents.start');

                const { views, activeViewId } = useDocument.getState();
                const onCanvas = views.find((view) => view.id === activeViewId)?.kind === 'canvas';
                const beside = options.near?.[0]?.id;
                const { nodeId } = await activeTransport.request('extension.agentStart', {
                    id,
                    projectId: useProject.getState().current?.projectId ?? '',
                    ...(onCanvas && activeViewId !== null ? { viewId: activeViewId } : {}),
                    ...(onCanvas && beside !== undefined ? { beside } : {}),
                    ...(options.provider === undefined ? {} : { provider: options.provider }),
                    ...(options.title === undefined ? {} : { title: options.title }),
                    ...(options.prompt === undefined ? {} : { prompt: options.prompt })
                });

                return { id: nodeId };
            }
        },
        canvas: {
            createNote(note: { title?: string; text: string; near?: { id: string }[]; color?: NodeAccent }) {
                requiresPermission(extension, 'canvas.write');

                const nodeId = focusedCanvas()
                    .getState()
                    .addNode('note', besideNode(note.near?.[0]?.id), note.title === undefined ? {} : { title: note.title });

                if (nodeId !== null) {
                    focusedCanvas().getState().updateNode(nodeId, { body: note.text });

                    if (note.color !== undefined) {
                        focusedCanvas().getState().setNodeColor(nodeId, note.color);
                    }
                }

                return nodeId === null ? null : { id: nodeId };
            },
            createFile(path: string, options?: { near?: { id: string }[] }) {
                requiresPermission(extension, 'canvas.write');

                const nodeId = focusedCanvas().getState().addNode('file', besideNode(options?.near?.[0]?.id), { path });

                return nodeId === null ? null : { id: nodeId };
            },
            createBrowser(url: string, options?: { near?: { id: string }[] }) {
                requiresPermission(extension, 'canvas.write');

                const nodeId = focusedCanvas().getState().addNode('browser', besideNode(options?.near?.[0]?.id), { url });

                return nodeId === null ? null : { id: nodeId };
            },
            createNode(type: string, options?: { data?: unknown; title?: string }) {
                requiresPermission(extension, 'canvas.write');

                const contribution = useContributions.getState().extensionNodes.find((node) => node.id === `${id}/${type}`);

                if (contribution === undefined) {
                    throw new Error(`${extension.manifest.name} has no node ${type}`);
                }

                const nodeId = focusedCanvas()
                    .getState()
                    .addExtensionNode(id, type, options?.title ?? contribution.title, { width: 420, height: 300 }, options?.data ?? {});

                return nodeId === null ? null : { id: nodeId };
            },
            update(node: { id: string }, patch: { title?: string; x?: number; y?: number; width?: number; height?: number }) {
                requiresPermission(extension, 'canvas.write');
                const store = canvasOfNode(node.id)?.getState();
                const current = store?.nodes[node.id];

                if (store === undefined || current === undefined) {
                    return;
                }

                if (patch.title !== undefined) {
                    store.renameNode(node.id, patch.title);
                }

                store.resizeNode(node.id, { x: patch.x ?? current.x, y: patch.y ?? current.y, w: patch.width ?? current.w, h: patch.height ?? current.h });
            },
            writeNote(node: { id: string }, text: string) {
                requiresPermission(extension, 'canvas.write');
                canvasOfNode(node.id)?.getState().updateNode(node.id, { body: text });
            },
            arrange(nodes: { id: string }[], layout: 'row' | 'column' | 'grid') {
                requiresPermission(extension, 'canvas.write');

                const store = focusedCanvas().getState();
                const placed = nodes.flatMap((node) => {
                    const current = store.nodes[node.id];

                    return current === undefined ? [] : [current];
                });
                const first = placed[0];

                if (first === undefined) {
                    return;
                }

                const columns = layout === 'row' ? placed.length : layout === 'column' ? 1 : Math.ceil(Math.sqrt(placed.length));
                const width = Math.max(...placed.map((node) => node.w));
                const height = Math.max(...placed.map((node) => node.h));

                placed.forEach((node, index) => {
                    store.resizeNode(node.id, {
                        x: first.x + (index % columns) * (width + ARRANGE_GAP),
                        y: first.y + Math.floor(index / columns) * (height + ARRANGE_GAP),
                        w: node.w,
                        h: node.h
                    });
                });
            },
            // A person confirms, as anywhere a node goes away.
            async remove(nodes: { id: string }[]) {
                requiresPermission(extension, 'canvas.write');

                const asked = await askHost({ title: `Remove ${nodes.length} nodes?`, body: `${extension.manifest.name} asks to remove them.`, danger: true });

                if (asked === null) {
                    return false;
                }

                const store = focusedCanvas().getState();

                store.select(nodes.map((node) => node.id));
                store.deleteSelected();

                return true;
            },
            group(nodes: { id: string }[]) {
                requiresPermission(extension, 'canvas.write');

                const store = focusedCanvas().getState();

                store.select(nodes.map((node) => node.id));

                const groupId = store.groupSelection();

                return groupId === null ? null : { id: groupId };
            },
            link(from: { id: string }, to: { id: string }) {
                requiresPermission(extension, 'canvas.write');
                canvasOfNode(from.id)?.getState().addEdge(from.id, to.id);
            },
            unlink(from: { id: string }, to: { id: string }) {
                requiresPermission(extension, 'canvas.write');

                const store = canvasOfNode(from.id)?.getState();
                const edge = store?.edges.find((each) => (each.from === from.id && each.to === to.id) || (each.from === to.id && each.to === from.id));

                if (edge !== undefined) {
                    store?.removeEdge(edge.id);
                }
            },
            select(nodes: { id: string }[]) {
                focusedCanvas()
                    .getState()
                    .select(nodes.map((node) => node.id));
            },
            reveal(target: { id: string }) {
                revealNode(target.id);
            }
        }
    };
}
