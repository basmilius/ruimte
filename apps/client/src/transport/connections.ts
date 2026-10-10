import { notifyRequested } from '@/shell/notifications';
import i18next from 'i18next';
import type { ProjectSummary } from '@ruimte/contracts';
import { ChatClient } from '@adecore/agents-react/chat/chat-client';
import { BrowserClient } from '@/browser/browser-client';
import { claimWindow } from '@/desktop/window-claim';
import { DeviceClient } from '@/devices/device-client';
import { chatPreferencesPayload, useChatPreferences } from '@adecore/agents-react/chat/preferences';
import { DiagramClient } from '@/diagram/diagram-client';
import { DrawingClient } from '@/drawing/drawing-client';
import { foldList } from '@/project/list';
import { panelsPort } from '@/project/panels-port';
import { ProjectClient, type ProjectSink } from '@/project/project-client';
import { useChats } from '@adecore/agents-react/state/chats';
import { chatSinkFor } from '@/state/chats';
import { activeEndpoint, endpointById, useEndpoints, type Endpoint } from '@/state/endpoints';
import { isOfEndpoint } from '@/state/keys';
import { isRealMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { PlanSync } from '@/state/plans';
import { watchPushAttention } from '@/state/push-attention';
import { watchSnoozes } from '@/state/snooze';
import { knownAccounts, providerAccountsOf, useProviderAccountsStore, watchProviderAccounts } from '@adecore/agents-react/state/provider-accounts';
import { providerSinkFor } from '@adecore/agents-react/state/providers';
import { sessionSinkFor, useSessions } from '@/state/sessions';
import { defaultWorkspaceStores } from '@/state/workspace';
import { workspaceOf, useWindow, windowWorkspace } from '@/state/window';
import { forgetProjectSessions } from '@/terminal/lifecycle';
import { SessionClient } from '@/terminal/session-client';
import { machineTransport, pool } from '@/transport';
import { useOptionalConnection } from '@/transport/context';
import type { Transport } from '@/transport/transport';
import { LinkHold } from '@/transport/workspace-hold';

/*
 * One daemon, as everything inside a workspace sees it. The address and the credential are
 * deliberately not in here. They live on the endpoint row and rotate per connection, and a copy taken
 * when a workspace was built would keep making URLs with a ticket that lapsed since.
 */
export interface Connection {
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
    browsers: BrowserClient;
    devices: DeviceClient;
    projects: ProjectClient;
    drawings: DrawingClient;
    diagrams: DiagramClient;
}

/* The clients of one daemon that write state keyed on that daemon, so several may be alive at once. */
export interface Machine {
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
    browsers: BrowserClient;
    devices: DeviceClient;
    dispose(): void;
}

/*
 * The project a window has open, on the machine it came from. It is built when a project opens and
 * thrown away when it closes or another one takes its place, so it never exists without a project.
 * The stores are the window's own (`defaultWorkspaceStores`); a workspace only brings the clients.
 */
export interface Workspace {
    /* Replaced rather than patched when the row learns its daemon's id, so React sees the move. */
    connection: Connection;
}

/* What one payload of `project.open` asks for: a project by id, a folder, or a new project by name. */
export type OpenRequest = { projectId: string } | { folder: string; createFolder: boolean };

const stores = defaultWorkspaceStores;
const machines = new Map<string, Machine>();
/* The hold each workspace connection keeps on its machine's link for as long as it lives. */
const connectionHolds = new WeakMap<Connection, LinkHold>();
/* Connections whose clients are gone; the window may still show one while a switch replaces it. */
const disposed = new WeakSet<Connection>();

/* The store as a project client sees it. Every write names the endpoint it came from. */
function projectSink(endpointId: () => string): ProjectSink {
    const actions = stores.project.getState();
    return {
        setProjects: (projects) => foldList(endpointId(), projects),
        patchProject: (summary) => useProjectList.getState().patchProject(endpointId(), summary),
        setCurrent: (current, rev) => actions.setCurrent(current, rev, endpointId()),
        setRev: actions.setRev,
        setChosenIcon: actions.setChosenIcon,
        setSummary: actions.setSummary,
        setDirty: actions.setDirty,
        setConflict: actions.setConflict,
        setError: actions.setError,
        setSwitching: actions.setSwitching,
        getState: () => stores.project.getState()
    };
}

function preferencesFor(endpointId: string): ReturnType<typeof chatPreferencesPayload> {
    return chatPreferencesPayload(useChatPreferences.getState(), endpointId, knownAccounts(providerAccountsOf(endpointId)));
}

function buildMachine(endpoint: Endpoint): Machine {
    const transport = machineTransport(endpoint.id);
    const stopNotifications = transport.on('push.notification', (alert) => notifyRequested(endpoint.id, alert));
    const stopPushAttention = watchPushAttention(endpoint.id, transport);
    const stopSnoozes = watchSnoozes(endpoint.id, transport);
    const stopAccounts = watchProviderAccounts(endpoint.id, transport);
    const plans = new PlanSync(endpoint.id, transport);
    const sessions = new SessionClient(transport, sessionSinkFor(endpoint.id));
    const chats = new ChatClient(transport, chatSinkFor(endpoint.id), providerSinkFor(endpoint.id));
    const browsers = new BrowserClient(endpoint.id, transport);
    const devices = new DeviceClient(endpoint.id, transport);
    chats.setPreferences(preferencesFor(endpoint.id));
    return {
        endpointId: endpoint.id,
        transport,
        sessions,
        chats,
        browsers,
        devices,
        dispose(): void {
            stopNotifications();
            stopPushAttention();
            stopSnoozes();
            stopAccounts();
            plans.dispose();
            sessions.dispose();
            chats.dispose();
            browsers.dispose();
            devices.dispose();
        }
    };
}

/* One machine's clients, kept until the machine is forgotten; they follow its link as it opens and closes. */
function machineOn(endpoint: Endpoint): Machine {
    const existing = machines.get(endpoint.id);
    if (existing) {
        return existing;
    }
    const machine = buildMachine(endpoint);
    machines.set(machine.endpointId, machine);
    return machine;
}

/*
 * The sessions and the threads of one daemon, on that daemon's own socket. Every row they write
 * names their machine (`state/keys.ts`), so a second machine's clients paint nothing of this one's.
 * Null for a machine this client no longer knows. A request meant for a daemon that was forgotten
 * must not land on whichever machine happens to be active.
 */
export function machineFor(endpointId: string): Machine | null {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) {
        dropMachine(endpointId);
        return null;
    }
    return machineOn(endpoint);
}

/* The active machine always has a row in the endpoint list, so it always has clients. */
function activeMachine(): Machine {
    return machineFor(activeEndpoint().id)!;
}

/*
 * The clients of one workspace, on the socket of the machine its project comes from, holding that
 * machine's link until they are disposed. The drawing client is built first, so the project client
 * can hand it the moment before the project is left and the drawing on screen reaches its own file.
 * `onLoad` runs in the tick the project reaches the stores.
 */
function connect(endpoint: Endpoint, onLoad: (connection: Connection, summary: ProjectSummary) => void): Connection {
    const transport = machineOn(endpoint).transport;
    /* Asked again on every save. A row that learns its daemon's id renames the connection under the same clients. */
    const endpointId = (): string => connection.endpointId;
    // Asked for rather than held: the machine's clients go when its row is forgotten, while this connection stays.
    const machine = (): Machine => machineOn(endpointById(connection.endpointId) ?? endpoint);
    const drawings = new DrawingClient(transport, stores.drawings, stores.document, stores.project, {
        flushProject: (): Promise<void> => projects.flush()
    });
    const diagrams = new DiagramClient(transport, stores.diagrams, stores.document, stores.project, {
        flushProject: (): Promise<void> => projects.flush()
    });
    const projects = new ProjectClient(transport, stores.canvases, stores.document, panelsPort, projectSink(endpointId), {
        drawings: stores.drawings,
        diagrams: stores.diagrams,
        beforeLeave: async (): Promise<void> => {
            await Promise.all([drawings.flush(), diagrams.flush()]);
        },
        forgetSessions: forgetProjectSessions,
        afterResume: async (): Promise<void> => {
            await Promise.all([drawings.resume(), diagrams.resume()]);
        },
        onLoad: (summary) => {
            // The last project on this machine took its rows with it, and the socket stayed open, so nothing asks again by itself.
            void connection.sessions.loadStatuses();
            void connection.chats.loadStatuses();
            onLoad(connection, summary);
        },
        endpointId
    });
    const connection: Connection = {
        endpointId: endpoint.id,
        transport,
        get sessions(): SessionClient {
            return machine().sessions;
        },
        get chats(): ChatClient {
            return machine().chats;
        },
        get browsers(): BrowserClient {
            return machine().browsers;
        },
        get devices(): DeviceClient {
            return machine().devices;
        },
        projects,
        drawings,
        diagrams
    };
    const hold = new LinkHold((row) => pool.hold(row));
    hold.set(endpoint);
    connectionHolds.set(connection, hold);
    return connection;
}

/*
 * Lets go of a connection's clients and its hold on the machine's link, which over a broker is a
 * WebRTC channel on both ends. False when that already happened.
 */
function dropClients(connection: Connection): boolean {
    if (disposed.has(connection)) {
        return false;
    }
    disposed.add(connection);
    connectionHolds.get(connection)?.set(null);
    connectionHolds.delete(connection);
    connection.projects.dispose();
    connection.drawings.dispose();
    connection.diagrams.dispose();
    return true;
}

/*
 * Lets go of everything a connection built. The rows of that machine's sessions and chats go too;
 * they are about the nodes of the project that left, and the next one attaches its own.
 */
function disposeConnection(connection: Connection): void {
    if (!dropClients(connection)) {
        return;
    }
    useSessions.getState().clear(connection.endpointId);
    useChats.getState().forgetWhere((key) => isOfEndpoint(key, connection.endpointId));
}

interface ProjectOn {
    endpointId: string;
    projectId: string;
}

/* The project the stores hold, by the machine it is on. */
function projectInStores(): ProjectOn | null {
    const { current, currentEndpointId } = stores.project.getState();
    return current && currentEndpointId ? { endpointId: currentEndpointId, projectId: current.projectId } : null;
}

/* The daemon lets go of a project this window will not show, unless it is the very project `kept` names. */
function releaseUnless(connection: Connection, projectId: string, kept: ProjectOn | null): void {
    if (kept?.endpointId === connection.endpointId && kept.projectId === projectId) {
        return;
    }
    void connection.transport.request('project.release', { projectId }).catch(() => undefined);
}

/* Thrown out of an open that a later one overtook, before the stores take its project. */
class Overtaken extends Error {}

/* How many opens this window started, and which of them is on screen. */
let opens = 0;
let shownOpen = 0;

/*
 * Opens a project in a new workspace and puts it on screen. The window moves in the same tick the
 * project reaches the stores, so nothing is drawn with the old connection over the new project. A
 * project that does not open leaves the window as it was and takes its clients with it. Of two opens
 * on their way at once, the later one ends up on screen whichever machine answers first.
 */
export async function enterWorkspace(endpointId: string, request: OpenRequest): Promise<void> {
    const endpoint = endpointById(endpointId);
    if (!endpoint || !isRealMachine(endpointId)) {
        throw new Error(i18next.t('machines:link.notInList'));
    }
    opens += 1;
    const ticket = opens;
    const connection = connect(endpoint, (opened, summary) => {
        if (ticket < shownOpen) {
            releaseUnless(opened, summary.projectId, projectInStores());
            throw new Overtaken();
        }
        // An earlier open that this one overtook answered first and took the window. Nothing of it is
        // written, since the stores are about to take this project.
        const shown = windowWorkspace()?.connection;
        if (shown && shown !== opened && !disposed.has(shown)) {
            const left = projectInStores();
            if (left) {
                releaseUnless(shown, left.projectId, { endpointId: opened.endpointId, projectId: summary.projectId });
            }
            disposeConnection(shown);
        }
        shownOpen = ticket;
        useEndpoints.getState().setActive(opened.endpointId);
        useWindow.getState().show({ kind: 'workspace', workspace: { connection: opened } });
    });
    try {
        if ('projectId' in request) {
            await connection.projects.openProject(request.projectId);
        } else {
            await connection.projects.openFolder(request.folder, request.createFolder);
        }
    } catch (e) {
        // The window shows the open that overtook this one, and the rows of a shared machine are its rows too.
        if (e instanceof Overtaken) {
            dropClients(connection);
            return;
        }
        if (windowWorkspace()?.connection !== connection) {
            disposeConnection(connection);
        }
        throw e;
    }
}

/*
 * Lets go of the open project for another one. The window keeps showing it until the next project
 * is in, and the stores keep what they hold, but nothing saves any more. The project client wrote
 * what was pending and the daemon was told the project is released.
 */
export async function leaveWorkspace(): Promise<void> {
    const workspace = windowWorkspace();
    if (!workspace || disposed.has(workspace.connection)) {
        return;
    }
    await workspace.connection.projects.leave();
    // Nothing is open under the views on screen now; a drawing client built for the next project must not open theirs.
    stores.project.getState().setSwitching(true);
    disposeConnection(workspace.connection);
}

/* The start screen, with nothing of the workspace left: no clients, no hold, empty stores, and no project this window keeps from another. */
export function showStart(): void {
    const workspace = windowWorkspace();
    if (workspace) {
        disposeConnection(workspace.connection);
    }
    stores.document.getState().load(null, null);
    panelsPort.load(null, undefined);
    stores.project.getState().setCurrent(null, 0, null);
    stores.project.getState().setSwitching(false);
    useWindow.getState().show({ kind: 'start' });
    void claimWindow(null);
}

/* The workspace on screen as React reads it, and null on the start screen. */
export function useWorkspace(): Workspace | null {
    return useWindow((s) => workspaceOf(s.content));
}

/*
 * The machine a surface outside the workspace works on: the palette, a global dialog. Inside a
 * workspace it is that workspace's; on the start screen it is the active machine.
 */
export function useFocusedMachine(): { endpointId: string; transport: Transport } {
    const inside = useOptionalConnection();
    const workspace = useWorkspace();
    const activeId = useEndpoints((s) => s.activeId);
    const connection = inside ?? workspace?.connection ?? null;
    return connection ?? { endpointId: activeId, transport: machineTransport(activeId) };
}

/* A stand-in that looks the client up on every property, so a call site holds on to nothing a switch replaced. */
function forwarding<T extends object>(pick: () => T): T {
    return new Proxy({} as T, {
        get(_target, property) {
            const client = pick();
            const value = Reflect.get(client, property) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
        }
    });
}

/* One of the workspace's clients. Only a surface of the workspace may call one; the start screen has nothing to act on. */
function workspaceClient<T extends object>(pick: (connection: Connection) => T): T {
    return forwarding(() => {
        const workspace = windowWorkspace();
        if (!workspace) {
            throw new Error('This acts on the open project, and the window shows the start screen');
        }
        return pick(workspace.connection);
    });
}

export const sessionClient = forwarding(() => activeMachine().sessions);
export const chatClient = forwarding(() => activeMachine().chats);
export const projectClient = workspaceClient((connection) => connection.projects);
export const drawingClient = workspaceClient((connection) => connection.drawings);
export const diagramClient = workspaceClient((connection) => connection.diagrams);

/* The session client of one machine, for a node that names the daemon it runs on. */
export function sessionClientFor(endpointId: string): SessionClient | null {
    return machineFor(endpointId)?.sessions ?? null;
}

export function chatClientFor(endpointId: string): ChatClient | null {
    return machineFor(endpointId)?.chats ?? null;
}

export function browserClientFor(endpointId: string): BrowserClient | null {
    return machineFor(endpointId)?.browsers ?? null;
}

export function deviceClientFor(endpointId: string): DeviceClient | null {
    return machineFor(endpointId)?.devices ?? null;
}

/* A machine this client no longer knows under that id (forgotten, or a row that moved onto its daemon id) keeps no clients. */
function prune(): void {
    const known = new Set(useEndpoints.getState().endpoints.map((endpoint) => endpoint.id));
    for (const [endpointId, machine] of [...machines]) {
        if (!known.has(endpointId)) {
            machines.delete(endpointId);
            machine.dispose();
        }
    }
}

/* Everything one machine held, for a row that is forgotten or a session that was revoked. */
export function dropMachine(endpointId: string): void {
    const machine = machines.get(endpointId);
    machines.delete(endpointId);
    machine?.dispose();
}

/*
 * A row that learned the id of its daemon is the same machine under another name. The transport and
 * the link stayed put, so the workspace keeps its clients and only its name for the machine moves.
 */
function followRekey(): void {
    const workspace = windowWorkspace();
    if (!workspace || endpointById(workspace.connection.endpointId)) {
        return;
    }
    const { connection } = workspace;
    const activeId = useEndpoints.getState().activeId;
    if (machineTransport(activeId) !== connection.transport) {
        return;
    }
    // The clients ask the old object for its name, so it moves first; the copy keeps its getters and is what React sees change.
    connection.endpointId = activeId;
    const renamed = Object.create(Object.getPrototypeOf(connection) as object, Object.getOwnPropertyDescriptors(connection)) as Connection;
    const hold = connectionHolds.get(connection);
    if (hold) {
        connectionHolds.delete(connection);
        connectionHolds.set(renamed, hold);
    }
    stores.project.setState({ currentEndpointId: activeId });
    useWindow.getState().show({ kind: 'workspace', workspace: { connection: renamed } });
    // The shell knows the project by the machine's name for it, which just moved.
    const projectId = stores.project.getState().current?.projectId;
    if (projectId) {
        void claimWindow({ endpointId: activeId, projectId });
    }
}

/* The active machine's clients exist from the first frame. The attention, the plans and the sessions of that machine hang on them. */
export function startConnections(): () => void {
    activeMachine();
    const offEndpoints = useEndpoints.subscribe((state, before) => {
        if (state.endpoints !== before.endpoints) {
            followRekey();
            prune();
        }
        if (state.activeId !== before.activeId) {
            activeMachine();
        }
    });
    const tellPreferences = (machine: Machine): void => machine.chats.setPreferences(preferencesFor(machine.endpointId));
    const offChatPreferences = useChatPreferences.subscribe((state, before) => {
        if (state.changedAt !== before.changedAt) {
            machines.forEach(tellPreferences);
        }
    });
    // An account for new agents that a machine turned off or removed is left out of what that machine is told.
    const offAccounts = useProviderAccountsStore.subscribe((state, before) => {
        for (const machine of machines.values()) {
            if (state.byScope[machine.endpointId] !== before.byScope[machine.endpointId]) {
                tellPreferences(machine);
            }
        }
    });
    return () => {
        offEndpoints();
        offChatPreferences();
        offAccounts();
    };
}
