import { create } from 'zustand';
import { isCanvasView, type ProjectView, type SplitLayout } from '@ruimte/contracts';
import { intersects, isMeasured, visibleRect, type Rect } from '@/canvas/math';
import { desktop } from '@/desktop/bridge';
import { projectNodes } from '@/project/views';
import { viewIdsIn } from '@/shell/split';
import { nodeWorking } from '@/state/agent-work';
import { nodesInSight, seenNodes, type CanvasSight } from '@/state/in-sight';
import { seePushNotifications, clearPushNotification, subscribePushAttention, unreadOnMachine } from '@/state/push-attention';
import { liveCanvas, subscribeCanvases } from '@/state/canvas';
import { useChats, type ChatStatuses } from '@ruimte/agents-react/state/chats';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey, useEndpointId } from '@/state/keys';
import { nodeStatus, useSessions, type SessionsByKey, type StatusOf } from '@/state/sessions';
import { snoozeOf, useSnoozes, type Snoozes } from '@/state/snooze';

export { readableNodes, seenNodes, sightOf, visibleNodes, type CanvasSight } from '@/state/in-sight';

/*
 * One source of unread and working counts for marks, badges, notifications and quit protection.
 * Endpoint-scoped keys preserve marks across machine switches and remove them with the machine.
 */

/* One canvas as a question about which chats stand on it. */
export interface ChatSightCanvas extends CanvasSight {
    nodes: readonly (Rect & { id: string; kind: string })[];
}

/* What `chatsInSight` reads of a workspace, handed in so a test builds one without a store. */
export interface ChatSightWorkspace {
    views: readonly ProjectView[];
    layout: SplitLayout | null;
    canvasOf(viewId: string): ChatSightCanvas | null;
}

/*
 * Plan visibility ignores zoom and window focus. It also uses the pre-panel viewport so opening the
 * panel cannot push its own chat out of sight and immediately close it.
 */
export const chatsInSight = (workspace: ChatSightWorkspace, { planWidth }: { planWidth: number }): Set<string> => {
    const onScreen = new Set(workspace.layout === null ? [] : viewIdsIn(workspace.layout));
    const chats = new Set<string>();
    for (const view of workspace.views) {
        if (!onScreen.has(view.id)) {
            continue;
        }
        if (view.kind === 'chat') {
            chats.add(view.id);
            continue;
        }
        const canvas = isCanvasView(view) ? workspace.canvasOf(view.id) : null;
        if (canvas === null || !isMeasured(canvas.viewport)) {
            continue;
        }
        const rect = visibleRect(canvas.camera, { w: canvas.viewport.w + planWidth, h: canvas.viewport.h });
        for (const node of canvas.nodes) {
            if (node.kind === 'chat' && canvas.hidden?.has(node.id) !== true && intersects(node, rect)) {
                chats.add(node.id);
            }
        }
    }
    return chats;
};

/* The open project, as `chatsInSight` reads it. */
export const liveChatSight = (): ChatSightWorkspace => {
    const { views, layout } = useDocument.getState();
    return {
        views,
        layout,
        canvasOf: (viewId) => {
            const canvas = liveCanvas(viewId);
            return canvas === null
                ? null
                : { camera: canvas.camera, viewport: canvas.viewport, nodes: canvas.order.map((id) => canvas.nodes[id]!), hidden: canvas.hidden };
        }
    };
};

/* Everything one pass of the watcher needs to decide, all of it keyed the same way. */
export interface AttentionPass {
    /* The nodes an agent is working in right now. */
    working: ReadonlySet<string>;
    /* The same set as the pass before it saw. */
    previous: ReadonlySet<string>;
    /* The nodes waiting on a person, which the needs-you count already speaks for. */
    needsYou: ReadonlySet<string>;
    /* What a person can see right now. */
    seen: ReadonlySet<string>;
    /* The marks as they stand. */
    unseen: ReadonlySet<string>;
    /* Every node the project still has. */
    known: ReadonlySet<string>;
}

/*
 * Which turns ended between the pass before and this one. A turn that stopped to ask something did
 * not end, since that is a person's turn and the needs-you count is already about it. A node that left
 * the project did not end a turn either, it went.
 */
export const settledSince = (pass: AttentionPass): string[] =>
    [...pass.previous].filter((key) => !pass.working.has(key) && !pass.needsYou.has(key) && pass.known.has(key));

/*
 * Marking and clearing are the same rule read twice, which is why looking at a node while its turn
 * ends never leaves a mark behind, and looking at a marked node always takes it off.
 */
export const nextUnseen = (pass: AttentionPass): Set<string> => {
    const next = new Set<string>();
    for (const key of [...pass.unseen, ...settledSince(pass)]) {
        if (!pass.seen.has(key) && !pass.working.has(key) && !pass.needsYou.has(key) && pass.known.has(key)) {
            next.add(key);
        }
    }
    return next;
};

/* The three counts the toolbar, the badge and the quit guard all read, as the nodes behind them. */
export interface AttentionGroups {
    /* Nodes waiting on a person, in the order the project lists them. */
    needsYou: string[];
    /* Nodes waiting on a person who put them aside for now, which no count includes. */
    snoozed: string[];
    /* Nodes with an agent in the middle of a turn. Never a shell somebody left attached. */
    working: string[];
    /* Nodes whose turn ended while nobody was looking. */
    finished: string[];
}

export const groupAttention = (
    nodes: readonly StatusOf[],
    sessions: SessionsByKey,
    chats: ChatStatuses,
    endpointId: string,
    unseen: Readonly<Record<string, true>>,
    snoozes: Snoozes
): AttentionGroups => {
    const groups: AttentionGroups = { needsYou: [], snoozed: [], working: [], finished: [] };
    for (const node of nodes) {
        if (nodeStatus(node, sessions, chats, endpointId) === 'needs-you') {
            if (snoozeOf(snoozes, endpointId, node.id) !== null) {
                groups.snoozed.push(node.id);
            } else {
                groups.needsYou.push(node.id);
            }
            continue;
        }
        if (nodeWorking(node, sessions, chats, endpointId)) {
            groups.working.push(node.id);
            continue;
        }
        if (unseen[endpointKey(endpointId, node.id)] === true) {
            groups.finished.push(node.id);
        }
    }
    return groups;
};

/* One number for the dock badge, everything a person still has to come back to. */
export const attentionTotal = (groups: AttentionGroups): number => groups.needsYou.length + groups.finished.length;

interface AttentionStore {
    /* Keyed with `endpointKey`. A plain record, so a render subscribes to the object it reads. */
    unseen: Record<string, true>;
    setUnseen(keys: ReadonlySet<string>): void;
}

export const useAttention = create<AttentionStore>((set) => ({
    unseen: {},
    setUnseen(keys) {
        set((state) => {
            const current = Object.keys(state.unseen);
            // The watcher runs on every store change; a new object each time would rerender the
            // toolbar and every node header for a keystroke in a terminal.
            if (current.length === keys.size && current.every((key) => keys.has(key))) {
                return {};
            }
            const unseen: Record<string, true> = {};
            for (const key of keys) {
                unseen[key] = true;
            }
            return { unseen };
        });
    }
}));

/*
 * Whether this node carries a mark. Takes the machine rather than reading the active one, for a list
 * that draws a row per machine (the sidebar) and for a test with no React around it.
 */
export const isUnseen = (unseen: Readonly<Record<string, true>>, endpointId: string, nodeId: string): boolean =>
    unseen[endpointKey(endpointId, nodeId)] === true;

export const useUnseen = (nodeId: string): boolean => {
    const endpointId = useEndpointId();
    return useAttention((s) => isUnseen(s.unseen, endpointId, nodeId));
};

/*
 * Takes the mark off by hand, for a person who dismisses it rather than goes to the node. Looking at
 * the node does this on its own, so nothing has to call this to keep the marks honest.
 */
export const clearUnseen = (nodeId: string): void => {
    clearPushNotification(currentEndpointId(), nodeId);
    const key = endpointKey(currentEndpointId(), nodeId);
    useAttention.getState().setUnseen(new Set(Object.keys(useAttention.getState().unseen).filter((entry) => entry !== key)));
};

/* Whether each node needs you, keyed for the snoozes; a node with no status yet says nothing either way. */
export const snoozeObservations = (nodes: readonly StatusOf[], sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): Map<string, boolean> => {
    const observed = new Map<string, boolean>();
    for (const node of nodes) {
        const status = nodeStatus(node, sessions, chats, endpointId);
        if (status !== undefined) {
            observed.set(endpointKey(endpointId, node.id), status === 'needs-you');
        }
    }
    return observed;
};

/*
 * Keeps the marks, the counts and what the shell is told in step with the stores the hooks write
 * into. Every pass counts the project from scratch, so a subscription that misses a change only ever
 * delays a clear by one event and never leaves a stale mark behind.
 */
export const startAttentionWatch = (): (() => void) => {
    let previous: ReadonlySet<string> = new Set<string>();
    let told = '';

    const pass = (): void => {
        const nodes = projectNodes();
        const endpointId = currentEndpointId();
        const keyOf = (nodeId: string): string => endpointKey(endpointId, nodeId);
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().byKey;
        const groups = groupAttention(nodes, sessions, chats, endpointId, useAttention.getState().unseen, useSnoozes.getState().byKey);
        const visible = seenNodes(document.hasFocus(), nodesInSight());
        seePushNotifications(endpointId, visible);
        const result: AttentionPass = {
            working: new Set(groups.working.map(keyOf)),
            previous,
            // A snoozed node still waits, so its turn has not ended and it earns no mark.
            needsYou: new Set([...groups.needsYou, ...groups.snoozed].map(keyOf)),
            seen: new Set([...visible].map(keyOf)),
            // The machine's own unread entries count too, since a turn that ended while no client was connected still leaves its mark.
            unseen: new Set([...Object.keys(useAttention.getState().unseen), ...unreadOnMachine(endpointId).map(keyOf)]),
            known: new Set(nodes.map((node) => keyOf(node.id)))
        };
        const marks = nextUnseen(result);
        previous = result.working;
        useAttention.getState().setUnseen(marks);
        // The marks this pass just set are part of the badge, so it counts them and not the old ones.
        const activity = { working: groups.working.length, attention: groups.needsYou.length + marks.size };
        const line = `${activity.working}/${activity.attention}`;
        if (line !== told) {
            told = line;
            desktop()?.setAgentActivity?.(activity);
        }
        // Last, since a snooze it ends runs this pass again, and that one has to start from this one's `previous`.
        useSnoozes.getState().observe(snoozeObservations(nodes, sessions, chats, endpointId));
    };

    /*
     * A canvas changes on every pointer move of a pan, and the answer only matters once a frame.
     * The stores the hooks write into are never throttled, since a turn that ends in a window nobody
     * is looking at has to be noticed, and a hidden window is given no frames at all.
     */
    let queued = false;
    const schedule = (): void => {
        if (queued) {
            return;
        }
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            pass();
        });
    };

    const offSessions = useSessions.subscribe(pass);
    const offChats = useChats.subscribe(pass);
    const offCanvases = subscribeCanvases(schedule);
    const offDocument = useDocument.subscribe(schedule);
    const offPushAttention = subscribePushAttention(pass);
    const offSnoozes = useSnoozes.subscribe(pass);
    window.addEventListener('focus', pass);
    window.addEventListener('blur', pass);
    pass();
    return () => {
        offSessions();
        offChats();
        offCanvases();
        offDocument();
        offPushAttention();
        offSnoozes();
        window.removeEventListener('focus', pass);
        window.removeEventListener('blur', pass);
    };
};
