import { NodeKindSchema, type NodeKind } from './project.ts';
export { NODE_ACCENT_NAMES, type NodeAccent, type NotePaper, isNodeAccent, notePaperOf, nodeColorOf, nodeColorPatch } from './node-accents.ts';

export interface NodeSize {
    w: number;
    h: number;
}

/* The sizes a person on a machine chose for a kind, which only holds the kinds they changed. */
export type NodeSizes = Partial<Record<NodeKind, NodeSize>>;

/* What a node of each kind starts out as, also when it comes back from a view of its own. Shared,
   so a node the daemon adds for an agent is the size a person's click would have made. A machine's
   own size for a kind goes first (`nodeSizeOf`); these are what a kind falls back to. */
export const NODE_SIZE: Record<NodeKind, NodeSize> = {
    terminal: { w: 560, h: 360 },
    chat: { w: 480, h: 520 },
    browser: { w: 720, h: 480 },
    device: { w: 360, h: 720 },
    group: { w: 800, h: 600 },
    note: { w: 320, h: 240 },
    drawing: { w: 480, h: 360 },
    diagram: { w: 480, h: 360 },
    file: { w: 520, h: 420 },
    artifact: { w: 440, h: 520 },
    routine: { w: 400, h: 560 },
    design: { w: 480, h: 640 }
};

/* The smallest node a person can drag a frame down to, so a default size never makes one smaller. */
export const NODE_SIZE_MIN: NodeSize = { w: 240, h: 160 };

/* The largest a default size may be on either side; a frame bigger than this stores this. */
export const NODE_SIZE_MAX = 4000;

/* The size a new node of a kind takes on a machine: the person's own, else the built-in one. */
export function nodeSizeOf(sizes: NodeSizes | undefined, kind: NodeKind): NodeSize {
    return sizes?.[kind] ?? NODE_SIZE[kind];
}

/* A frame as a default size: whole pixels, within the bounds a default may have. */
export function fitNodeSize(size: NodeSize): NodeSize {
    const fit = (value: number, min: number): number => Math.min(NODE_SIZE_MAX, Math.max(min, Math.round(value)));
    return { w: fit(size.w, NODE_SIZE_MIN.w), h: fit(size.h, NODE_SIZE_MIN.h) };
}

function isDefaultSize(value: unknown): value is NodeSize {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const { w, h } = value as Record<string, unknown>;
    const within = (side: unknown, min: number): boolean => Number.isInteger(side) && (side as number) >= min && (side as number) <= NODE_SIZE_MAX;
    return within(w, NODE_SIZE_MIN.w) && within(h, NODE_SIZE_MIN.h);
}

/*
 * The sizes of the kinds this version knows, read from a file or a reply. A newer machine may name a
 * kind this one has never seen, and one size that does not read must not take the others with it.
 */
export function knownNodeSizes(raw: unknown): NodeSizes {
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }
    const sizes: NodeSizes = {};
    for (const kind of NodeKindSchema.options) {
        const size = (raw as Record<string, unknown>)[kind];
        if (isDefaultSize(size)) {
            sizes[kind] = { w: size.w, h: size.h };
        }
    }
    return sizes;
}

/* The room a group keeps around what it holds, and the band its title bar takes. Shared, because a
   node the daemon puts in a group has to land where a person's own grouping would have put it. */
export const GROUP_PADDING = 32;
export const GROUP_HEADER = 40;

/* The pixels a canvas snaps to, the client's own grid, shared for the same reason. */
export const CANVAS_GRID = 8;

export interface NodeRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function snap(value: number): number {
    return Math.round(value / CANVAS_GRID) * CANVAS_GRID;
}

// The client's grouping and the daemon's `node group` both run this, so an agent's frame lands where a person's would.
export function groupFrame(members: readonly NodeRect[]): NodeRect | null {
    if (members.length === 0) {
        return null;
    }
    const left = Math.min(...members.map((member) => member.x));
    const top = Math.min(...members.map((member) => member.y));
    const width = Math.max(...members.map((member) => member.x + member.w)) - left;
    const height = Math.max(...members.map((member) => member.y + member.h)) - top;
    return {
        x: snap(left - GROUP_PADDING),
        y: snap(top - GROUP_PADDING - GROUP_HEADER),
        w: snap(width + GROUP_PADDING * 2),
        h: snap(height + GROUP_PADDING * 2 + GROUP_HEADER)
    };
}

/* What saying which things a group holds needs of it, so a frame that is not a node yet also fits. */
export interface GroupFrame extends NodeRect {
    id: string;
    collapsed?: boolean;
    memberIds?: readonly string[];
    expandedHeight?: number;
}

/* A thing on a canvas a group can hold: a node counts by its center, a text by the point it sits on. */
export interface GroupItem {
    id: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
}

// A collapsed group is measured at the height it opens to, since its members keep their places.
export function groupRect(group: Omit<GroupFrame, 'id'>): NodeRect {
    return {
        x: group.x,
        y: group.y,
        w: group.w,
        h: group.collapsed === true ? (group.expandedHeight ?? group.h) : group.h
    };
}

function holds(rect: NodeRect, item: GroupItem): boolean {
    const x = item.x + (item.w ?? 0) / 2;
    const y = item.y + (item.h ?? 0) / 2;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/*
 * Open, membership is read off the positions; collapsed, the file spells it out, since the members sit
 * nowhere near the header. Only ids still present come back.
 */
export function groupMemberIds(group: GroupFrame, items: readonly GroupItem[]): string[] {
    if (group.collapsed === true) {
        const ids = new Set(group.memberIds ?? []);
        return items.filter((item) => ids.has(item.id)).map((item) => item.id);
    }
    const rect = groupRect(group);
    return items.filter((item) => item.id !== group.id && holds(rect, item)).map((item) => item.id);
}

// The room between a node and the one placed next to it; a multiple of the client's 8 px grid.
export const PLACEMENT_GAP = 40;

/* Contracts cannot import the action catalog, so the layouts are named here as well; `node.arrange` takes the same three. */
export type ArrangeLayout = 'grid' | 'row' | 'column';

/* How many columns a grid takes without being told: as square as the count allows. */
export function gridColumns(count: number): number {
    return Math.ceil(Math.sqrt(count));
}

/*
 * The rectangles tidied into a block from the top left of the box they already occupy, so a canvas
 * is straightened where it stands. Columns and rows take their widest and tallest node, so nodes of
 * different sizes never touch and none is resized.
 */
export function arrangeRects(rects: readonly NodeRect[], layout: ArrangeLayout, cols?: number): NodeRect[] {
    if (rects.length === 0) {
        return [];
    }
    const columns = layout === 'row' ? rects.length : layout === 'column' ? 1 : Math.min(cols ?? gridColumns(rects.length), rects.length);
    const origin = {
        x: Math.round(Math.min(...rects.map((rect) => rect.x))),
        y: Math.round(Math.min(...rects.map((rect) => rect.y)))
    };
    const columnOf = (index: number): number => index % columns;
    const rowOf = (index: number): number => Math.floor(index / columns);
    const widths: number[] = [];
    const heights: number[] = [];
    for (const [index, rect] of rects.entries()) {
        widths[columnOf(index)] = Math.max(widths[columnOf(index)] ?? 0, rect.w);
        heights[rowOf(index)] = Math.max(heights[rowOf(index)] ?? 0, rect.h);
    }
    const offsets = (sizes: readonly number[]): number[] => {
        const places: number[] = [];
        let at = 0;
        for (const size of sizes) {
            places.push(at);
            at += size + PLACEMENT_GAP;
        }
        return places;
    };
    const left = offsets(widths);
    const top = offsets(heights);
    return rects.map((rect, index) => ({
        x: Math.round(origin.x + left[columnOf(index)]!),
        y: Math.round(origin.y + top[rowOf(index)]!),
        w: rect.w,
        h: rect.h
    }));
}

/* What a node of each kind is called before anything names it. */
export const DEFAULT_TITLES: Record<NodeKind, string> = {
    terminal: 'Terminal',
    chat: 'New chat',
    browser: 'Browser',
    device: 'Simulator',
    group: 'Group',
    drawing: 'Drawing',
    diagram: 'Diagram',
    note: 'Note',
    file: 'File',
    artifact: 'Output',
    routine: 'Routine',
    design: 'Design'
};
