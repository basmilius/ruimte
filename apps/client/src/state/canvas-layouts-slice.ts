import type { ProjectLayout } from '@ruimte/contracts';
import type { CanvasState } from '@/state/canvas';
import { remember, type CanvasGet, type CanvasSet } from '@/state/canvas-model';

/* Items the layout never saw stay where they are; nothing is added or removed. */
function placed<T>(items: Record<string, T>, places: Record<string, Partial<T>>): Record<string, T> {
    const next = { ...items };
    for (const [id, place] of Object.entries(places)) {
        if (next[id]) {
            next[id] = { ...next[id], ...place };
        }
    }
    return next;
}

export function createCanvasLayoutsSlice(set: CanvasSet, get: CanvasGet): Pick<CanvasState, 'saveLayout' | 'putLayout' | 'applyLayout' | 'deleteLayout'> {
    return {
        saveLayout(name) {
            const s = get();
            const layout: ProjectLayout = {
                name,
                nodes: Object.fromEntries(Object.values(s.nodes).map((node) => [node.id, { x: node.x, y: node.y, w: node.w, h: node.h }])),
                texts: Object.fromEntries(Object.values(s.texts).map((text) => [text.id, { x: text.x, y: text.y }]))
            };
            get().putLayout(layout);
        },
        putLayout(layout) {
            set((s) => ({ layouts: [...s.layouts.filter((entry) => entry.name !== layout.name), layout] }));
        },
        applyLayout(name) {
            const s = get();
            const layout = s.layouts.find((entry) => entry.name === name);
            if (!layout) {
                return;
            }
            set({ nodes: placed(s.nodes, layout.nodes), texts: placed(s.texts, layout.texts), ...remember(s) });
        },
        deleteLayout(name) {
            set((s) => ({ layouts: s.layouts.filter((entry) => entry.name !== name) }));
        }
    };
}
