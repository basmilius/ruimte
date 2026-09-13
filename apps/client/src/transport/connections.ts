import { useSyncExternalStore } from 'react';
import { ChatClient } from '@/chat/chat-client';
import { DrawingClient } from '@/drawing/drawing-client';
import { foldList } from '@/project/list';
import { panelsPort } from '@/project/panels-port';
import { ProjectClient, type ProjectSink } from '@/project/project-client';
import { chatSinkFor } from '@/state/chats';
import { activeEndpoint, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { providerSinkFor } from '@/state/providers';
import { sessionSinkFor } from '@/state/sessions';
import { createWorkspaceStores, defaultWorkspaceStores } from '@/state/workspace';
import { setCurrentWorkspace, type WorkspaceStores } from '@/state/workspace-stores';
import { endProjectSessions } from '@/terminal/lifecycle';
import { SessionClient } from '@/terminal/session-client';
import { pool } from '@/transport';
import { useOptionalConnection } from '@/transport/context';
import type { Transport } from '@/transport/transport';

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
 * rebuilt whenever the daemon changes, which is what a machine switch is. Two workspaces on two
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
    const transport = pool.require(endpoint);
    const sessions = new SessionClient(transport, sessionSinkFor(endpoint.id));
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

/* One machine's clients, kept until the pool replaces the socket they were built on. */
const machineOn = (endpoint: Endpoint): Machine => {
    const existing = machines.get(endpoint.id);
    if (existing && existing.transport === pool.peek(endpoint.id)) {
        return existing;
    }
    existing?.dispose();
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
    const projects = new ProjectClient(transport, stores.canvases, stores.document, panelsPort, projectSink(stores, endpointId), {
        drawings: stores.drawings,
        beforeSwitch: (): Promise<void> => drawings.flush(),
        endSessions: endProjectSessions,
        endpointId
    });
    return {
        endpointId: endpoint.id,
        transport,
        /* Asked for rather than held: the sessions and the threads belong to the machine, and the
           pool replacing its socket replaces them while this connection stays the same object. */
        get sessions(): SessionClient {
            return machineOn(endpoint).sessions;
        },
        get chats(): ChatClient {
            return machineOn(endpoint).chats;
        },
        projects,
        drawings
    };
};

const disposeConnection = (connection: Connection): void => {
    connection.projects.dispose();
    connection.drawings.dispose();
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
            disposeConnection(workspace.connection);
            workspaces.delete(id);
            if (focusedId === id) {
                focusedId = workspaces.keys().next().value ?? null;
            }
            emit();
        }
    };
    workspaces.set(id, workspace);
    focusedId ??= id;
    emit();
    return workspace;
};

/* The daemon a workspace is on, after a machine switch or a row that learned its daemon's id. */
const moveTo = (workspace: Workspace, endpoint: Endpoint): void => {
    const { connection } = workspace;
    const socket = pool.peek(endpoint.id);
    if (connection.endpointId === endpoint.id && connection.transport === socket) {
        return;
    }
    if (connection.transport === socket) {
        // A row that learned the id of its daemon is the same machine under another name; the socket stayed put.
        workspace.connection = { ...connection, endpointId: endpoint.id };
        emit();
        return;
    }
    disposeConnection(connection);
    workspace.connection = connect(workspace.id, workspace.stores, endpoint);
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

/* The session client of one machine, for a node that names the daemon it runs on. */
export const sessionClientFor = (endpointId: string): SessionClient | null => machineFor(endpointId)?.sessions ?? null;

export const chatClientFor = (endpointId: string): ChatClient | null => machineFor(endpointId)?.chats ?? null;

/* A machine whose socket the pool closed has no clients left to keep; the next call builds them again. */
const prune = (): void => {
    for (const [endpointId, machine] of [...machines]) {
        if (pool.peek(endpointId) !== machine.transport) {
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
 * the project the person left off in as soon as its socket answers.
 */
export const startConnections = (): (() => void) => {
    activeMachine();
    mainWorkspace();
    const offPool = pool.subscribe(prune);
    const offEndpoints = useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            activeMachine();
            mainWorkspace();
        }
    });
    return () => {
        offPool();
        offEndpoints();
    };
};
