import { useChats } from '@adecore/agents-react/state';
import { ErrorBoundary } from '@adecore/ui';
import * as format from '@adecore/ui/format';
import {
    extensionActionCall,
    extensionAgentStatus,
    extensionCallPermission,
    extensionChatOf,
    extensionErrorCodeOf,
    extensionProjectPath,
    isArgumentErrorCode,
    lazyComponentProblem,
    missingPermissionMessage,
    type ExtensionActionInput,
    type ExtensionActionName,
    type ExtensionActionOutput,
    type ExtensionDatabaseValue,
    type ExtensionErrorCode,
    type ExtensionManifest,
    type ExtensionResult,
    type NodeAccent,
    type RequestMap
} from '@ruimte/contracts';
import i18next from 'i18next';
import { icons, Package, type LucideIcon } from 'lucide-react';
import { createContext, createElement, lazy, Suspense, use, useContext, useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { databaseConnections } from '@/database/connections';
import { desktop } from '@/desktop/bridge';
import { runAction, trackRun, useActionRuns } from '@/extensions/action-runs';
import { assertShortcut } from '@/extensions/action-shortcuts';
import { onClientEvent, type ClientEvents } from '@/extensions/client-events';
import { sendDevLog } from '@/extensions/dev-log';
import { DevReport } from '@/extensions/DevReport';
import { ExtensionGlyph } from '@/extensions/ExtensionTile';
import { addFileIcons } from '@/extensions/file-icons';
import { settingKey, useExtensionStorage, writeExtensionStorage } from '@/extensions/host/extension-storage';
import { ExtensionChat } from '@/extensions/host/ExtensionChat';
import { askHost, openOverlay, type OpenOverlay } from '@/extensions/host/host-dialog-state';
import { useMachineStorage } from '@/extensions/host/machine-storage';
import { extensionRequest } from '@/extensions/machine-request';
import {
    contribute,
    useContributions,
    type ExtensionSurfaceProps,
    type SettingField,
    type SettingGroup,
    type SlotEntry,
    type SlotName
} from '@/extensions/registry';
import { baseContext, nodeInfoIn, useNodeSources, type NodeInfo } from '@/extensions/slots';
import { revealNode } from '@/project/views';
import { openFileLink } from '@/shell/panels/file-links';
import { canvasOfNode, focusedCanvas, useCanvas, useCanvasStore, type CanvasState } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { folderWatches, isUnderFolder } from '@/state/fs-watch';
import { currentEndpointId } from '@/state/keys';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { nodeStatus, nodeWaitAsk, useSessions } from '@/state/sessions';
import { useTheme as useUiTheme } from '@/state/theme';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { IS_STATION } from '@/station';
import { machineTransport, TransportError, type Transport } from '@/transport';
import { useFocusedMachine } from '@/transport/connections';
import { machineAnswers } from '@/transport/features';
import type * as PublicClient from '../../../../../packages/extension/client';

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
type ExtensionRefusal = Extract<ExtensionResult<never>, { ok: false }>;
type ServerClient<Server> = PublicClient.ServerClient<Server>;

/* `launches.start` for `launch.start`: each action of one area, by its verb. */
type MachineCalls<Name extends ExtensionActionName> = {
    [Action in Name as Action extends `${string}.${infer Verb}` ? Verb : never]: (
        input?: ExtensionActionInput<Action>
    ) => Promise<ExtensionResult<ExtensionActionOutput<Action>>>;
};
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
        const { t } = useTranslation('settings');
        const { transport } = useFocusedMachine();
        const frame = useRef<HTMLIFrameElement>(null);

        // The one way out of a frame: it asks, and this answers with what a client of this machine may do.
        useEffect(() => {
            const listen = (event: MessageEvent<{ ruimte?: number; method?: string; args?: unknown[] }>) => {
                if (event.source !== frame.current?.contentWindow || event.data.ruimte === undefined || event.data.method === undefined) {
                    return;
                }

                const { ruimte: callId, method, args = [] } = event.data;

                void extensionRequest(transport, 'extension.call', { id: extension.manifest.id, method, args })
                    .then(({ result }) => frame.current?.contentWindow?.postMessage({ ruimte: callId, result }, '*'))
                    .catch((e: unknown) => frame.current?.contentWindow?.postMessage({ ruimte: callId, error: String(e) }, '*'));
            };

            window.addEventListener('message', listen);

            return () => window.removeEventListener('message', listen);
        }, [transport]);

        if (IS_STATION) {
            return <p className="p-3 text-sm text-text-muted">{t('extensions.frameDesktopOnly')}</p>;
        }

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
        const { t } = useTranslation('shell');

        return (
            <ExtensionContext value={extension}>
                <NodeContext value={props.nodeId ?? null}>
                    <ErrorBoundary label={t('extensions.surfaceFailed', { name: extension.manifest.name })} resetKeys={[extension.base]} compact>
                        <DevReport id={extension.manifest.id} dev={extension.dev === true}>
                            <Suspense fallback={null}>{createElement(Body as ComponentType<object>, props)}</Suspense>
                        </DevReport>
                    </ErrorBoundary>
                </NodeContext>
            </ExtensionContext>
        );
    };
}

/*
 * A node whose data an older `dataVersion` stored, moved up by the extension's `migrate` before it draws, and saved
 * with the version it is now. A node from before any version counts as 1. Inside the surface, so a throw stays there.
 */
function migratedNode(load: LazyComponent, version: number, migrate: (stored: unknown, from: number) => unknown): LazyComponent {
    return async () => {
        const { default: Inner } = await load();

        // oxlint-disable-next-line react/only-export-components -- Made per extension, and never hot-reloaded.
        function MigratedNode(props: object) {
            const nodeId = useContext(NodeContext);
            const raw = useCanvas((state) => (nodeId === null ? undefined : state.nodes[nodeId]?.raw));
            const store = useCanvasStore();
            const from = typeof raw?.dataVersion === 'number' ? raw.dataVersion : 1;
            const stale = nodeId !== null && raw !== undefined && from < version;
            const data = stale ? migrate(raw.data, from) : undefined;

            useEffect(() => {
                if (stale) {
                    store.getState().updateExtensionNode(nodeId, { data, dataVersion: version });
                }
            }, [stale, store, nodeId, data]);

            return stale ? null : createElement(Inner, props);
        }

        return { default: MigratedNode };
    };
}

type PublicSlots = Partial<
    Record<SlotName, true | ((context: never) => boolean | { title?: string; icon?: string; disabled?: boolean | string; badge?: string; order?: number })>
>;

function assertLazy(surface: { component?: unknown; frame?: unknown }, what: string): void {
    const problem = lazyComponentProblem(surface, what);

    if (problem !== null) {
        throw new TypeError(problem);
    }
}

/* Where a new node goes: right of the one it is about, as a person would drag it. */
function besideNode(nodeId: string | undefined): { x: number; y: number } {
    const canvas = focusedCanvas().getState();
    const anchor = nodeId === undefined ? undefined : canvas.nodes[nodeId];

    return anchor === undefined ? { x: 0, y: 0 } : { x: anchor.x + anchor.w + 240, y: anchor.y + anchor.h / 2 };
}

/* Ends a call of the API with a Result of this code. Only the host throws it, and only the host catches it. */
class Refused extends Error {
    readonly code: ExtensionErrorCode;

    constructor(code: ExtensionErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/*
 * The machine and project a call began on, taken before its first await. Every later step goes over this one link,
 * never the facade that follows the window, and a step after an await is refused once the window shows another.
 */
interface CallScope {
    readonly endpointId: string;
    readonly link: Transport;
    readonly projectId: string | null;
}

function callScope(): CallScope {
    const endpointId = currentEndpointId();

    return { endpointId, link: machineTransport(endpointId), projectId: useProject.getState().current?.projectId ?? null };
}

// The transport, not the id, says which machine: a row that learns its daemon id keeps its transport under the new name.
function assertScope(scope: CallScope): void {
    if (machineTransport(currentEndpointId()) !== scope.link || (useProject.getState().current?.projectId ?? null) !== scope.projectId) {
        throw new Refused('unavailable', 'The window moved to another machine or project during this call');
    }
}

function currentProjectId(): string {
    const projectId = useProject.getState().current?.projectId;

    if (projectId === undefined) {
        throw new Refused('no-project', 'This needs an open project');
    }

    return projectId;
}

function projectFolder(): string {
    const folder = useProject.getState().current?.folder;

    if (folder === undefined) {
        throw new Refused('no-project', 'This needs a project with a folder');
    }

    return folder;
}

/* A file request stays inside the project folder, whatever an extension asks for. */
function inProject(path: string): string {
    const full = extensionProjectPath(projectFolder(), path);

    if (full === null) {
        throw new Refused('outside-project', `${path} is outside the project folder`);
    }

    return full;
}

/* The same for a read, where the machine also holds the real path, past any symlink, to the real project folder. */
function readInProject(path: string): { path: string; within: string } {
    return { path: inProject(path), within: projectFolder() };
}

/*
 * `within` is an optional field a machine from before it leaves out without a word, so a symlink would lead there out
 * of the project. It came in the release that brought the extension API, which is what says a machine holds to it.
 */
function assertBoundedFiles(link: Transport): void {
    if (!machineAnswers(link.connection, 'extension.call')) {
        throw new Refused('unavailable', 'This machine cannot keep a file request inside the project folder');
    }
}

/* The canvas a new node goes on. A view that is no canvas reads a blank store without a view, which saves nothing. */
function canvasInFront(): CanvasState {
    const canvas = focusedCanvas().getState();

    if (canvas.viewId === null) {
        throw new Refused('no-canvas', 'This needs a canvas in front');
    }

    return canvas;
}

function createdNode(nodeId: string | null): { id: string } {
    if (nodeId === null) {
        throw new Refused('no-canvas', 'This needs a canvas in front');
    }

    return { id: nodeId };
}

/*
 * What an agent reads of one node of the project in front, only when it is of this kind: each kind takes its own
 * permission, so a chat's id handed to `terminals.read` reads nothing. The machine skips another kind before it reads;
 * one from before `kind` reads it all the same, which the check here then drops.
 */
async function readNodeText(nodeId: string, kind: 'terminal' | 'chat'): Promise<string> {
    const { sources } = await extensionRequest(callScope().link, 'extension.contextRead', { projectId: currentProjectId(), nodeIds: [nodeId], kind });
    const source = sources[0];

    if (source?.kind !== kind) {
        throw new Refused('not-found', `No ${kind} ${nodeId} in this project`);
    }

    return source.text;
}

/* A chat as `server/` reads it, also one in a view of its own. A machine from before that request only reads one on a canvas. */
async function readChatText(chatId: string): Promise<string> {
    const { link } = callScope();

    if (!machineAnswers(link.connection, 'extension.chatRead')) {
        return readNodeText(chatId, 'chat');
    }

    return (await extensionRequest(link, 'extension.chatRead', { chatId })).text;
}

function nodeStore(node: { id: string }): CanvasState {
    const store = canvasOfNode(node.id)?.getState();

    if (store === undefined) {
        throw new Refused('not-found', `No node ${node.id} on a canvas of this window`);
    }

    return store;
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
const NEW_NODE_SIZE = { width: 420, height: 300 };

function hasPermission(extension: LoadedExtension, permission: string): boolean {
    return Object.hasOwn(extension.manifest.permissions ?? {}, permission);
}

/* A hook has no Result to answer, so a missing permission fails the surface that draws it. */
function hookPermission(extension: LoadedExtension, hook: 'useAgents' | 'useUsageLimits' | 'Chat'): void {
    const permission = extensionCallPermission(hook);

    if (permission !== null && !hasPermission(extension, permission)) {
        throw new Error(missingPermissionMessage(extension.manifest.name, permission));
    }
}

type Settle = <Value>(what: string, run: () => Promise<Value>) => Promise<ExtensionResult<Value>>;

interface KeptServer {
    methods: unknown;
    subscribe(listener: () => void): () => void;
    version(): number;
    stop(): void;
}

function callServer(
    extension: LoadedExtension,
    transport: Pick<Transport, 'request' | 'connection'>,
    settle: Settle,
    method: string,
    args: unknown[]
): Promise<ExtensionResult<unknown>> {
    return settle(`server ${method}`, () =>
        extensionRequest(transport, 'extension.call', { id: extension.manifest.id, method, args }).then(({ result }) => result)
    );
}

/*
 * The `.use()` of a server method suspends, so its answers are kept by what was asked. `reload` drops one, and the link
 * coming back drops them all, a failure too, so every surface that read one asks again.
 */
function serverClient(
    extension: LoadedExtension,
    transport: Pick<Transport, 'request' | 'connection' | 'status' | 'subscribeStatus'>,
    settle: Settle
): KeptServer {
    const cache = new Map<string, Promise<ExtensionResult<unknown>>>();
    const listeners = new Set<() => void>();
    let version = 0;
    const call = (method: string, args: unknown[]): Promise<ExtensionResult<unknown>> => callServer(extension, transport, settle, method, args);
    const dropped = (): void => {
        version += 1;

        for (const listener of listeners) {
            listener();
        }
    };
    let open = transport.status === 'open';
    const stop = transport.subscribeStatus((status) => {
        const reopened = status === 'open' && !open;

        open = status === 'open';

        if (reopened && cache.size > 0) {
            cache.clear();
            dropped();
        }
    });
    const methods = new Proxy(
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
                    },
                    reload(...args: unknown[]) {
                        if (cache.delete(JSON.stringify([method, args]))) {
                            dropped();
                        }
                    }
                });
            }
        }
    );

    return {
        methods,
        subscribe(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        version: () => version,
        stop
    };
}

/* `live` says whether the load this API belongs to is still in place; once it is not, what the extension adds is let go at once. */
export function clientApiFor(extension: LoadedExtension, live: () => boolean = () => true) {
    const { id } = extension.manifest;
    const servers = new WeakMap<object, KeptServer>();
    const reportFailure = (what: string) => (text: string) => {
        if (extension.dev === true) {
            sendDevLog(id, 'error', [`${what}: ${text}`]);
        }
    };
    /*
     * Why a call came back without its answer, under the code an extension reads. A refusal is no throw, so the terminal
     * of `extension dev` is where a person still sees it. An argument of the wrong shape is the one thing that throws.
     */
    // A value the extension stored that was not kept, which a person would otherwise only miss after a reload.
    const storageFailed = (text: string): void => {
        reportFailure('useStorage')(text);
        useToasts.getState().show({ kind: 'error', title: i18next.t('shell:extensions.storageFailed', { name: extension.manifest.name }), description: text });
    };
    const refusalOf = (what: string, e: unknown): ExtensionRefusal => {
        if (e instanceof TypeError) {
            throw e;
        }

        if (e instanceof TransportError && isArgumentErrorCode(e.code)) {
            throw new TypeError(`${what}: ${e.message}`);
        }

        const error =
            e instanceof Refused
                ? { code: e.code, message: e.message }
                : e instanceof TransportError
                  ? { code: extensionErrorCodeOf(e.code), message: e.message }
                  : { code: 'failed' as const, message: e instanceof Error ? e.message : String(e) };

        reportFailure(what)(`${error.code}: ${error.message}`);

        return { ok: false, error };
    };
    const permit = (permission: string): void => {
        if (!hasPermission(extension, permission)) {
            throw new Refused('permission-denied', missingPermissionMessage(extension.manifest.name, permission));
        }
    };
    // A call is named by its path in the API, which `EXTENSION_CLIENT_PERMISSIONS` gives the permission of, asked first.
    const permitCall = (what: string): void => {
        const permission = extensionCallPermission(what);

        if (permission !== null) {
            permit(permission);
        }
    };
    // A callback of a load that was taken down or replaced reads, writes and changes nothing any more.
    const withdrawn = (): Refused => new Refused('unavailable', `${extension.manifest.name} was turned off or replaced`);
    const assertLive = (): void => {
        if (!live()) {
            throw withdrawn();
        }
    };
    const whileLive =
        <Args extends unknown[]>(run: (...args: Args) => void) =>
        (...args: Args): void => {
            if (live()) {
                run(...args);
            }
        };
    const ask = (request: Parameters<typeof askHost>[0]): ReturnType<typeof askHost> => (live() ? askHost(request) : Promise.resolve(null));
    const attempt = <Value,>(what: string, run: () => Value): ExtensionResult<Value> => {
        try {
            assertLive();
            permitCall(what);

            return { ok: true, value: run() };
        } catch (e) {
            return refusalOf(what, e);
        }
    };
    const settle: Settle = async (what, run) => {
        try {
            assertLive();
            permitCall(what);

            const value = await run();

            // Its answer reaches no code of a load that went meanwhile.
            assertLive();

            return { ok: true, value };
        } catch (e) {
            return refusalOf(what, e);
        }
    };
    const machineActions = <Name extends ExtensionActionName>(names: readonly Name[]): MachineCalls<Name> =>
        Object.fromEntries(
            names.map((action) => [
                action.slice(action.indexOf('.') + 1),
                (input: object = {}) =>
                    // The machine checks the permission too; this one only saves the trip.
                    settle(extensionActionCall(action), async () => {
                        const { output } = await extensionRequest(callScope().link, 'extension.action', { id, projectId: currentProjectId(), action, input });

                        return output;
                    })
            ])
        ) as MachineCalls<Name>;
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
    const hold = (dispose: () => void): void => {
        if (live()) {
            extension.disposers.push(dispose);
        } else {
            dispose();
        }
    };
    const add = <Kind extends Parameters<typeof contribute>[0]>(kind: Kind, item: Parameters<typeof contribute<Kind>>[1]): (() => void) => {
        if (!live()) {
            return () => undefined;
        }

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
                open: whileLive((params?: Params) => {
                    usePanelParams.setState(({ params: all }) => ({ params: { ...all, [kind]: params } }));
                    useUi.getState().setPanel({ open: true, kind });
                }),
                close: whileLive(() => useUi.getState().setPanel({ open: false })),
                setBadge: whileLive((text: string | null) => {
                    badge = text;
                    relabel();
                }),
                setTitle: whileLive((next: string) => {
                    title = next;
                    relabel();
                })
            };
        },
        defineSidebarCard(card: { id: string; title: string; component: LazyComponent }) {
            assertLazy(card, `defineSidebarCard ${card.id}`);
            add('sidebarCards', { id: `${id}/${card.id}`, title: card.title, component: surfaceOf(extension, card) as ComponentType });
        },
        defineView<Params>(view: { id: string; title: string; icon?: string } & Surface<{ params: Params }>) {
            assertLazy(view, `defineView ${view.id}`);

            const open = whileLive((params?: Params) => {
                useDocument.getState().addExtensionView(view.title, id, view.id, params);
            });

            add('extensionViews', {
                id: `${id}/${view.id}`,
                title: view.title,
                icon: iconOf(view.icon, extension),
                component: surfaceOf(extension, view) as ComponentType<{ params: unknown }>,
                open: () => open()
            });
            add('commands', {
                id: `extension:${id}/view/${view.id}`,
                // Read when the palette builds its rows, which it does again after a language change.
                get title() {
                    return i18next.t('shell:extensions.newView', { name: view.title });
                },
                run: open
            });

            return { open };
        },
        defineNode<Data>(
            node: {
                id: string;
                title: string;
                icon?: string;
                size?: { width: number; height: number };
                initialData?: Data;
                dataVersion?: number;
                migrate?: (stored: PublicClient.Json, from: number) => Data;
                addFrom?: PublicSlots;
            } & Surface
        ) {
            assertLazy(node, `defineNode ${node.id}`);

            const { migrate, dataVersion } = node;
            const surface: Surface =
                'component' in node && migrate !== undefined && dataVersion !== undefined
                    ? { component: migratedNode(node.component, dataVersion, migrate as (stored: unknown, from: number) => unknown) }
                    : node;
            const size = node.size ?? NEW_NODE_SIZE;
            const initialData = node.initialData ?? {};

            add('extensionNodes', {
                id: `${id}/${node.id}`,
                title: node.title,
                icon: iconOf(node.icon, extension),
                component: surfaceOf(extension, surface) as ComponentType<ExtensionSurfaceProps>,
                size,
                initialData,
                ...(dataVersion === undefined ? {} : { dataVersion })
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
                        .addExtensionNode(id, node.id, node.title, size, initialData, node.dataVersion, (context as { at?: { x: number; y: number } }).at);
                }
            });
        },
        defineCanvasOverlay(overlay: { id: string; component: LazyComponent }) {
            assertLazy(overlay, `defineCanvasOverlay ${overlay.id}`);
            add('canvasLayers', { id: `${id}/${overlay.id}`, place: 'screen', component: surfaceOf(extension, overlay) as ComponentType<{ z: number }> });
        },
        defineFileViewer(viewer: {
            id: string;
            title: string;
            extensions: string[];
            component: LazyComponent<{ file: PublicClient.FileInfo & { text: string | null } }>;
        }) {
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

            hold(() => closers.forEach((close) => close()));

            return {
                open(params: Params): Promise<Result | null> {
                    if (!live()) {
                        return Promise.resolve(null);
                    }

                    const { result, close } = openOverlay({ title: overlay.title, size: overlay.size, component, params });

                    closers.add(close);

                    return result.finally(() => closers.delete(close)) as Promise<Result | null>;
                },
                close: () => closers.forEach((close) => close())
            };
        },
        defineToolResult(result: { id: string; tools: string[]; component: LazyComponent<{ call: PublicClient.ToolCall }> }) {
            assertLazy(result, `defineToolResult ${result.id}`);
            add('toolResults', {
                id: `${id}/${result.id}`,
                tools: result.tools,
                component: surfaceOf(extension, result) as ComponentType<{ call: { name: string; input: unknown; output: string | null; state: string } }>
            });
        },
        definePaletteSource(source: {
            id: string;
            title: string;
            search: (query: string) => Promise<readonly { id: string; title: string; detail?: string; run: () => void }[]>;
        }) {
            add('paletteSources', { id: `${id}/${source.id}`, title: source.title, search: source.search, onFailure: reportFailure(source.id) });
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
        defineDiffViewer(viewer: { id: string; title: string; extensions: string[]; component: LazyComponent<{ file: PublicClient.FileInfo; diff: string }> }) {
            assertLazy(viewer, `defineDiffViewer ${viewer.id}`);
            add('diffViewers', {
                id: `${id}/${viewer.id}`,
                title: viewer.title,
                extensions: viewer.extensions.map((name) => name.toLowerCase()),
                component: surfaceOf(extension, viewer) as ComponentType<{ file: { path: string; name: string; extension: string }; diff: string }>
            });
        },
        defineFileIcon(icon: { extensions: string[]; path: string }) {
            hold(addFileIcons(`${extension.base}${icon.path}`, icon.extensions));
        },
        defineVoiceAction<Input extends object>(action: {
            id: string;
            description: string;
            parameters?: object;
            run: (input: Input) => string | Promise<string>;
        }) {
            add('voiceActions', {
                id: `${id}/${action.id}`,
                description: action.description,
                parameters: action.parameters ?? { type: 'object', properties: {} },
                // Filled by the model after `parameters`, the shape the extension typed `Input` by.
                run: async (input) => action.run(input as Input)
            });
        },
        defineTemplate(template: {
            id: string;
            title: string;
            icon?: string;
            create: (context: PublicClient.BaseContext & { at: { x: number; y: number } }) => void | Promise<void>;
        }) {
            add('slotEntries', {
                id: `${id}/template/${template.id}`,
                kind: 'action',
                addsNode: true,
                title: template.title,
                ...(template.icon === undefined ? {} : { icon: iconOf(template.icon, extension) }),
                slots: { canvasMenu: true },
                // The canvas menu tells a template where it was opened.
                run: template.create as (context: object) => void | Promise<void>,
                onFailure: reportFailure(template.id)
            });
        },
        defineCommand(command: { id: string; title: string; run: () => void | Promise<void> }) {
            add('commands', { id: `extension:${id}/${command.id}`, title: command.title, run: command.run, onFailure: reportFailure(command.id) });
        },
        defineExtensionSettings(settings: { component: LazyComponent; keywords?: string[] } | { fields: SettingField[] } | { groups: SettingGroup[] }) {
            if ('fields' in settings || 'groups' in settings) {
                const groups = 'groups' in settings ? settings.groups : [{ fields: settings.fields }];

                add('extensionSchemas', { id, groups, fields: groups.flatMap((group) => group.fields) });

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
                run: (context?: object) => (live() ? runAction(entry, { ...baseContext(), ...context }, 'code') : Promise.resolve()),
                useRunning: () => useActionRuns((state) => state.runs.some((run) => run.actionId === entry.id))
            };
        },
        defineMenu<Place extends PublicClient.SlotName>(menu: {
            id: string;
            title: string;
            icon?: string;
            slots: PublicClient.Slots<Place>;
            items: PublicClient.MenuItem[] | ((context: PublicClient.ContextOf<Place>) => PublicClient.MenuItem[]);
        }) {
            add('slotEntries', {
                id: `${id}/${menu.id}`,
                kind: 'menu',
                title: menu.title,
                ...(menu.icon === undefined ? {} : { icon: iconOf(menu.icon, extension) }),
                slots: slotsOf(menu.slots as PublicSlots),
                // An item is a handle this host made, a separator or a plain row, whatever the slot.
                items: menu.items as SlotEntry['items'],
                onFailure: reportFailure(menu.id)
            });
        },
        defineWidget<Place extends PublicClient.SlotName>(widget: {
            id: string;
            slots: PublicClient.Slots<Place>;
            component: LazyComponent<{ context: PublicClient.ContextOf<Place> }>;
        }) {
            assertLazy(widget, `defineWidget ${widget.id}`);
            add('slotEntries', {
                id: `${id}/${widget.id}`,
                kind: 'widget',
                title: widget.id,
                slots: slotsOf(widget.slots as PublicSlots),
                component: surfaceOf(extension, widget) as ComponentType<{ context: object; nodeId?: string | undefined }>,
                onFailure: reportFailure(widget.id)
            });
        },
        useServer<Server>(): ServerClient<Server> {
            const extensionNow = useExtension();
            const { transport } = useFocusedMachine();
            // Kept per machine, or `.use()` would ask again on every render and never settle.
            let server = servers.get(transport);

            if (server === undefined) {
                const kept = serverClient(extensionNow, transport, settle);

                server = kept;
                servers.set(transport, kept);
                hold(kept.stop);
            }

            // Drawn again when a kept answer is dropped, so `.use()` asks once more.
            useSyncExternalStore(server.subscribe, server.version);

            return server.methods as ServerClient<Server>;
        },
        getServer<Server>(): PublicClient.ServerCalls<Server> {
            const methods = new Proxy(
                {},
                {
                    get(_target, method) {
                        if (typeof method !== 'string') {
                            return undefined;
                        }

                        // The machine in front when it is called, not when `getServer` was.
                        return (...args: unknown[]) => callServer(extension, callScope().link, settle, method, args);
                    }
                }
            );

            return methods as PublicClient.ServerCalls<Server>;
        },
        useServerEvent<Payload>(name: string, listener: (payload: Payload) => void) {
            const extensionNow = useExtension();
            const { transport } = useFocusedMachine();

            useEffect(
                () =>
                    transport.on('extension.message', (message) => {
                        if (message.id === extensionNow.manifest.id && message.name === name) {
                            // What `emit` was given in `server/`, which only the extension knows the shape of.
                            listener(message.payload as Payload);
                        }
                    }),
                [extensionNow, transport, name, listener]
            );
        },
        useUsageLimits() {
            hookPermission(useExtension(), 'useUsageLimits');

            const { transport } = useFocusedMachine();
            const [limits, setLimits] = useState<UsageLimitsResult | null>(null);

            useEffect(() => {
                let current = true;

                // Without a machine there are no limits to show until `usage.limitsChanged` brings some.
                void transport.request('usage.limits', {}).then(
                    (next) => {
                        if (current) {
                            setLimits(next);
                        }
                    },
                    () => undefined
                );

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

            return [data, whileLive((next: Data) => store.getState().updateExtensionNode(nodeId, { data: next }))];
        },
        useStorage<Value>(key: string, initial: Value, scope: 'computer' | 'project' | 'machine' = 'computer'): [Value, (next: Value) => void] {
            const extensionNow = useExtension();
            const full = `ruimte.extension.${extensionNow.manifest.id}.${key}`;
            const local = useExtensionStorage(full, initial);
            const { transport, endpointId } = useFocusedMachine();
            const projectId = useProject((state) => state.current?.projectId ?? '');
            const remoteKey = scope === 'computer' ? null : scope === 'project' ? `project:${projectId}:${key}` : key;
            const remote = useMachineStorage(transport, endpointId, extensionNow.manifest.id, remoteKey, initial, storageFailed);
            const writeLocal = (next: Value): void => {
                if (!writeExtensionStorage(full, next)) {
                    storageFailed(`storage ${key}: this computer refused to keep it`);
                }
            };

            return scope === 'computer' ? [local, whileLive(writeLocal)] : [remote[0], whileLive(remote[1])];
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
            const selection = useCanvas((state) => state.selection);
            const sources = useNodeSources();

            return selection.map((id) => nodeInfoIn(sources, id));
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
        Chat(props: { id: string }) {
            hookPermission(useExtension(), 'Chat');

            return <ExtensionChat {...props} />;
        },
        useChat(chatId: string) {
            const endpointId = useEndpointId();
            const info = useChats((state) => state.statusByKey[endpointKey(endpointId, chatId)]?.info);

            return info === undefined ? null : extensionChatOf(info);
        },
        useNode(nodeId: string) {
            return nodeInfoIn(useNodeSources(), nodeId);
        },
        useNodes(filter?: (node: NodeInfo) => boolean) {
            const sources = useNodeSources();
            const nodes = Object.keys(sources.canvas.nodes).map((id) => nodeInfoIn(sources, id));

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
                t: (key: string, values?: Record<string, string | number>) =>
                    Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), words[key] ?? key)
            };
        },
        useEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void) {
            useEffect(() => onClientEvent(name, listener), [name, listener]);
        },
        // Stopped with the extension too, or one turned off or built again keeps listening.
        onEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void): () => void {
            const stop = onClientEvent(name, (event) => {
                try {
                    listener(event);
                } catch (e) {
                    reportFailure(`onEvent ${name}`)(e instanceof Error ? e.message : String(e));

                    throw e;
                }
            });

            hold(stop);

            return stop;
        },
        useAgents() {
            hookPermission(useExtension(), 'useAgents');

            const nodes = useCanvas((state) => state.nodes);
            const sessions = useSessions((state) => state.byKey);
            const chats = useChats((state) => state.statusByKey);
            const endpointId = useEndpointId();

            return Object.values(nodes)
                .filter((node) => node.kind === 'chat' || node.kind === 'terminal')
                .map((node) => ({
                    id: node.id,
                    title: node.title,
                    status: extensionAgentStatus(nodeStatus(node, sessions, chats, endpointId), nodeWaitAsk(node, sessions, chats, endpointId) !== null)
                }));
        },
        host: {
            busy<Value>(work: { title: string; nodes?: { id: string }[] }, run: (signal: AbortSignal) => Value | Promise<Value>) {
                if (!live()) {
                    return Promise.reject(withdrawn());
                }

                return trackRun({ actionId: null, title: work.title, nodeIds: (work.nodes ?? []).map((node) => node.id) }, run);
            },
            notify: whileLive((text: string, options?: { tone?: 'neutral' | 'error'; action?: { title: string; run: () => void } }) => {
                useToasts.getState().show({
                    kind: options?.tone === 'error' ? 'error' : 'success',
                    title: text,
                    ...(options?.action === undefined ? {} : { action: { label: options.action.title, run: options.action.run } })
                });
            }),
            pickFolder: (initial?: string) => (live() ? (desktop()?.pickFolder?.(initial) ?? Promise.resolve(null)) : Promise.resolve(null)),
            openSettings: whileLive(() => {
                useUi.getState().setSettings({ open: true, section: 'extensions' });
            }),
            confirm: async ({ title, body, danger }: { title: string; body: string; danger?: boolean }) =>
                (await ask({ title, body, ...(danger === undefined ? {} : { danger }) })) !== null,
            prompt: ({ title, placeholder, initial }: { title: string; placeholder?: string; initial?: string }) =>
                ask({ title, field: { ...(placeholder === undefined ? {} : { placeholder }), ...(initial === undefined ? {} : { initial }) } }),
            async pick<Item>({ title, items, label }: { title: string; items: readonly Item[]; label: (item: Item) => string }) {
                const words = items.map(label);
                const answer = await ask({ title, choices: words });

                return answer === null ? null : (items[words.indexOf(answer)] ?? null);
            },
            openUrl: whileLive((url: string) => {
                window.open(url, '_blank', 'noopener');
            }),
            copy: whileLive((text: string) => {
                void navigator.clipboard.writeText(text);
            })
        },
        files: {
            readText: (path: string) =>
                settle('files.readText', async () => {
                    const { link } = callScope();
                    const read = readInProject(path);

                    assertBoundedFiles(link);

                    const answer = await link.request('fs.read', read);

                    if (answer.kind !== 'text') {
                        throw new Refused('refused', `${path} is not a text file`);
                    }

                    return answer.text;
                }),
            write: (path: string, text: string) =>
                settle('files.write', async () => {
                    const scope = callScope();
                    const full = inProject(path);
                    const within = projectFolder();

                    assertBoundedFiles(scope.link);

                    const existing = await scope.link.request('fs.read', { path: full, within }).catch(() => null);

                    // The path and mtime are of the first machine's file; written on another, they could overwrite a file there.
                    assertScope(scope);
                    assertLive();

                    if (existing?.kind !== 'text') {
                        await scope.link.request('fs.create', { path: full, kind: 'file', text, within });
                    } else {
                        await scope.link.request('fs.write', { path: full, text, expectedMtime: existing.mtime, within });
                    }
                }),
            list: (folder: string) =>
                settle('files.list', async () => {
                    const { link } = callScope();
                    const list = readInProject(folder);

                    assertBoundedFiles(link);

                    const { entries } = await link.request('fs.list', list);

                    return entries.map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind }));
                }),
            watch: (path: string, listener: () => void) =>
                attempt('files.watch', () => {
                    const scope = callScope();
                    const full = inProject(path);
                    // On the machine that holds the watch, so a path of the same name on another never wakes it.
                    const stopListening = scope.link.on('fs.changed', ({ root, changedPaths }) => {
                        // A watcher above it that could not name every change may have changed it too.
                        const unnamed = changedPaths === undefined && isUnderFolder(full, root);

                        if (root === full || unnamed || changedPaths?.some((changed) => changed === full || isUnderFolder(changed, full))) {
                            listener();
                        }
                    });
                    // Counted with every other reader of the folder, so letting go of it leaves the files panel's watch alone.
                    const held = folderWatches.watch(scope.endpointId, full, listener);
                    const stop = (): void => {
                        stopListening();
                        held.release();
                    };

                    hold(stop);

                    return stop;
                }),
            open: whileLive((path: string) => {
                void openFileLink(useProject.getState().current?.folder ?? null, { path, directory: false }, currentEndpointId());
            })
        },
        git: {
            status: (options?: { repository?: string }) =>
                settle('git.status', async () => {
                    const status = await callScope().link.request('git.status', { cwd: inProject(options?.repository ?? '.') });

                    return {
                        repository: status.repo,
                        root: status.root,
                        branch: status.branch,
                        upstream: status.upstream,
                        ahead: status.ahead,
                        behind: status.behind,
                        files: status.files.map((file) => ({
                            path: file.path,
                            state: file.state,
                            status: file.status,
                            added: file.added,
                            deleted: file.deleted,
                            binary: file.binary
                        })),
                        truncated: status.truncated
                    };
                }),
            diff: (options: { path: string; repository?: string; staged?: boolean }) =>
                settle('git.diff', async () => {
                    const diff = await callScope().link.request('git.diff', {
                        cwd: inProject(options.repository ?? '.'),
                        scope: 'worktree',
                        path: options.path,
                        ...(options.staged === undefined ? {} : { staged: options.staged })
                    });

                    return { path: diff.path, diff: diff.diff, added: diff.added, deleted: diff.deleted, binary: diff.binary, kind: diff.kind ?? null };
                }),
            log: (options?: { repository?: string; limit?: number }) =>
                settle('git.log', async () => {
                    const { commits } = await callScope().link.request('git.log', { cwd: inProject(options?.repository ?? '.'), limit: options?.limit ?? 30 });

                    // Git writes an author date in seconds; everything else an extension reads is in milliseconds.
                    return commits.map((commit) => ({
                        hash: commit.hash,
                        shortHash: commit.shortHash,
                        subject: commit.subject,
                        author: commit.author,
                        at: commit.at * 1000,
                        refs: commit.refs
                    }));
                })
        },
        launches: machineActions(['launch.list', 'launch.read', 'launch.start', 'launch.restart', 'launch.stop']),
        routines: machineActions(['routine.list', 'routine.run', 'routine.pause', 'routine.resume']),
        artifacts: machineActions(['artifact.list', 'artifact.read', 'artifact.publish']),
        browser: machineActions(['browser.inspect', 'browser.navigate', 'browser.back', 'browser.forward', 'browser.reload', 'browser.screenshot']),
        devices: machineActions(['device.list', 'device.inspect', 'device.screenshot', 'device.tap', 'device.launch']),
        terminals: {
            read: (terminal: { id: string }) =>
                settle('terminals.read', () => {
                    return readNodeText(terminal.id, 'terminal');
                }),
            // Opens a shell and types nothing: only a person types in a terminal.
            open: (options?: { title?: string; cwd?: string; near?: { id: string }[] }) =>
                attempt('terminals.open', () => {
                    return createdNode(
                        canvasInFront().addNode('terminal', besideNode(options?.near?.[0]?.id), {
                            ...(options?.title === undefined ? {} : { title: options.title }),
                            ...(options?.cwd === undefined ? {} : { cwd: options.cwd })
                        })
                    );
                })
        },
        database: {
            connections: () =>
                settle('database.connections', async () => {
                    return ((await databaseConnections.ready()) ?? []).map((connection: { id: string; name: string }) => ({
                        id: connection.id,
                        name: connection.name
                    }));
                }),
            query: (connection: string, sql: string) =>
                settle('database.query', async () => {
                    const { columns, rows, hasMore } = await extensionRequest(callScope().link, 'extension.databaseQuery', {
                        projectId: currentProjectId(),
                        connection,
                        sql
                    });

                    // The machine sends the cells as its databases read them; the wire only leaves them open for a newer kind.
                    return { columns, rows: rows as ExtensionDatabaseValue[][], hasMore };
                })
        },
        chats: {
            list: () =>
                settle('chats.list', async () => {
                    const { chats } = await callScope().link.request('chat.list', {});

                    return chats.filter((chat) => chat.hidden !== true).map(extensionChatOf);
                }),
            read: (chatId: string) =>
                settle('chats.read', () => {
                    return readChatText(chatId);
                }),
            send: (chatId: string, text: string) =>
                settle('chats.send', async () => {
                    await callScope().link.request('chat.send', { chatId, text });
                })
        },
        views: {
            open: whileLive((view: { id: string }) => {
                useDocument.getState().setActiveView(view.id);
            }),
            createCanvas: (name: string) =>
                attempt('views.createCanvas', () => {
                    currentProjectId();

                    return { id: useDocument.getState().addCanvasView(name) };
                }),
            rename: (view: { id: string }, name: string) =>
                attempt('views.rename', () => {
                    if (!useDocument.getState().views.some((each) => each.id === view.id)) {
                        throw new Refused('not-found', `No view ${view.id} in this project`);
                    }

                    useDocument.getState().renameView(view.id, name);
                })
        },
        context: {
            read: (of: { nodes?: { id: string }[]; view?: { id: string } }) =>
                settle('context.read', async () => {
                    const { sources } = await extensionRequest(callScope().link, 'extension.contextRead', {
                        projectId: currentProjectId(),
                        ...(of.nodes === undefined ? {} : { nodeIds: of.nodes.map((node) => node.id) }),
                        ...(of.view === undefined ? {} : { viewId: of.view.id })
                    });

                    return sources;
                })
        },
        agents: {
            run: (options: { prompt: string; context?: string[]; provider?: string }) =>
                settle('agents.run', async () => {
                    const { text } = await extensionRequest(callScope().link, 'extension.agentRun', {
                        prompt: [options.prompt, ...(options.context ?? [])].join('\n\n'),
                        ...(options.provider === undefined ? {} : { provider: options.provider }),
                        projectId: currentProjectId()
                    });

                    return { text };
                }),
            // Each piece is a Result, so a run that fails ends with its reason rather than a throw out of the loop.
            async *stream(options: {
                prompt: string;
                context?: string[];
                provider?: string;
                signal?: AbortSignal;
            }): AsyncGenerator<ExtensionResult<{ text: string }>> {
                const ready = attempt('agents.stream', () => {
                    return currentProjectId();
                });

                if (!ready.ok) {
                    yield ready;

                    return;
                }

                // Aborted before it began: no abort event comes any more, so the run would start and never be stopped.
                if (options.signal?.aborted === true) {
                    return;
                }

                // The run, its chunks and its stop stay on the machine it began on, whatever the window shows next.
                const { link } = callScope();
                const runId = crypto.randomUUID();
                const pieces: string[] = [];
                let wake = (): void => undefined;
                let done = false;
                const stop = link.on('extension.agentChunk', (chunk) => {
                    if (chunk.runId === runId) {
                        pieces.push(chunk.text);
                        wake();
                    }
                });
                const finished = settle('agents.stream', () =>
                    extensionRequest(link, 'extension.agentStream', {
                        runId,
                        prompt: [options.prompt, ...(options.context ?? [])].join('\n\n'),
                        ...(options.provider === undefined ? {} : { provider: options.provider }),
                        projectId: ready.value
                    })
                ).finally(() => {
                    done = true;
                    wake();
                });

                let stopped = false;
                const stopRun = (): void => void extensionRequest(link, 'extension.agentStop', { runId }).catch(() => undefined);
                // A run stopped says no more, also of a piece the machine sent before it heard so.
                const abort = (): void => {
                    stopped = true;
                    stopRun();
                    wake();
                };

                options.signal?.addEventListener('abort', abort);
                // A load taken down stops reading, and the run behind it stops with the loop.
                hold(() => wake());

                try {
                    while ((!done || pieces.length > 0) && live() && !stopped) {
                        const text = pieces.shift();

                        if (text !== undefined) {
                            yield { ok: true, value: { text } };
                        } else if (!done) {
                            await new Promise<void>((resolve) => {
                                wake = resolve;
                            });
                        }
                    }

                    if (!live() || stopped) {
                        return;
                    }

                    const outcome = await finished;

                    if (!outcome.ok) {
                        yield outcome;
                    }
                } finally {
                    stop();
                    options.signal?.removeEventListener('abort', abort);

                    // A loop that broke off leaves no one to read the rest, so the process stops with it.
                    if (!done && !stopped) {
                        stopRun();
                    }
                }
            },
            // A chat a person can see, follow and stop: on the canvas in front, or a view of its own with none there.
            start: (options: { prompt?: string; provider?: string; title?: string; near?: { id: string }[]; folder?: string; hidden?: boolean }) =>
                settle('agents.start', async () => {
                    const { views, activeViewId } = useDocument.getState();
                    // A chat in another project's folder is a view of that project, and one the extension draws stands on no canvas.
                    const onCanvas =
                        options.folder === undefined && options.hidden !== true && views.find((view) => view.id === activeViewId)?.kind === 'canvas';
                    const beside = options.near?.[0]?.id;
                    const { nodeId } = await extensionRequest(callScope().link, 'extension.agentStart', {
                        id,
                        projectId: currentProjectId(),
                        ...(onCanvas && activeViewId !== null ? { viewId: activeViewId } : {}),
                        ...(onCanvas && beside !== undefined ? { beside } : {}),
                        ...(options.provider === undefined ? {} : { provider: options.provider }),
                        ...(options.title === undefined ? {} : { title: options.title }),
                        ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
                        ...(options.folder === undefined ? {} : { folder: options.folder }),
                        ...(options.hidden === true ? { hidden: true } : {})
                    });

                    return { id: nodeId };
                })
        },
        canvas: {
            createNote: (note: { title?: string; text: string; near?: { id: string }[]; color?: NodeAccent }) =>
                attempt('canvas.createNote', () => {
                    const canvas = canvasInFront();
                    const created = createdNode(canvas.addNode('note', besideNode(note.near?.[0]?.id), note.title === undefined ? {} : { title: note.title }));

                    canvas.updateNode(created.id, { body: note.text });

                    if (note.color !== undefined) {
                        canvas.setNodeColor(created.id, note.color);
                    }

                    return created;
                }),
            createFile: (path: string, options?: { near?: { id: string }[] }) =>
                attempt('canvas.createFile', () => {
                    return createdNode(canvasInFront().addNode('file', besideNode(options?.near?.[0]?.id), { path }));
                }),
            createBrowser: (url: string, options?: { near?: { id: string }[] }) =>
                attempt('canvas.createBrowser', () => {
                    return createdNode(canvasInFront().addNode('browser', besideNode(options?.near?.[0]?.id), { url }));
                }),
            createNode: <Data,>(type: string, options?: { data?: Data; title?: string; near?: { id: string }[] }) => {
                const contribution = useContributions.getState().extensionNodes.find((node) => node.id === `${id}/${type}`);

                // A type the extension never defined is its own mistake, as a wrong argument is.
                if (contribution === undefined) {
                    throw new TypeError(`${extension.manifest.name} has no node ${type}`);
                }

                return attempt('canvas.createNode', () => {
                    return createdNode(
                        canvasInFront().addExtensionNode(
                            id,
                            type,
                            options?.title ?? contribution.title,
                            contribution.size,
                            options?.data ?? contribution.initialData,
                            contribution.dataVersion,
                            options?.near === undefined ? undefined : besideNode(options.near[0]?.id)
                        )
                    );
                });
            },
            update: (node: { id: string }, patch: { title?: string; x?: number; y?: number; width?: number; height?: number }) =>
                attempt('canvas.update', () => {
                    const store = nodeStore(node);
                    const current = store.nodes[node.id];

                    if (current === undefined) {
                        throw new Refused('not-found', `No node ${node.id} on a canvas of this window`);
                    }

                    // A node of an extension is kept as `unknown`, which `renameNode` leaves alone; its title lives in `raw`.
                    if (patch.title !== undefined && current.kind === 'unknown') {
                        store.updateExtensionNode(node.id, { title: patch.title });
                    } else if (patch.title !== undefined) {
                        store.renameNode(node.id, patch.title);
                    }

                    store.resizeNode(node.id, { x: patch.x ?? current.x, y: patch.y ?? current.y, w: patch.width ?? current.w, h: patch.height ?? current.h });
                }),
            writeNote: (node: { id: string }, text: string) =>
                attempt('canvas.writeNote', () => {
                    nodeStore(node).updateNode(node.id, { body: text });
                }),
            arrange: (nodes: { id: string }[], layout: 'row' | 'column' | 'grid') =>
                attempt('canvas.arrange', () => {
                    const store = canvasInFront();
                    const placed = nodes.flatMap((node) => {
                        const current = store.nodes[node.id];

                        return current === undefined ? [] : [current];
                    });
                    const first = placed[0];

                    if (first === undefined) {
                        throw new Refused('not-found', 'None of these nodes is on the canvas in front');
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
                }),
            // A person confirms, as anywhere a node goes away.
            remove: (nodes: { id: string }[]) =>
                settle('canvas.remove', async () => {
                    const store = canvasInFront();
                    const words = { count: nodes.length, extension: extension.manifest.name };
                    const asked = await askHost({
                        title: i18next.t('shell:extensions.removeNodes.title', words),
                        body: i18next.t('shell:extensions.removeNodes.body', words),
                        danger: true
                    });

                    // A person who said yes to a load that went meanwhile removes nothing for it.
                    assertLive();

                    if (asked === null) {
                        throw new Refused('refused', 'The person kept them');
                    }

                    store.select(nodes.map((node) => node.id));
                    store.deleteSelected();
                }),
            group: (nodes: { id: string }[]) =>
                attempt('canvas.group', () => {
                    const store = canvasInFront();

                    store.select(nodes.map((node) => node.id));

                    const groupId = store.groupSelection();

                    if (groupId === null) {
                        throw new Refused('refused', 'These nodes make no group on the canvas in front');
                    }

                    return { id: groupId };
                }),
            link: (from: { id: string }, to: { id: string }) =>
                attempt('canvas.link', () => {
                    nodeStore(from).addEdge(from.id, to.id);
                }),
            unlink: (from: { id: string }, to: { id: string }) =>
                attempt('canvas.unlink', () => {
                    const store = nodeStore(from);
                    const edge = store.edges.find((each) => (each.from === from.id && each.to === to.id) || (each.from === to.id && each.to === from.id));

                    if (edge !== undefined) {
                        store.removeEdge(edge.id);
                    }
                }),
            select: whileLive((nodes: { id: string }[]) => {
                focusedCanvas()
                    .getState()
                    .select(nodes.map((node) => node.id));
            }),
            reveal: whileLive((target: { id: string }) => {
                revealNode(target.id);
            })
        }
        // Held to the public types, so a change to one side breaks the check rather than an extension.
    } satisfies typeof PublicClient;
}
