/* How a set of ids meets what is already selected. */
export type SelectionMode = 'replace' | 'add' | 'toggle';

/*
 * Shift-clicking something that is already selected takes it out again, which is what a person
 * expects of shift and what makes a canvas and a drawing answer the same. A box drawn with shift
 * only ever adds: dragging one over what is already selected must not clear it.
 */
export const mergeSelection = (current: readonly string[], ids: readonly string[], mode: SelectionMode): string[] => {
    if (mode === 'replace') {
        return [...ids];
    }
    const next = new Set(current);
    for (const id of ids) {
        if (mode === 'toggle' && next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
    }
    return [...next];
};
