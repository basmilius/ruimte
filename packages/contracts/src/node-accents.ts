/* The shared picker order; clients supply the colors and the daemon validates these names. */
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

export function isNodeAccent(name: unknown): name is NodeAccent {
    return (NODE_ACCENT_NAMES as readonly unknown[]).includes(name);
}

/*
 * Before Color covered notes, a note had a paper of its own in `color`. Four of those papers are
 * accents by the same name; gray has none, so it keeps a neutral paper of its own until a person
 * picks a Color.
 */
const LEGACY_NOTE_PAPERS: Record<string, NotePaper> = { yellow: 'yellow', green: 'green', blue: 'blue', pink: 'pink', gray: 'neutral' };

export type NotePaper = NodeAccent | 'neutral';

/*
 * The paper a note shows, null for the default. A legacy `color` wins over an accent, so a project
 * keeps the look it had: an accent picked while Color still did nothing on a note stays out of
 * sight until the next pick, which removes `color` (see `nodeColorPatch`). An unknown name counts
 * for nothing and stays in the file.
 */
export function notePaperOf(node: { accent?: string; color?: string }): NotePaper | null {
    if (node.color !== undefined && Object.hasOwn(LEGACY_NOTE_PAPERS, node.color)) {
        return LEGACY_NOTE_PAPERS[node.color]!;
    }
    return isNodeAccent(node.accent) ? node.accent : null;
}

/* The color a node shows: the paper of a note, the accent of any other node. */
export function nodeColorOf(node: { kind: string; accent?: string; color?: string }): NotePaper | null {
    if (node.kind === 'note') {
        return notePaperOf(node);
    }
    return isNodeAccent(node.accent) ? node.accent : null;
}

/*
 * What picking a Color writes on a node. A note loses its legacy `color` on every pick, None too,
 * so what a person picks is what the note shows and None never falls back to an old paper.
 * `undefined` removes the key.
 */
export function nodeColorPatch(node: { kind: string }, accent: NodeAccent | null): { accent?: NodeAccent; color?: undefined } {
    return node.kind === 'note' ? { accent: accent ?? undefined, color: undefined } : { accent: accent ?? undefined };
}
