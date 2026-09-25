import i18next from 'i18next';
import { ChatClient } from '@/chat/chat-client';
import { BrowserClient } from '@/browser/browser-client';
import { DeviceClient } from '@/devices/device-client';
import { chatPreferencesPayload, useChatPreferences } from '@/chat/preferences';
import { DiagramClient } from '@/diagram/diagram-client';
import { DrawingClient } from '@/drawing/drawing-client';
import { foldList } from '@/project/list';
import { panelsPort } from '@/project/panels-port';
import { ProjectClient, type ProjectSink } from '@/project/project-client';
import { useChats, chatSinkFor } from '@/state/chats';
import { activeEndpoint, endpointById, useEndpoints, type Endpoint } from '@/state/endpoints';
import { isRealMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { PlanSync } from '@/state/plans';
import { watchPushAttention } from '@/state/push-attention';
import { knownAccounts, providerAccountsOf, useProviderAccountsStore, watchProviderAccounts } from '@/state/provider-accounts';
import { providerSinkFor } from '@/state/providers';
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
 * One daemon, as everything inside a workspace sees it. The address and the token are deliberately
 * not in here. They live on the endpoint row, which a re-pair rewrites, and a copy taken when a
 * workspace was built would keep making URLs with a token that has been revoked since.
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
const projectSink = (endpointId: () => string): ProjectSink => {
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
};

const buildMachine = (endpoint: Endpoint): Machine => {
    const transport = machineTransport(endpoint.id);
    const stopPushAttention = watchPushAttention(endpoint.id, transport);
    const stopAccounts = watchProviderAccounts(endpoint.id, transport);
    const plans = new PlanSync(endpoint.id, transport);
    const sessions = new SessionClient(transport, sessionSinkFor(endpoint.id));
    const chats = new ChatClient(transport, chatSinkFor(endpoint.id), providerSinkFor(endpoint.id));
    const browsers = new BrowserClient(endpoint.id, transport);
    const devices = new DeviceClient(endpoint.id, transport);
    chats.setPreferences(chatPreferencesPayload(useChatPreferences.getState(), endpoint.id, knownAccounts(providerAccountsOf(endpoint.id))));
    return {
        endpointId: endpoint.id,
        transport,
        sessions,
        chats,
        browsers,
        devices,
        dispose(): void {
            stopPushAttention();
            stopAccounts();
            plans.dispose();
            sessions.dispose();
            chats.dispose();
            browsers.dispose();
            devices.dispose();
        }
    };
};

/* One machine's clients, kept until the machine is forgotten; they follow its link as it opens and closes. */
const machineOn = (endpoint: Endpoint): Machine => {
    const existing = machines.get(endpoint.id);
    if (existing) {
        return existing;
    }
    const machine = buildMachine(endpoint);
    machines.set(machine.endpointId, machine);
    return machine;
};

/*
 * The sessions and the threads of one daemon, on that daemon's own socket. Every row they write
 * names their machine (`state/keys.ts`), so a second machine's clients paint nothing of this one's.
 * Null for a machine this client no longer knows. A request meant for a daemon that was forgotten
 * must not land on whichever machine happens to be active.
 */
export const machineFor = (endpointId: string): Machine | null => {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) {
        machines.get(endpointId)?.dispose();
        machines.delete(endpointId);
        return null;
    }
    return machineOn(endpoint);
};

/* The active machine always has a row in the endpoint list, so it always has clients. */
const activeMachine = (): Machine => machineFor(activeEndpoint().id)!;

/*
 * The clients of one workspace, on the socket of the machine its project comes from, holding that
 * machine's link until they are disposed. The drawing client is built first, so the project client
 * can hand it the moment before the project is left and the drawing on screen reaches its own file.
 * `onLoad` runs in the tick the project reaches the stores.
 */
const connect = (endpoint: Endpoint, onLoad: (connection: Connection) => void): Connection => {
    const transport = machineOn(endpoint).transport;
    /* Asked again on every save. A row that learns its daemon's id renames the connection under the same clients. */
    const endpointId = (): string => connection.endpointId;
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
        onLoad: () => onLoad(connection),
        endpointId
    });
    const connection: Connection = {
        endpointId: endpoint.id,
        transport,
        /* Asked for rather than held. The sessions and the threads belong to the machine, and a row
           that is forgotten drops them while this connection stays the same object. */
        get sessions(): SessionClient {
            return machineOn(endpointById(connection.endpointId) ?? endpoint).sessions;
        },
        get chats(): ChatClient {
            return machineOn(endpointById(connection.endpointId) ?? endpoint).chats;
        },
        get browsers(): BrowserClient {
            return machineOn(endpointById(connection.endpointId) ?? endpoint).browsers;
        },
        get devices(): DeviceClient {
            return machineOn(endpointById(connection.endpointId) ?? endpoint).devices;
        },
        projects,
        drawings,
        diagrams
    };
    const hold = new LinkHold((row) => pool.hold(row));
    hold.set(endpoint);
    connectionHolds.set(connection, hold);
    return connection;
};

/*
 * Lets go of everything a connection built: its clients and its hold on the machine's link, which
 * over a broker is a WebRTC channel on both ends. The rows of that machine's sessions and chats go
 * too; they are about the nodes of the project that left, and the next one attaches its own.
 */
const disposeConnection = (connection: Connection): void => {
    if (disposed.has(connection)) {
        return;
    }
    disposed.add(connection);
    connectionHolds.get(connection)?.set(null);
    connectionHolds.delete(connection);
    connection.projects.dispose();
    connection.drawings.dispose();
    connection.diagrams.dispose();
    useSessions.getState().clear(connection.endpointId);
    useChats.getState().clear(connection.endpointId);
};

/*
 * Opens a project in a new workspace and puts it on screen. The window moves in the same tick the
 * project reaches the stores, so nothing is drawn with the old connection over the new project. A
 * project that does not open leaves the window as it was and takes its clients with it.
 */
export const enterWorkspace = async (endpointId: string, request: OpenRequest): Promise<void> => {
    const endpoint = endpointById(endpointId);
    if (!endpoint || !isRealMachine(endpointId)) {
        throw new Error(i18next.t('machines:link.notInList'));
    }
    const connection = connect(endpoint, (opened) => {
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
        if (windowWorkspace()?.connection !== connection) {
            disposeConnection(connection);
        }
        throw e;
    }
};

/*
 * Lets go of the open project for another one. The window keeps showing it until the next project
 * is in, and the stores keep what they hold, but nothing saves any more. The project client wrote
 * what was pending and the daemon was told the project is released.
 */
export const leaveWorkspace = async (): Promise<void> => {
    const workspace = windowWorkspace();
    if (!workspace || disposed.has(workspace.connection)) {
        return;
    }
    await workspace.connection.projects.leave();
    // Nothing is open under the views on screen now; a drawing client built for the next project must not open theirs.
    stores.project.getState().setSwitching(true);
    disposeConnection(workspace.connection);
};

/* The start screen, with nothing of the workspace left: no clients, no hold, empty stores. */
export const showStart = (): void => {
    const workspace = windowWorkspace();
    if (workspace) {
        disposeConnection(workspace.connection);
    }
    stores.document.getState().load(null, null);
    panelsPort.load(null, undefined);
    stores.project.getState().setCurrent(null, 0, null);
    stores.project.getState().setSwitching(false);
    useWindow.getState().show({ kind: 'start' });
};

/* The workspace on screen as React reads it, and null on the start screen. */
export const useWorkspace = (): Workspace | null => useWindow((s) => workspaceOf(s.content));

/*
 * The machine a surface outside the workspace works on: the palette, a global dialog. Inside a
 * workspace it is that workspace's; on the start screen it is the active machine.
 */
export const useFocusedMachine = (): { endpointId: string; transport: Transport } => {
    const inside = useOptionalConnection();
    const workspace = useWorkspace();
    const activeId = useEndpoints((s) => s.activeId);
    const connection = inside ?? workspace?.connection ?? null;
    return connection ?? { endpointId: activeId, transport: machineTransport(activeId) };
};

/*
 * A stand-in for one of the workspace's clients, so a call site keeps reading as "the daemon this
 * project is on" and holds on to nothing that a switch replaced. Only a surface of the workspace may
 * call one. The start screen has nothing to act on.
 */
const workspaceClient = <T extends object>(pick: (connection: Connection) => T): T =>
    new Proxy({} as T, {
        get(_target, property) {
            const workspace = windowWorkspace();
            if (!workspace) {
                throw new Error('This acts on the open project, and the window shows the start screen');
            }
            const client = pick(workspace.connection);
            const value = Reflect.get(client, property) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
        }
    });

const activeClient = <T extends object>(pick: () => T): T =>
    new Proxy({} as T, {
        get(_target, property) {
            const client = pick();
            const value = Reflect.get(client, property) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
        }
    });

export const sessionClient = activeClient(() => activeMachine().sessions);
export const chatClient = activeClient(() => activeMachine().chats);
export const projectClient = workspaceClient((connection) => connection.projects);
export const drawingClient = workspaceClient((connection) => connection.drawings);
export const diagramClient = workspaceClient((connection) => connection.diagrams);

/* The session client of one machine, for a node that names the daemon it runs on. */
export const sessionClientFor = (endpointId: string): SessionClient | null => machineFor(endpointId)?.sessions ?? null;

export const chatClientFor = (endpointId: string): ChatClient | null => machineFor(endpointId)?.chats ?? null;

export const browserClientFor = (endpointId: string): BrowserClient | null => machineFor(endpointId)?.browsers ?? null;

export const deviceClientFor = (endpointId: string): DeviceClient | null => machineFor(endpointId)?.devices ?? null;

/* A machine this client no longer knows under that id (forgotten, or a row that moved onto its daemon id) keeps no clients. */
const prune = (): void => {
    const known = new Set(useEndpoints.getState().endpoints.map((endpoint) => endpoint.id));
    for (const [endpointId, machine] of [...machines]) {
        if (!known.has(endpointId)) {
            machines.delete(endpointId);
            machine.dispose();
        }
    }
};

/* Everything one machine held, for a row that is forgotten or a session that was revoked. */
export const dropMachine = (endpointId: string): void => {
    const machine = machines.get(endpointId);
    machines.delete(endpointId);
    machine?.dispose();
};

/*
 * A row that learned the id of its daemon is the same machine under another name. The transport and
 * the link stayed put, so the workspace keeps its clients and only its name for the machine moves.
 */
const followRekey = (): void => {
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
};

/* The active machine's clients exist from the first frame. The attention, the plans and the sessions of that machine hang on them. */
export const startConnections = (): (() => void) => {
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
    const tellPreferences = (machine: Machine): void => {
        machine.chats.setPreferences(
            chatPreferencesPayload(useChatPreferences.getState(), machine.endpointId, knownAccounts(providerAccountsOf(machine.endpointId)))
        );
    };
    const offChatPreferences = useChatPreferences.subscribe((state, before) => {
        if (state.changedAt !== before.changedAt) {
            machines.forEach(tellPreferences);
        }
    });
    // An account for new agents that a machine turned off or removed is left out of what that machine is told.
    const offAccounts = useProviderAccountsStore.subscribe((state, before) => {
        for (const machine of machines.values()) {
            if (state.byEndpoint[machine.endpointId] !== before.byEndpoint[machine.endpointId]) {
                tellPreferences(machine);
            }
        }
    });
    return () => {
        offEndpoints();
        offChatPreferences();
        offAccounts();
    };
};
