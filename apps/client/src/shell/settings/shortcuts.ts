interface Shortcut {
    /* Chord parts separated by a space, `⇧ ⌘ Z`; each part becomes its own key cap. */
    keys: string;
    label: string;
}

interface ShortcutGroup {
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
        title: 'Views',
        shortcuts: [
            { keys: '⌘ 1', label: 'Go to the first view, up to ⌘ 9 for the ninth' },
            { keys: '⇧ ⌘ [', label: 'Previous view' },
            { keys: '⇧ ⌘ ]', label: 'Next view' },
            { keys: '⌘ T', label: 'New canvas view' },
            { keys: 'F2', label: 'Rename the view or node the sidebar has focus on' }
        ]
    },
    {
        /*
         * The one place a bare letter is a chord: a drawing has the keyboard the way a terminal has
         * it, and the tools are the letters every sketching app uses. They never fire while a text
         * is being edited or a dialog is up.
         */
        title: 'Drawing',
        shortcuts: [
            { keys: 'V', label: 'Select (1)' },
            { keys: 'H', label: 'Pan (hand)' },
            { keys: 'R', label: 'Rectangle (2)' },
            { keys: 'D', label: 'Diamond (3)' },
            { keys: 'O', label: 'Ellipse (4)' },
            { keys: 'A', label: 'Arrow (5)' },
            { keys: 'L', label: 'Line (6)' },
            { keys: 'P', label: 'Freehand (7)' },
            { keys: 'T', label: 'Text (8)' },
            { keys: 'E', label: 'Eraser (0)' },
            { keys: 'Q', label: 'Keep the tool after a shape' },
            { keys: '⇧ ⌘ L', label: 'Lock or unlock the selection' },
            { keys: '⌘ D', label: 'Duplicate the selection' },
            { keys: '⌘ ]', label: 'Bring to front' },
            { keys: '⌘ [', label: 'Send to back' },
            { keys: '⌘ drag', label: 'Invert the grid snapping setting' }
        ]
    },
    {
        title: 'Panels',
        shortcuts: [{ keys: '⌘ ⌥ B', label: 'Toggle the panel that was open last' }]
    },
    {
        title: 'Nodes',
        shortcuts: [
            { keys: 'Tab', label: 'Move focus to the next node' },
            { keys: '↵', label: 'Step into the focused node' },
            { keys: 'Esc', label: 'Return from a node to the canvas, except from a terminal, which hands Escape to the program it runs' },
            { keys: '⌘ Esc', label: 'Leave a terminal node (⌃ ⇧ Esc on Windows and Linux)' }
        ]
    },
    {
        title: 'Terminal on macOS',
        shortcuts: [
            { keys: '⌘ ←', label: 'Move to the beginning of the line' },
            { keys: '⌘ →', label: 'Move to the end of the line' },
            { keys: '⌥ ←', label: 'Move back one word' },
            { keys: '⌥ →', label: 'Move forward one word' },
            { keys: '⌘ ⌫', label: 'Delete to the beginning of the line' }
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
