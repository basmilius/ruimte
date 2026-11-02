import { useChats } from '@adecore/agents-react/state';
import { extensionAgentStatus, extensionChatOf, type ExtensionAgentStatus } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { nodeInfoOf, type NodeInfo } from '@/extensions/slots';
import { defaultCanvases, focusedCanvas, type CanvasState } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { splitKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { useProject } from '@/state/project';
import { useSessions, sessionStatus } from '@/state/sessions';

export interface ClientEvents {
    'node.added': { node: NodeInfo };
    'node.removed': { id: string };
    'node.changed': { node: NodeInfo };
    'selection.changed': { nodes: NodeInfo[] };
    'view.changed': { viewId: string | null };
    'project.opened': { projectId: string };
    'agent.status': { nodeId: string; status: ExtensionAgentStatus };
    'chat.turnFinished': { chatId: string };
}

type Listener = (event: never) => void;

const listeners = new Map<string, Set<Listener>>();

// Each listener on its own: one that throws would otherwise end the store's notification, and every one after it hears nothing.
function emit<Name extends keyof ClientEvents>(name: Name, event: ClientEvents[Name]): void {
    for (const listener of listeners.get(name) ?? []) {
        try {
            (listener as (event: ClientEvents[Name]) => void)(event);
        } catch (e) {
            console.error(`A listener of ${name} failed`, e);
        }
    }
}

/*
 * Whether a chat or session of this key is about the workspace in this window: on its own machine, or a node of its
 * project that runs on another. Every machine of the pool fills the same stores, and another one's are no event here.
 */
function inThisWorkspace(key: string): boolean {
    const { endpointId, id } = splitKey(key);

    return endpointOfNodeId(id) === endpointId;
}

let started = false;

/* Started with the first listener, so an app with no extension listening does none of this work. */
function start(): void {
    if (started) {
        return;
    }

    started = true;

    let following: StoreApi<CanvasState> | null = null;
    let stopCanvas = (): void => undefined;
    const followCanvas = (): void => {
        const canvas = focusedCanvas();

        if (canvas === following) {
            return;
        }

        following = canvas;
        stopCanvas();
        stopCanvas = canvas.subscribe((state, previous) => {
            if (state.selection !== previous.selection) {
                emit('selection.changed', { nodes: state.selection.map(nodeInfoOf) });
            }

            if (state.nodes === previous.nodes) {
                return;
            }

            for (const id of Object.keys(state.nodes)) {
                if (previous.nodes[id] === undefined) {
                    emit('node.added', { node: nodeInfoOf(id) });
                } else if (previous.nodes[id] !== state.nodes[id]) {
                    emit('node.changed', { node: nodeInfoOf(id) });
                }
            }

            for (const id of Object.keys(previous.nodes)) {
                if (state.nodes[id] === undefined) {
                    emit('node.removed', { id });
                }
            }
        });
    };

    followCanvas();
    /*
     * The registry, not `activeViewId`: the document names the new view before the registry moves its focus there,
     * and a reload makes a new editor for a view whose id stays.
     */
    defaultCanvases.subscribeShape(followCanvas);
    useDocument.subscribe((state, previous) => {
        if (state.activeViewId !== previous.activeViewId) {
            emit('view.changed', { viewId: state.activeViewId });
        }
    });
    useProject.subscribe((state, previous) => {
        if (state.current?.projectId !== previous.current?.projectId && state.current) {
            emit('project.opened', { projectId: state.current.projectId });
        }
    });
    // Only the statuses, which stay put while a chat streams its answer.
    useChats.subscribe((state, previous) => {
        if (state.statusByKey === previous.statusByKey) {
            return;
        }

        for (const [key, row] of Object.entries(state.statusByKey)) {
            if (!inThisWorkspace(key)) {
                continue;
            }

            const before = previous.statusByKey[key]?.info;
            const { id } = splitKey(key);

            if (row.info.status !== before?.status) {
                emit('agent.status', { nodeId: id, status: extensionChatOf(row.info).status });
            }

            // The turn in flight ended, which waiting on a person does not do: it keeps its turn until it goes on.
            if (before !== undefined && before.activeTurnId !== null && row.info.activeTurnId !== before.activeTurnId) {
                emit('chat.turnFinished', { chatId: id });
            }
        }
    });
    useSessions.subscribe((state, previous) => {
        for (const [key, row] of Object.entries(state.byKey)) {
            const status = sessionStatus(row);

            if (status !== sessionStatus(previous.byKey[key]) && inThisWorkspace(key)) {
                emit('agent.status', { nodeId: splitKey(key).id, status: extensionAgentStatus(status) });
            }
        }
    });
}

export function onClientEvent<Name extends keyof ClientEvents>(name: Name, listener: (event: ClientEvents[Name]) => void): () => void {
    start();

    const group = listeners.get(name) ?? new Set<Listener>();

    group.add(listener as Listener);
    listeners.set(name, group);

    return () => {
        group.delete(listener as Listener);
    };
}
