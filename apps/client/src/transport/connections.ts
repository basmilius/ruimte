import { useSyncExternalStore } from 'react';
import { ChatClient } from '@/chat/chat-client';
import { DiagramClient } from '@/diagram/diagram-client';
import { DrawingClient } from '@/drawing/drawing-client';
import { foldList } from '@/project/list';
import { panelsPort } from '@/project/panels-port';
import { ProjectClient, type ProjectSink } from '@/project/project-client';
import { chatSinkFor } from '@/state/chats';
import { browserStorage, readLastProject } from '@/project/last-project';
import { activeEndpoint, endpointById, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { providerSinkFor } from '@/state/providers';
import { sessionSinkFor } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { createWorkspaceStores, defaultWorkspaceStores } from '@/state/workspace';
import { setCurrentWorkspace, type WorkspaceStores } from '@/state/workspace-stores';
import { endProjectSessions } from '@/terminal/lifecycle';
import { SessionClient } from '@/terminal/session-client';
import { machineTransport, pool } from '@/transport';
import { useOptionalConnection } from '@/transport/context';
import type { Transport } from '@/transport/transport';
import { LinkHold, wantsLink } from '@/transport/workspace-hold';

/*
 * One daemon, as everything inside a workspace sees it. The address and the token are deliberately
 * not in here: they live on the endpoint row, which a re-pair rewrites, and a copy taken when a
 * workspace was built would keep making URLs with a token that has been revoked since.
 */
export interface Connection {
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
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
    dispose(): void;
}

/*
 * One open project. The stores under it live as long as the workspace does; the clients over it are
 * rebuilt whenever the daemon changes, which is what a machine switch is. The clients sit on the
 * machine's transport rather than on its link, so the link may close while nothing is open and
 * come back without a rebuild. Two workspaces on two
 * machines are two of these, each saving to its own `project.json` over its own socket.
 */
export interface Workspace {
    id: string;
    stores: WorkspaceStores;
    /* Replaced rather than patched on a switch, so React knows the daemon under it moved. */
    connection: Connection;
    dispose(): void;
}

/* The workspace the app draws today. A second one is a pane, which is a feature of its own. */
export const MAIN_WORKSPACE_ID = 'main';

const machines = new Map<string, Machine>();
const workspaces = new Map<string, Workspace>();
/* The hold each workspace connection keeps on its machine's link while a project is open there (`wantsLink`). */
const connectionHolds = new WeakMap<Connection, LinkHold>();
/* The connections whose project client already tried the project its machine remembered. */
const bootedConnections = new WeakSet<Connection>();
/* What each workspace listens to for its hold, dropped with the workspace. */
const holdWatches = new Map<string, () => void>();
/* The same array until the set changes, so a React store reading it gets a stable snapshot. */
let workspaceList: Workspace[] = [];
const listeners = new Set<() => void>();
/* Which workspace the code outside React is about; the only one there is, until panes exist. */
let focusedId: string | null = null;

/* The store as one workspace's project client sees it: every write names the endpoint it came from. */
const projectSink = (stores: WorkspaceStores, endpointId: () => string): ProjectSink => {
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
    const sessions = new SessionClient(transport, sessionSinkFor(endpoint.id));
    // Every machine hears the same answer, since the switch is about this client and not about one of them.
    sessions.setApprovals(useSettings.getState().agentsApprovals);
    const chats = new ChatClient(transport, chatSinkFor(endpoint.id), providerSinkFor(endpoint.id));
    return {
        endpointId: endpoint.id,
        transport,
        sessions,
        chats,
        dispose(): void {
            sessions.dispose();
            chats.dispose();
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
 * Null for a machine this client no longer knows: a request meant for a daemon that was forgotten
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
 * The project and the drawing of one workspace, on the socket of the machine that project came from.
 * The drawing client is built first, so the project client can hand it the moment before a project
 * is swapped in and the drawing on screen reaches its own file while the old project is still open.
 */
const connect = (id: string, stores: WorkspaceStores, endpoint: Endpoint): Connection => {
    const transport = machineOn(endpoint).transport;
    /* Asked again on every save: a machine switch replaces the connection under the same workspace. */
    const endpointId = (): string => workspaces.get(id)?.connection.endpointId ?? endpoint.id;
    const drawings = new DrawingClient(transport, stores.drawings, stores.document, stores.project, {
        flushProject: (): Promise<void> => projects.flush()
    });
    const diagrams = new DiagramClient(transport, stores.diagrams, stores.document, stores.project, {
        flushProject: (): Promise<void> => projects.flush()
    });
    const projects = new ProjectClient(transport, stores.canvases, stores.document, panelsPort, projectSink(stores, endpointId), {
        drawings: stores.drawings,
        diagrams: stores.diagrams,
        beforeSwitch: async (): Promise<void> => {
            await Promise.all([drawings.flush(), diagrams.flush()]);
        },
        endSessions: endProjectSessions,
        afterResume: async (): Promise<void> => {
            await Promise.all([drawings.resume(), diagrams.resume()]);
        },
        onBooted: (): void => {
            bootedConnections.add(connection);
            const workspace = workspaces.get(id);
            if (workspace) {
                syncHold(workspace);
            }
        },
        endpointId
    });
    const connection: Connection = {
        endpointId: endpoint.id,
        transport,
        /* Asked for rather than held: the sessions and the threads belong to the machine, and a row
           that is forgotten drops them while this connection stays the same object. */
        get sessions(): SessionClient {
            return machineOn(endpoint).sessions;
        },
        get chats(): ChatClient {
            return machineOn(endpoint).chats;
        },
        projects,
        drawings,
        diagrams
    };
    connectionHolds.set(connection, new LinkHold((row) => pool.hold(row)));
    return connection;
};

/*
 * Holds the workspace's machine while a project is open there and lets go when none is: a machine
 * nobody works on keeps no link, which over a broker is a WebRTC channel on both ends.
 */
const syncHold = (workspace: Workspace): void => {
    const { connection, stores } = workspace;
    const hold = connectionHolds.get(connection);
    if (!hold) {
        return;
    }
    const { current, switching } = stores.project.getState();
    const wanted = wantsLink({
        current: current !== null,
        switching,
        remembered: readLastProject(browserStorage(), null).byEndpoint[connection.endpointId] !== undefined,
        booted: bootedConnections.has(connection)
    });
    hold.set(wanted ? endpointById(connection.endpointId) : null);
};

const disposeConnection = (connection: Connection): void => {
    connectionHolds.get(connection)?.set(null);
    connectionHolds.delete(connection);
    connection.projects.dispose();
    connection.drawings.dispose();
    connection.diagrams.dispose();
};

/*
 * A workspace on the daemon it belongs to, built on the first call. The stores are the module's own
 * for the first workspace, because everything that renders outside a provider still means that one.
 */
const workspaceOn = (id: string, endpoint: Endpoint): Workspace => {
    const existing = workspaces.get(id);
    if (existing) {
        moveTo(existing, endpoint);
        return existing;
    }
    const stores = workspaces.size === 0 ? defaultWorkspaceStores : createWorkspaceStores();
    const workspace: Workspace = {
        id,
        stores,
        connection: connect(id, stores, endpoint),
        dispose(): void {
            holdWatches.get(id)?.();
            holdWatches.delete(id);
            disposeConnection(workspace.connection);
            workspaces.delete(id);
            if (focusedId === id) {
                focusedId = workspaces.keys().next().value ?? null;
            }
            emit();
        }
    };
    workspaces.set(id, workspace);
    holdWatches.set(
        id,
        stores.project.subscribe((state, before) => {
            if (state.current !== before.current || state.switching !== before.switching) {
                syncHold(workspace);
            }
        })
    );
    syncHold(workspace);
    focusedId ??= id;
    emit();
    return workspace;
};

/* The daemon a workspace is on, after a machine switch or a row that learned its daemon's id. */
const moveTo = (workspace: Workspace, endpoint: Endpoint): void => {
    const { connection } = workspace;
    const target = machineTransport(endpoint.id);
    if (connection.endpointId === endpoint.id && connection.transport === target) {
        return;
    }
    if (connection.transport === target) {
        // A row that learned the id of its daemon is the same machine under another name; the link stayed put.
        const renamed = { ...connection, endpointId: endpoint.id };
        const hold = connectionHolds.get(connection);
        if (hold) {
            connectionHolds.delete(connection);
            connectionHolds.set(renamed, hold);
        }
        if (bootedConnections.has(connection)) {
            bootedConnections.add(renamed);
        }
        workspace.connection = renamed;
        syncHold(workspace);
        emit();
        return;
    }
    disposeConnection(connection);
    workspace.connection = connect(workspace.id, workspace.stores, endpoint);
    syncHold(workspace);
    emit();
};

/* The workspace the person is working in: the one the app draws, on the machine that is active. */
export const mainWorkspace = (): Workspace => workspaceOn(MAIN_WORKSPACE_ID, activeEndpoint());

/*
 * A second project, on any machine, with stores and clients of its own. Nothing in the app opens one
 * yet; the pane that would is a feature of its own, and this is what it will ask for.
 */
export const openWorkspace = (id: string, endpoint: Endpoint): Workspace => workspaceOn(id, endpoint);

export const workspaceById = (id: string): Workspace | null => workspaces.get(id) ?? null;

/* Every workspace this window has open, in the order they were opened. */
export const listWorkspaces = (): Workspace[] => workspaceList;

export const focusedWorkspaceId = (): string | null => focusedId;

/* Which workspace everything outside React means: the one whose project was touched last. */
export const focusWorkspace = (id: string): void => {
    if (!workspaces.has(id) || focusedId === id) {
        return;
    }
    focusedId = id;
    emit();
};

/*
 * Every change to a workspace passes here, because "the project in front of me" is what a keystroke,
 * a menu and a watcher all mean, and a machine switch answers that differently under the same stores.
 */
const emit = (): void => {
    workspaceList = [...workspaces.values()];
    const focused = focusedId === null ? null : (workspaces.get(focusedId) ?? null);
    setCurrentWorkspace(focused === null ? null : { stores: focused.stores, endpointId: focused.connection.endpointId });
    for (const listener of [...listeners]) {
        listener();
    }
};

export const subscribeWorkspaces = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/* The daemon a workspace is on, as React reads it: a switch replaces the object and the subtree follows. */
export const useWorkspaceConnection = (workspace: Workspace): Connection => useSyncExternalStore(subscribeWorkspaces, () => workspace.connection);

/* The workspace the app draws, kept on the active machine by `startConnections`. */
export const useMainWorkspace = (): Workspace => useSyncExternalStore(subscribeWorkspaces, () => workspaces.get(MAIN_WORKSPACE_ID) ?? mainWorkspace());

/*
 * The daemon the person is working on, for a surface that belongs to no project: the palette, a
 * global dialog. Inside a workspace it is that workspace's; outside one it is the workspace with the
 * focus, which is the one the app draws until panes exist.
 */
export const useFocusedConnection = (): Connection => {
    const inside = useOptionalConnection();
    const main = useWorkspaceConnection(useMainWorkspace());
    return inside ?? main;
};

/*
 * A stand-in for one of the active workspace's clients, so a call site keeps reading as "the daemon
 * this project is on" and holds on to nothing that a switch replaced.
 */
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
export const projectClient = activeClient(() => mainWorkspace().connection.projects);
export const drawingClient = activeClient(() => mainWorkspace().connection.drawings);
export const diagramClient = activeClient(() => mainWorkspace().connection.diagrams);

/* The session client of one machine, for a node that names the daemon it runs on. */
export const sessionClientFor = (endpointId: string): SessionClient | null => machineFor(endpointId)?.sessions ?? null;

export const chatClientFor = (endpointId: string): ChatClient | null => machineFor(endpointId)?.chats ?? null;

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
 * The active machine's clients exist from the first frame, because the project client is what opens
 * the project the person left off in as soon as its link answers. The link itself opens only when
 * that machine remembers a project (`syncHold`), which makes it the one machine a boot connects to.
 */
export const startConnections = (): (() => void) => {
    activeMachine();
    mainWorkspace();
    const offEndpoints = useEndpoints.subscribe((state, before) => {
        if (state.endpoints !== before.endpoints) {
            prune();
        }
        if (state.activeId !== before.activeId) {
            activeMachine();
            mainWorkspace();
        }
    });
    const offSettings = useSettings.subscribe((state, before) => {
        if (state.agentsApprovals !== before.agentsApprovals) {
            for (const machine of machines.values()) {
                machine.sessions.setApprovals(state.agentsApprovals);
            }
        }
    });
    return () => {
        offEndpoints();
        offSettings();
    };
};
