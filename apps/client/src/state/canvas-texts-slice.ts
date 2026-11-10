import { snapToGrid } from '@/canvas-model/math';
import type { CanvasState } from '@/state/canvas';
import { droppedIntoGroups, nextId, remember, type CanvasSet, type TextElement } from '@/state/canvas-model';

export function createCanvasTextsSlice(set: CanvasSet): Pick<CanvasState, 'addText' | 'updateText' | 'styleText' | 'resizeText' | 'setEditingText'> {
    const patchText = (id: string, patch: Partial<TextElement>, undoable: boolean): void => {
        set((s) => (s.texts[id] ? { texts: { ...s.texts, [id]: { ...s.texts[id], ...patch } }, ...(undoable ? remember(s) : {}) } : {}));
    };

    return {
        addText(at) {
            const id = nextId('text');
            const text: TextElement = { id, x: snapToGrid(at.x), y: snapToGrid(at.y), text: '', size: 18 };
            set((s) => {
                const texts = { ...s.texts, [id]: text };
                return { texts, nodes: droppedIntoGroups({ ...s, texts }, [id]), selection: [id], editingTextId: id, ...remember(s) };
            });
            return id;
        },
        updateText(id, text) {
            patchText(id, { text }, false);
        },
        styleText(id, patch, undoable = true) {
            patchText(id, patch, undoable);
        },
        resizeText(id, x, maxWidth, undoable = true) {
            patchText(id, { x, maxWidth }, undoable);
        },
        setEditingText(id) {
            set({ editingTextId: id });
        }
    };
}
