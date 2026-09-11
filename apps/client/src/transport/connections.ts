import { ChatClient } from '@/chat/chat-client';
import { DrawingClient } from '@/drawing/drawing-client';
import { foldList } from '@/project/list';
import { panelsPort } from '@/project/panels-port';
import { ProjectClient, type ProjectSink } from '@/project/project-client';
import { useCanvas } from '@/state/canvas';
import { chatSinkFor } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { activeEndpoint, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { providerSinkFor } from '@/state/providers';
import { sessionSinkFor } from '@/state/sessions';
import { SessionClient } from '@/terminal/session-client';
import { pool } from '@/transport';
import type { Transport } from '@/transport/transport';

/* The clients of one daemon that write state keyed on that daemon, so several may be alive at once. */
export interface Machine {
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
    dispose(): void;
}

/* The clients of the machine whose project is on screen; there is one project, so there is one of these. */
interface Workspace {
    endpointId: string;
    transport: Transport;
    projects: ProjectClient;
    drawings: DrawingClient;
    dispose(): void;
}

const machines = new Map<string, Machine>();
let workspace: Workspace | null = null;

/* The store as one machine's project client sees it: every write names the endpoint it came from. */
const projectSink = (endpointId: () => string): ProjectSink => {
    const actions = useProject.getState();
    return {
        setProjects: (projects) => foldList(endpointId(), projects),
        patchProject: (summary) => actions.patchProject(endpointId(), summary),
        setCurrent: (current, rev) => actions.setCurrent(current, rev, endpointId()),
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

/*
 * The sessions and the threads of one daemon, on that daemon's own socket. Every row they write
 * names their machine (`state/keys.ts`), so a second machine's clients paint nothing of this one's.
 * Null for a machine this client no longer knows: a request meant for a daemon that was forgotten
 * must not land on whichever machine happens to be active.
 */
export const machineFor = (endpointId: string): Machine | null => {
    const existing = machines.get(endpointId);
    if (existing && existing.transport === pool.peek(endpointId)) {
        return existing;
    }
    existing?.dispose();
    machines.delete(endpointId);
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) {
        return null;
    }
    const machine = buildMachine(endpoint);
    machines.set(machine.endpointId, machine);
    return machine;
};

/* The active machine always has a row in the endpoint list, so it always has clients. */
const activeMachine = (): Machine => machineFor(activeEndpoint().id)!;

/*
 * The project and the drawing on screen, on the socket of the machine that project came from. One
 * set at a time, because `state/project.ts`, `state/document.ts` and `state/canvas.ts` still hold
 * one open project: a second live set would boot a second project into the same canvas. The drawing
 * client is built first, so the project client can hand it the moment before a project is swapped in
 * and the drawing on screen reaches its own file while the old project is still open.
 */
const buildWorkspace = (endpoint: Endpoint): Workspace => {
    const transport = pool.require(endpoint);
    const drawings = new DrawingClient(transport, useDrawing, useDocument, useProject, {
        flushProject: (): Promise<void> => projects.flush()
    });
    const projects = new ProjectClient(
        transport,
        useCanvas,
        useDocument,
        panelsPort,
        projectSink(() => current.endpointId),
        {
            drawing: useDrawing,
            beforeSwitch: (): Promise<void> => drawings.flush(),
            endpointId: (): string => current.endpointId
        }
    );
    const current: Workspace = {
        endpointId: endpoint.id,
        transport,
        projects,
        drawings,
        dispose(): void {
            projects.dispose();
            drawings.dispose();
        }
    };
    return current;
};

const activeWorkspace = (): Workspace => {
    const endpoint = activeEndpoint();
    if (workspace) {
        if (workspace.transport === pool.peek(endpoint.id)) {
            // A row that learned the id of its daemon is the same machine under another name; the socket stayed put.
            workspace.endpointId = endpoint.id;
            return workspace;
        }
        workspace.dispose();
    }
    workspace = buildWorkspace(endpoint);
    return workspace;
};

/*
 * A stand-in for one of the active machine's clients, so a call site keeps reading as "the daemon
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
export const projectClient = activeClient(() => activeWorkspace().projects);
export const drawingClient = activeClient(() => activeWorkspace().drawings);

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
    activeWorkspace();
    const offPool = pool.subscribe(prune);
    const offEndpoints = useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            activeMachine();
            activeWorkspace();
        }
    });
    return () => {
        offPool();
        offEndpoints();
    };
};
