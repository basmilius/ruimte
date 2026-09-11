import { ChatClient } from '@/chat/chat-client';
import { DrawingClient } from '@/drawing/drawing-client';
import { panelsPort } from '@/project/panels-port';
import { ProjectClient, type ProjectSink } from '@/project/project-client';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { activeEndpoint, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { useSessions } from '@/state/sessions';
import { SessionClient } from '@/terminal/session-client';
import { pool } from '@/transport';
import type { Transport } from '@/transport/transport';

/* Everything that runs on one daemon: its socket, and the four clients that own that socket's events. */
export interface Connection {
    /* The endpoint this socket belongs to; it moves when a row learns the id of the daemon behind it. */
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
    projects: ProjectClient;
    drawings: DrawingClient;
    dispose(): void;
}

let current: Connection | null = null;

const projectSink = (): ProjectSink => {
    const actions = useProject.getState();
    return {
        setProjects: actions.setProjects,
        setCurrent: actions.setCurrent,
        setRev: actions.setRev,
        setChosenIcon: actions.setChosenIcon,
        setSummary: actions.setSummary,
        setDirty: actions.setDirty,
        setConflict: actions.setConflict,
        setError: actions.setError,
        setSwitching: actions.setSwitching,
        getState: () => useProject.getState()
    };
};

/*
 * The clients of one daemon, on that daemon's own socket. The drawing client is built first: the
 * project client hands it the moment before a project is swapped in, so the drawing on screen
 * reaches its own file while the old project is still open.
 */
const build = (endpoint: Endpoint): Connection => {
    const transport = pool.require(endpoint);
    const drawings = new DrawingClient(transport, useDrawing, useDocument, useProject, {
        flushProject: (): Promise<void> => projects.flush()
    });
    const projects = new ProjectClient(transport, useCanvas, useDocument, panelsPort, projectSink(), {
        drawing: useDrawing,
        beforeSwitch: (): Promise<void> => drawings.flush(),
        endpointId: (): string => connection.endpointId
    });
    const sessions = new SessionClient(transport, useSessions.getState());
    const chats = new ChatClient(transport, useChats.getState(), useProviders.getState());
    const connection: Connection = {
        endpointId: endpoint.id,
        transport,
        sessions,
        chats,
        projects,
        drawings,
        dispose(): void {
            sessions.dispose();
            chats.dispose();
            projects.dispose();
            drawings.dispose();
        }
    };
    return connection;
};

/*
 * The clients of the machine that is active, built on its socket and torn down when another machine
 * takes over. One set at a time: the stores they write to (`state/project.ts`, `state/sessions.ts`,
 * `state/providers.ts`) still hold one daemon's answers, so a second live set would paint two
 * machines into one canvas. It is also what keeps a reattach on its own machine: a session client
 * knows one socket, and that socket never changes daemons. Phase 4 keys those stores on the
 * endpoint, and several sets can be alive at once.
 */
export const activeConnection = (): Connection => {
    const endpoint = activeEndpoint();
    if (current) {
        if (current.transport === pool.peek(endpoint.id)) {
            // A row that learned the id of its daemon is the same machine under another name; the socket stayed put.
            current.endpointId = endpoint.id;
            return current;
        }
        current.dispose();
    }
    current = build(endpoint);
    return current;
};

/*
 * A stand-in for one of the active connection's clients, so a call site keeps reading as "the daemon
 * this project is on" and holds on to nothing that a switch replaced.
 */
const activeClient = <T extends object>(pick: (connection: Connection) => T): T =>
    new Proxy({} as T, {
        get(_target, property) {
            const client = pick(activeConnection());
            const value = Reflect.get(client, property) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
        }
    });

export const sessionClient = activeClient((connection) => connection.sessions);
export const chatClient = activeClient((connection) => connection.chats);
export const projectClient = activeClient((connection) => connection.projects);
export const drawingClient = activeClient((connection) => connection.drawings);

/*
 * The active machine's clients exist from the first frame, because the project client is what opens
 * the project the person left off in as soon as its socket answers.
 */
export const startConnections = (): (() => void) => {
    activeConnection();
    return useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            activeConnection();
        }
    });
};
