export interface Shortcut {
    /* Chord parts separated by a space, `⇧ ⌘ Z`; each part becomes its own key cap. */
    keys: string;
    label: string;
}

export interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
}

/*
 * The chords `Canvas.tsx` binds directly and that no command in `commands.ts` names. The list
 * is by hand on purpose: the handler is a chain of conditions, not a table.
 */
export const CANVAS_SHORTCUTS: readonly ShortcutGroup[] = [
    {
        title: 'Canvas',
        shortcuts: [
            { keys: '⌘ K', label: 'Command palette' },
            { keys: 'Space drag', label: 'Pan the canvas' },
            { keys: '⌘ scroll', label: 'Zoom around the pointer' },
            { keys: '+', label: 'Zoom in' },
            { keys: '-', label: 'Zoom out' },
            { keys: '⌘ Z', label: 'Undo' },
            { keys: '⇧ ⌘ Z', label: 'Redo' }
        ]
    },
    {
        title: 'Selection',
        shortcuts: [
            { keys: '⌘ A', label: 'Select everything' },
            { keys: '⇧ click', label: 'Add to the selection' },
            { keys: '⌫', label: 'Delete the selection' },
            { keys: 'Esc', label: 'Clear the selection, or leave the node you are in' }
        ]
    },
    {
        title: 'Nodes',
        shortcuts: [
            { keys: 'Tab', label: 'Move focus to the next node' },
            { keys: '↵', label: 'Step into the focused node' },
            { keys: 'Esc', label: 'Return from a node to the canvas' }
        ]
    }
];

/* Commands that carry a chord become the first group; the palette prints them as `⌥T`, here each key stands alone. */
export const commandShortcuts = (commands: ReadonlyArray<{ label: string; shortcut?: string }>): ShortcutGroup => ({
    title: 'Commands',
    shortcuts: commands
        .filter((command): command is { label: string; shortcut: string } => typeof command.shortcut === 'string')
        .map((command) => ({ keys: spaceOutChord(command.shortcut), label: command.label }))
});

const MODIFIERS = ['⌘', '⌥', '⇧', '⌃'];

const spaceOutChord = (chord: string): string => {
    const parts: string[] = [];
    let rest = chord;
    while (rest.length > 0 && MODIFIERS.includes(rest[0]!)) {
        parts.push(rest[0]!);
        rest = rest.slice(1);
    }
    if (rest) {
        parts.push(rest);
    }
    return parts.join(' ');
};

/* Case-insensitive match on the label or the keys; empty groups drop out so nothing shows a bare header. */
export const filterShortcuts = (groups: readonly ShortcutGroup[], query: string): ShortcutGroup[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...groups];
    }
    return groups
        .map((group) => ({
            title: group.title,
            shortcuts: group.shortcuts.filter(
                (shortcut) => shortcut.label.toLowerCase().includes(needle) || shortcut.keys.toLowerCase().replace(/ /g, '').includes(needle.replace(/ /g, ''))
            )
        }))
        .filter((group) => group.shortcuts.length > 0);
};
