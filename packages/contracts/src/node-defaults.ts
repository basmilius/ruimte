import type { NodeKind } from './project.ts';

/* What a node of each kind starts out as, also when it comes back from a view of its own. Shared,
   so a node the daemon adds for an agent is the size a person's click would have made. */
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
    terminal: { w: 560, h: 360 },
    chat: { w: 480, h: 520 },
    browser: { w: 720, h: 480 },
    group: { w: 800, h: 600 },
    note: { w: 320, h: 240 },
    drawing: { w: 480, h: 360 },
    file: { w: 520, h: 420 }
};

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

const snap = (value: number): number => Math.round(value / CANVAS_GRID) * CANVAS_GRID;

/*
 * The frame a group takes around what it holds: room on every side and the title band above it,
 * snapped to the grid. Both the client's own grouping and the daemon's `group` verb run this, so a
 * frame an agent draws sits where a person's drag would have put it. Nothing to hold is no frame.
 */
export const groupFrame = (members: readonly NodeRect[]): NodeRect | null => {
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
};

/*
 * The colors a node's accent and a group's frame pick from, in the hue order the picker draws them
 * in. Shared because both sides need the same closed set: the client paints the swatches and the
 * daemon refuses a `--color` that is not one of them. The hex per name stays in the client
 * (`canvas/accents.ts`), which is the only side that paints.
 */
export const NODE_ACCENT_NAMES = [
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose'
] as const;

export type NodeAccent = (typeof NODE_ACCENT_NAMES)[number];

/* What a node of each kind is called before anything names it. */
export const DEFAULT_TITLES: Record<NodeKind, string> = {
    terminal: 'Terminal',
    chat: 'New chat',
    browser: 'Browser',
    group: 'Group',
    drawing: 'Drawing',
    note: 'Note',
    file: 'File'
};
