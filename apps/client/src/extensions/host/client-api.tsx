import { createContext, createElement, lazy, Suspense, use, useContext, useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { icons, Package, type LucideIcon } from 'lucide-react';
import { z } from 'zod';
import { ErrorBoundary } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import type { ExtensionManifest, RequestMap } from '@ruimte/contracts';
import { revealNode } from '@/project/views';
import { ExtensionGlyph } from '@/extensions/ExtensionTile';
import { contribute, type ExtensionSurfaceProps } from '@/extensions/registry';
import { canvasOfNode, focusedCanvas, useCanvas, useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { nodeStatus, nodeWaitAsk, useSessions } from '@/state/sessions';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { storedJson, storedText } from '@/state/stored-json';
import { useFocusedMachine } from '@/transport/connections';
import { transport as activeTransport, type Transport } from '@/transport';

export interface LoadedExtension {
    manifest: ExtensionManifest;
    // Where its files are on the app's origin, ending in a slash.
    base: string;
    // Its `assets/icon.svg`, for a surface that names no Lucide icon of its own.
    iconUrl?: string | null;
    disposers: (() => void)[];
    settings: ComponentType | null;
}

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
                        <Suspense fallback={null}>{createElement(Body as ComponentType<object>, props)}</Suspense>
                    </ErrorBoundary>
                </NodeContext>
            </ExtensionContext>
        );
    };
}

function assertLazy(surface: { component?: unknown; frame?: unknown }, what: string): void {
    if (
        surface.frame === undefined &&
        (typeof surface.component !== 'function' || surface.component.length !== 0 || /^(class|function [A-Z])/.test(String(surface.component)))
    ) {
        throw new TypeError(`${what}: component must be a lazy import, such as () => import('./Panel')`);
    }
}

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
    const add = <Kind extends Parameters<typeof contribute>[0]>(kind: Kind, item: Parameters<typeof contribute<Kind>>[1]): (() => void) => {
        const dispose = contribute(kind, item);

        extension.disposers.push(dispose);

        return dispose;
    };
    const handleFor = (kind: `extension:${string}`) => ({
        open: () => useUi.getState().setPanel({ open: true, kind }),
        close: () => useUi.getState().setPanel({ open: false }),
        setBadge: () => undefined
    });

    return {
        definePanel(panel: { id: string; title: string; icon?: string; minWidth?: number } & Surface) {
            assertLazy(panel, `definePanel ${panel.id}`);

            const kind = `extension:${id}/${panel.id}` as const;

            add('panels', {
                kind,
                icon: iconOf(panel.icon, extension),
                minWidth: panel.minWidth ?? 280,
                toolbar: true,
                group: 'extensions',
                label: () => panel.title,
                component: surfaceOf(extension, panel) as ComponentType
            });

            return handleFor(kind);
        },
        defineSidebarCard(card: { id: string; title: string; component: LazyComponent }) {
            assertLazy(card, `defineSidebarCard ${card.id}`);
            add('sidebarCards', { id: `${id}/${card.id}`, title: card.title, component: surfaceOf(extension, card) as ComponentType });

            return { open: () => undefined, close: () => undefined, setBadge: () => undefined };
        },
        defineView(view: { id: string; title: string; icon?: string } & Surface<{ params: unknown }>) {
            assertLazy(view, `defineView ${view.id}`);

            const open = (params?: unknown) => {
                useDocument.getState().addExtensionView(view.title, id, view.id, params);
            };

            add('extensionViews', { id: `${id}/${view.id}`, title: view.title, component: surfaceOf(extension, view) as ComponentType<{ params: unknown }> });
            add('commands', { id: `extension:${id}/view/${view.id}`, title: `New ${view.title}`, run: open });

            return { open, close: () => undefined, setBadge: () => undefined };
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
                plate?: string;
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
            add('commands', {
                id: `extension:${id}/node/${node.id}`,
                title: `Add ${node.title}`,
                run: () => {
                    focusedCanvas()
                        .getState()
                        .addExtensionNode(id, node.id, node.title, node.size ?? { width: 420, height: 300 }, node.initialData ?? {}, node.dataVersion);
                }
            });
        },
        defineCanvasOverlay(overlay: { id: string; component: LazyComponent }) {
            assertLazy(overlay, `defineCanvasOverlay ${overlay.id}`);
            add('canvasLayers', { id: `${id}/${overlay.id}`, place: 'screen', component: surfaceOf(extension, overlay) as ComponentType<{ z: number }> });
        },
        defineCommand(command: { id: string; title: string; run: () => void | Promise<void> }) {
            add('commands', { id: `extension:${id}/${command.id}`, title: command.title, run: command.run });
        },
        defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] }) {
            assertLazy(settings, `defineExtensionSettings ${id}`);
            add('extensionSettings', { id, component: surfaceOf(extension, settings) as ComponentType, keywords: settings.keywords ?? [] });
        },
        defineNodeMenuItem(action: {
            id: string;
            title: string;
            run: (target: { node: { id: string } }) => void;
            when?: (target: { node: { id: string } }) => boolean;
        }) {
            add('nodeMenuItems', {
                id: `${id}/${action.id}`,
                title: action.title,
                run: (nodeId) => action.run({ node: { id: nodeId } }),
                when: (nodeId) => action.when?.({ node: { id: nodeId } }) ?? true
            });
        },
        defineCanvasAction(action: {
            id: string;
            title: string;
            icon?: string;
            run: (target: { selection: { id: string }[] }) => void | Promise<void>;
            when?: (target: { selection: { id: string }[] }) => boolean;
        }) {
            const refs = (ids: readonly string[]) => ({ selection: ids.map((nodeId) => ({ id: nodeId })) });

            add('canvasActions', {
                id: `${id}/${action.id}`,
                title: action.title,
                ...(action.icon === undefined ? {} : { icon: iconOf(action.icon, extension) }),
                when: (ids) => action.when?.(refs(ids)) ?? true,
                run: (ids) => action.run(refs(ids))
            });

            const selection = () =>
                focusedCanvas()
                    .getState()
                    .selection.map((nodeId) => ({ id: nodeId }));

            add('commands', {
                id: `extension:${id}/selection/${action.id}`,
                title: action.title,
                when: () => action.when?.({ selection: selection() }) ?? true,
                run: () => action.run({ selection: selection() })
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
        useStorage<Value>(key: string, initial: Value): [Value, (next: Value) => void] {
            const extensionNow = useExtension();
            const full = `ruimte.extension.${extensionNow.manifest.id}.${key}`;
            const value = useExtensionStorage(full, initial);

            return [value, (next) => writeExtensionStorage(full, next)];
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
            return useCanvas((state) => state.selection).map((nodeId) => ({ id: nodeId }));
        },
        useCanvasNodes() {
            const nodes = useCanvas((state) => state.nodes);

            return Object.values(nodes).map((node) => ({
                id: node.id,
                kind: node.kind,
                title: node.title,
                x: node.x,
                y: node.y,
                width: node.w,
                height: node.h
            }));
        },
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
            notify(text: string, options?: { tone?: 'neutral' | 'error' }) {
                useToasts.getState().show({ kind: options?.tone === 'error' ? 'error' : 'success', title: text });
            },
            confirm: async ({ title, body }: { title: string; body: string }) => window.confirm(`${title}\n\n${body}`),
            openUrl(url: string) {
                window.open(url, '_blank', 'noopener');
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
            }
        },
        canvas: {
            createNote(note: { title?: string; text: string; near?: { id: string }[] }) {
                requiresPermission(extension, 'canvas.write');

                const canvas = focusedCanvas().getState();
                const anchor = note.near?.[0] === undefined ? undefined : canvas.nodes[note.near[0].id];
                const at = anchor === undefined ? { x: 0, y: 0 } : { x: anchor.x + anchor.w + 240, y: anchor.y + anchor.h / 2 };
                const nodeId = canvas.addNode('note', at, note.title === undefined ? {} : { title: note.title });

                if (nodeId !== null) {
                    focusedCanvas().getState().updateNode(nodeId, { body: note.text });
                }

                return nodeId === null ? null : { id: nodeId };
            },
            link(from: { id: string }, to: { id: string }) {
                requiresPermission(extension, 'canvas.write');
                canvasOfNode(from.id)?.getState().addEdge(from.id, to.id);
            },
            reveal(target: { id: string }) {
                revealNode(target.id);
            }
        }
    };
}

const storageListeners = new Set<() => void>();

function writeExtensionStorage(key: string, value: unknown): void {
    storedJson(key, z.unknown()).write(value);

    for (const listener of storageListeners) {
        listener();
    }
}

function subscribeStorage(listener: () => void): () => void {
    storageListeners.add(listener);

    return () => {
        storageListeners.delete(listener);
    };
}

function useExtensionStorage<Value>(key: string, initial: Value): Value {
    const stored = useSyncExternalStore(subscribeStorage, () => storedText(key).read());

    return stored === null ? initial : (JSON.parse(stored) as Value);
}
