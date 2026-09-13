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
