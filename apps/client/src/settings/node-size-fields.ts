import { NODE_SIZE, NODE_SIZE_MAX, NODE_SIZE_MIN, type NodeKind, type NodeSize } from '@ruimte/contracts';

export type NodeSide = keyof NodeSize;

type SideProblem = 'notWhole' | 'tooSmall' | 'tooLarge';

type SideReading = { ok: true; value: number } | { ok: false; problem: SideProblem };

/* What a person typed for one side of a default size, held to the bounds the machine accepts. */
export function readNodeSide(text: string, side: NodeSide): SideReading {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) {
        return { ok: false, problem: 'notWhole' };
    }
    const value = Number(trimmed);
    if (value < NODE_SIZE_MIN[side]) {
        return { ok: false, problem: 'tooSmall' };
    }
    if (value > NODE_SIZE_MAX) {
        return { ok: false, problem: 'tooLarge' };
    }
    return { ok: true, value };
}

/* What `endpoint.setNodeSize` gets for a kind: null for its built-in size, so the kind goes back to following it. */
export function storedNodeSize(kind: NodeKind, size: NodeSize): NodeSize | null {
    const builtIn = NODE_SIZE[kind];
    return size.w === builtIn.w && size.h === builtIn.h ? null : size;
}
