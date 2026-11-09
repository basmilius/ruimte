import type { ProjectCanvasLine } from '@ruimte/contracts';
import { snapLine } from '@/canvas-model/line-geometry';
import type { CanvasState } from '@/state/canvas';
import { droppedIntoGroups, nextId, remember, type CanvasGet, type CanvasSet } from '@/state/canvas-model';

type CanvasLineStyle = Pick<ProjectCanvasLine, 'stroke' | 'strokeWidth' | 'strokeStyle' | 'arrowStart' | 'arrowEnd'>;
export const DEFAULT_LINE_STYLE: CanvasLineStyle = { stroke: 'ink', strokeWidth: 2, strokeStyle: 'solid' };

export function createCanvasLinesSlice(set: CanvasSet, get: CanvasGet): Pick<CanvasState, 'setLineTool' | 'addLine' | 'updateLine' | 'duplicateLine'> {
    return {
        setLineTool(lineTool) {
            set({ lineTool, selection: [], bodyFocusId: null, editingTextId: null });
        },
        addLine(line) {
            const snapped = snapLine(line);
            if (get().viewId === null || Math.hypot(snapped.endX - snapped.x, snapped.endY - snapped.y) < 2) {
                return null;
            }
            const id = nextId('line');
            set((s) => {
                const lines = { ...s.lines, [id]: { ...snapped, id } };
                return { lines, nodes: droppedIntoGroups({ ...s, lines }, [id]), linesPresent: true, selection: [id], lineTool: null, ...remember(s) };
            });
            return id;
        },
        updateLine(id, patch, undoable = true) {
            set((s) => {
                if (!s.lines[id]) {
                    return {};
                }
                const line = { ...s.lines[id], ...patch };
                const geometry = patch.x !== undefined || patch.y !== undefined || patch.endX !== undefined || patch.endY !== undefined;
                return { lines: { ...s.lines, [id]: geometry ? snapLine(line) : line }, ...(undoable ? remember(s) : {}) };
            });
        },
        duplicateLine(id) {
            const line = get().lines[id];
            if (line) {
                get().addLine({ ...line, x: line.x + 24, y: line.y + 24, endX: line.endX + 24, endY: line.endY + 24 });
            }
        }
    };
}
