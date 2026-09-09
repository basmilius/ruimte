import type { ContextSource } from '@ruimte/contracts';
import { useCanvas } from '@/state/canvas';
import { transport } from '@/transport';

const SETTLE_MS = 300;

// A text's first line is its name in the list an agent sees.
const titleOf = (text: string): string => text.split('\n')[0]?.trim().slice(0, 60) || 'Text';

/* Whether anything on the canvas is linked into this node; the same rule `contextSources` applies, as one boolean for a header. */
export const useHasContextLinks = (id: string): boolean =>
    useCanvas((s) => s.edges.some((edge) => edge.to === id && (s.texts[edge.from] !== undefined || s.nodes[edge.from] !== undefined)));

/* What every agent node may read, derived from the edges into it. */
export const contextSources = (): Map<string, ContextSource[]> => {
    const { edges, nodes, texts } = useCanvas.getState();
    const byTarget = new Map<string, ContextSource[]>();
    for (const edge of edges) {
        const target = nodes[edge.to];
        if (!target || (target.kind !== 'terminal' && target.kind !== 'chat')) {
            continue;
        }
        const node = nodes[edge.from];
        const text = texts[edge.from];
        let source: ContextSource | null = null;
        if (text) {
            source = { id: text.id, kind: 'text', title: titleOf(text.text), text: text.text };
        } else if (node && (node.kind === 'terminal' || node.kind === 'chat')) {
            source = { id: node.id, kind: node.kind, title: node.title };
        }
        if (source) {
            byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), source]);
        }
    }
    return byTarget;
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
