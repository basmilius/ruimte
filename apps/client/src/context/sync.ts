import { isCanvasView, type ContextSource } from '@ruimte/contracts';
import { deriveContextSources } from '@/context/sources';
import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { currentEndpointId } from '@/state/keys';
import { pool, transportFor } from '@/transport';

const SETTLE_MS = 300;

/* Whether this node has readable context linked into it, as one boolean for a header; the same rule `contextSources` applies. */
export const useHasContextLinks = (id: string): boolean => useCanvas((s) => (deriveContextSources(s.nodes, s.texts, s.edges).get(id)?.length ?? 0) > 0);

/* Where the project this canvas belongs to sits, which is what a file node's stored path counts from. */
const projectFolder = (): string | null => useProject.getState().current?.folder ?? null;

const byId = <T extends { id: string }>(items: T[]): Record<string, T> => Object.fromEntries(items.map((item) => [item.id, item]));

/*
 * What every agent node of the project may read right now, over every view: an agent on a canvas
 * that is not on screen keeps the lines drawn into it, so switching views may not clear its context.
 */
export const contextSources = (): Map<string, ContextSource[]> => {
    const merged = new Map<string, ContextSource[]>();
    const canvas = useCanvas.getState();
    const { views } = useDocument.getState();
    const folder = projectFolder();
    for (const view of views) {
        if (!isCanvasView(view)) {
            continue;
        }
        const derived =
            view.id === canvas.viewId
                ? deriveContextSources(canvas.nodes, canvas.texts, canvas.edges, folder)
                : deriveContextSources(byId(view.nodes), byId(view.texts), view.edges, folder);
        for (const [targetId, sources] of derived) {
            merged.set(targetId, sources);
        }
    }
    return merged;
};

/*
 * Tells the daemon which sources each agent node may read, whenever an edge, a text or a
 * title changes, and again after every reconnect. A target that lost its last edge is cleared.
 */
export const startContextSync = (): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    /* What each machine was last told, per target. The nodes of one project are on one daemon, and
       what another daemon was told has to stay standing while this one is edited. */
    const sent = new Map<string, Map<string, string>>();

    const push = (force = false): void => {
        /* The daemon of the project being edited, which is not the active machine once a second
           workspace is on screen: a `context.set` on the wrong one would name a node it has never seen. */
        const endpointId = currentEndpointId();
        const transport = transportFor(endpointId);
        if (transport?.status !== 'open') {
            return;
        }
        const before = sent.get(endpointId) ?? new Map<string, string>();
        const wanted = contextSources();
        const next = new Map<string, string>();
        for (const [targetId, sources] of wanted) {
            next.set(targetId, JSON.stringify(sources));
        }
        for (const [targetId, serialized] of next) {
            if (force || before.get(targetId) !== serialized) {
                void transport.request('context.set', { targetId, sources: wanted.get(targetId)! }).catch(() => undefined);
            }
        }
        for (const targetId of before.keys()) {
            if (!next.has(targetId)) {
                void transport.request('context.set', { targetId, sources: [] }).catch(() => undefined);
            }
        }
        sent.set(endpointId, next);
    };

    const schedule = (): void => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            push();
        }, SETTLE_MS);
    };

    const offCanvas = useCanvas.subscribe((state, previous) => {
        if (state.edges !== previous.edges || state.texts !== previous.texts || state.nodes !== previous.nodes) {
            schedule();
        }
    });
    const offDocument = useDocument.subscribe((state, previous) => {
        if (state.views !== previous.views || state.activeViewId !== previous.activeViewId) {
            schedule();
        }
    });
    const offStatus = pool.subscribe(() => {
        const endpointId = currentEndpointId();
        if (transportFor(endpointId)?.status !== 'open' || !sent.has(endpointId)) {
            // A daemon that answers again knows nothing of what it was told before it went away.
            sent.delete(endpointId);
            push(true);
        }
    });
    push(true);
    return () => {
        offCanvas();
        offDocument();
        offStatus();
        if (timer) {
            clearTimeout(timer);
        }
    };
};
