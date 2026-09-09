import type { ContextSource } from '@ruimte/contracts';
import { deriveContextSources } from '@/context/sources';
import { useCanvas } from '@/state/canvas';
import { transport } from '@/transport';

const SETTLE_MS = 300;

/* Whether this node has readable context linked into it, as one boolean for a header; the same rule `contextSources` applies. */
export const useHasContextLinks = (id: string): boolean => useCanvas((s) => (deriveContextSources(s.nodes, s.texts, s.edges).get(id)?.length ?? 0) > 0);

/* What every agent node may read right now, derived from the edges into it. */
export const contextSources = (): Map<string, ContextSource[]> => {
    const { edges, nodes, texts } = useCanvas.getState();
    return deriveContextSources(nodes, texts, edges);
};

/*
 * Tells the daemon which sources each agent node may read, whenever an edge, a text or a
 * title changes, and again after every reconnect. A target that lost its last edge is cleared.
 */
export const startContextSync = (): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = new Map<string, string>();

    const push = (force = false): void => {
        if (transport.status !== 'open') {
            return;
        }
        const wanted = contextSources();
        const next = new Map<string, string>();
        for (const [targetId, sources] of wanted) {
            next.set(targetId, JSON.stringify(sources));
        }
        for (const [targetId, serialized] of next) {
            if (force || sent.get(targetId) !== serialized) {
                void transport.request('context.set', { targetId, sources: wanted.get(targetId)! }).catch(() => undefined);
            }
        }
        for (const targetId of sent.keys()) {
            if (!next.has(targetId)) {
                void transport.request('context.set', { targetId, sources: [] }).catch(() => undefined);
            }
        }
        sent = next;
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
    const offStatus = transport.subscribeStatus((status) => {
        if (status === 'open') {
            sent = new Map();
            push(true);
        }
    });
    if (transport.status === 'open') {
        push(true);
    }
    return () => {
        offCanvas();
        offStatus();
        if (timer) {
            clearTimeout(timer);
        }
    };
};
