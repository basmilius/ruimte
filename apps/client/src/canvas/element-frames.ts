import type { CanvasState } from '@/state/canvas';
import type { GapNode } from '@/canvas/editable-gaps';
import { lineBounds } from '@/canvas/line-geometry';

export function gapFrames(state: Pick<CanvasState, 'nodes' | 'lines' | 'hidden'>): Record<string, GapNode> {
    const frames: Record<string, GapNode> = {};

    for (const id in state.nodes) {
        if (!Object.hasOwn(state.nodes, id)) {
            continue;
        }

        const node = state.nodes[id]!;

        if (!state.hidden.has(node.id)) {
            putFrame(frames, node.id, node);
        }
    }

    for (const id in state.lines) {
        if (!Object.hasOwn(state.lines, id)) {
            continue;
        }

        const line = state.lines[id]!;

        if (!state.hidden.has(line.id)) {
            putFrame(frames, line.id, { ...lineBounds(line), id: line.id, kind: 'line' });
        }
    }

    return frames;
}

function putFrame(frames: Record<string, GapNode>, id: string, frame: GapNode): void {
    // Keep Object.fromEntries' own-property behavior for an arbitrary stored id.
    if (id === '__proto__') {
        Object.defineProperty(frames, id, { value: frame, enumerable: true, configurable: true, writable: true });
    } else {
        frames[id] = frame;
    }
}
