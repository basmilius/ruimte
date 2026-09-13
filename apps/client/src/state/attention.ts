import { create } from 'zustand';
import { isSessionView, isCanvasView } from '@ruimte/contracts';
import { READABLE_ZOOM } from '@/canvas/culling';
import { intersects, isMeasured, visibleRect, type Camera, type Rect } from '@/canvas/math';
import { desktop } from '@/desktop/bridge';
import { projectNodes } from '@/project/views';
import { notifyTurnDone } from '@/shell/notifications';
import { viewIdsIn } from '@/shell/split';
import { nodeWorking } from '@/state/agent-work';
import { liveCanvas, subscribeCanvases } from '@/state/canvas';
import { useChats, type ChatsById } from '@/state/chats';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey, useEndpointId } from '@/state/keys';
import { nodeStatus, useSessions, type SessionsByKey, type StatusOf } from '@/state/sessions';

/*
 * Attention: what a person still has to look at. A turn that settles while nobody was watching
 * leaves a mark on its node, and looking at the node is the only thing that takes it off. The pill
 * in the toolbar, the dock badge, the notification and the shell's quit guard are all counted here,
 * so none of them can say a different number than the one beside it.
 *
 * Keys are `endpointKey`, the way every other row about a node is: the marks outlive a switch to
 * another machine, and forgetting one takes its marks with it.
 */

/* One canvas as a question about sight: where the camera is and what stands in front of it. */
export interface CanvasSight {
    camera: Camera;
    viewport: { w: number; h: number };
    nodes: readonly (Rect & { id: string })[];
    /* Node ids inside a collapsed group. They are in the project and on nobody's screen. */
    hidden?: ReadonlySet<string>;
}

/*
 * The nodes of one canvas a person can actually read: inside the rectangle the camera has in front
 * of it, not folded into a collapsed group, and drawn large enough to be read rather than to be a
 * shape. No margin around the viewport, unlike the renderer's own culling: a node half a screen past
 * the edge is kept alive so a pan does not thrash, which is not the same as having been seen.
 * An editor that has no size yet is a frame old and has shown nothing, so it shows nothing here.
 */
export const readableNodes = (canvas: CanvasSight): string[] => {
    if (!isMeasured(canvas.viewport) || canvas.camera.zoom < READABLE_ZOOM) {
        return [];
    }
    const rect = visibleRect(canvas.camera, canvas.viewport);
    return canvas.nodes.filter((node) => canvas.hidden?.has(node.id) !== true && intersects(node, rect)).map((node) => node.id);
};

/* What the window has in front of a person: nothing at all while another window has the focus. */
export const seenNodes = (windowFocused: boolean, perView: readonly (readonly string[])[]): Set<string> => new Set(windowFocused ? perView.flat() : []);

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
 * not end: that is a person's turn and the needs-you count is already about it. A node that left the
 * project did not end a turn either, it went.
 */
export const settledSince = (pass: AttentionPass): string[] =>
    [...pass.previous].filter((key) => !pass.working.has(key) && !pass.needsYou.has(key) && pass.known.has(key));

/*
 * The marks after this pass: what was marked plus what just ended, minus everything in front of a
 * person right now, minus anything that went back to working or to asking, minus what left the
 * project. Marking and clearing are the same rule read twice, which is why looking at a node while
 * its turn ends never leaves a mark behind and looking at a marked node always takes it off.
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
    /* Nodes with an agent in the middle of a turn. Never a shell somebody left attached. */
    working: string[];
    /* Nodes whose turn ended while nobody was looking. */
    finished: string[];
}

export const groupAttention = (
    nodes: readonly StatusOf[],
    sessions: SessionsByKey,
    chats: ChatsById,
    endpointId: string,
    unseen: Readonly<Record<string, true>>
): AttentionGroups => {
    const groups: AttentionGroups = { needsYou: [], working: [], finished: [] };
    for (const node of nodes) {
        if (nodeStatus(node, sessions, chats, endpointId) === 'needs-you') {
            groups.needsYou.push(node.id);
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

/* One number for the dock badge: everything a person still has to come back to. */
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

/* Whether this node's turn ended while nobody was looking. What a node header draws its mark from. */
export const useUnseen = (nodeId: string): boolean => {
    const endpointId = useEndpointId();
    return useAttention((s) => s.unseen[endpointKey(endpointId, nodeId)] === true);
};

/*
 * Takes the mark off by hand, for a person who dismisses it rather than goes to the node. Looking at
 * the node does this on its own, so nothing has to call this to keep the marks honest.
 */
export const clearUnseen = (nodeId: string): void => {
    const key = endpointKey(currentEndpointId(), nodeId);
    useAttention.getState().setUnseen(new Set(Object.keys(useAttention.getState().unseen).filter((entry) => entry !== key)));
};

/* True while this window has the keyboard. A window behind another one is not being looked at. */
const windowFocused = (): boolean => typeof document !== 'undefined' && document.hasFocus();

/*
 * The nodes in front of a person: per view standing in a cell of the grid, the ones it is showing.
 * A view in no cell shows nothing, whatever it holds. A session standing as a view of its own is the
 * one node it is, and is showing it whenever its cell is on screen: there is no camera to fall
 * outside of. A cell that does not have the focus still counts, because a person looking at the
 * window sees all nine of them.
 */
const nodesInSight = (): string[][] => {
    const { views, layout } = useDocument.getState();
    const onScreen = new Set(layout === null ? [] : viewIdsIn(layout));
    return views.flatMap((view) => {
        if (!onScreen.has(view.id)) {
            return [];
        }
        if (isSessionView(view)) {
            return [[view.id]];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        const canvas = liveCanvas(view.id);
        if (canvas === null) {
            return [];
        }
        return [readableNodes({ camera: canvas.camera, viewport: canvas.viewport, nodes: canvas.order.map((id) => canvas.nodes[id]!), hidden: canvas.hidden })];
    });
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
        const groups = groupAttention(nodes, sessions, chats, endpointId, useAttention.getState().unseen);
        const focused = windowFocused();
        const result: AttentionPass = {
            working: new Set(groups.working.map(keyOf)),
            previous,
            needsYou: new Set(groups.needsYou.map(keyOf)),
            seen: seenNodes(
                focused,
                nodesInSight().map((ids) => ids.map(keyOf))
            ),
            unseen: new Set(Object.keys(useAttention.getState().unseen)),
            known: new Set(nodes.map((node) => keyOf(node.id)))
        };
        const settled = settledSince(result);
        const marks = nextUnseen(result);
        previous = result.working;
        useAttention.getState().setUnseen(marks);
        if (!focused) {
            for (const key of settled) {
                const node = nodes.find((candidate) => keyOf(candidate.id) === key);
                if (node) {
                    notifyTurnDone(node.id, node.title);
                }
            }
        }
        // The marks this pass just set are part of the badge, so it counts them and not the old ones.
        const activity = { working: groups.working.length, attention: groups.needsYou.length + marks.size };
        const line = `${activity.working}/${activity.attention}`;
        if (line !== told) {
            told = line;
            desktop()?.setAgentActivity?.(activity);
        }
    };

    /*
     * A canvas changes on every pointer move of a pan, and the answer only matters once a frame.
     * The stores the hooks write into are never throttled: a turn that ends in a window nobody is
     * looking at has to be noticed, and a hidden window is given no frames at all.
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
    window.addEventListener('focus', pass);
    window.addEventListener('blur', pass);
    pass();
    return () => {
        offSessions();
        offChats();
        offCanvases();
        offDocument();
        window.removeEventListener('focus', pass);
        window.removeEventListener('blur', pass);
    };
};
