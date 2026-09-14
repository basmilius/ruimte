import { CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { CLEAR_SHORTCUT, LEAVE_NODE_SHORTCUT, platformShortcut } from '@/terminal/keymap';
import { KEY_SHORTCUTS, shortcut, shortcutParts, type Shortcut } from '@/ui/shortcut';

export interface ShortcutRow {
    keys: Shortcut;
    /* The pointer gesture the keys go with, printed as a cap after them: "drag", "scroll", "click". */
    then?: string;
    label: string;
}

export interface ShortcutGroup {
    title: string;
    shortcuts: ShortcutRow[];
}

const MOD_HELD = shortcut('Mod');

/*
 * The shortcuts the handlers bind directly and that no command in `commands.ts` names, per platform.
 * The list is by hand on purpose: the handlers are chains of conditions, not one table.
 */
export const shortcutGroups = (apple: boolean): ShortcutGroup[] => [
    {
        title: 'Canvas',
        shortcuts: [
            { keys: APP_SHORTCUTS.palette, label: 'Command palette' },
            { keys: APP_SHORTCUTS.findInFiles, label: 'Find in files' },
            { keys: shortcut('Space'), then: 'drag', label: 'Pan the canvas' },
            { keys: MOD_HELD, then: 'scroll', label: 'Zoom around the pointer' },
            { keys: CANVAS_SHORTCUTS.zoomIn, label: 'Zoom in' },
            { keys: CANVAS_SHORTCUTS.zoomOut, label: 'Zoom out' },
            { keys: CANVAS_SHORTCUTS.undo, label: 'Undo' },
            { keys: CANVAS_SHORTCUTS.redo, label: 'Redo' }
        ]
    },
    {
        title: 'Selection',
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.selectAll, label: 'Select everything' },
            { keys: KEY_SHORTCUTS.shift, then: 'click', label: 'Add to the selection' },
            { keys: CANVAS_SHORTCUTS.deleteSelection, label: 'Delete the selection' },
            { keys: KEY_SHORTCUTS.escape, label: 'Clear the selection, or leave the node you are in' }
        ]
    },
    {
        title: 'Views',
        shortcuts: [
            { keys: viewShortcut(0)!, label: 'Go to view 1 to 9' },
            { keys: CANVAS_SHORTCUTS.previousView, label: 'Previous view' },
            { keys: CANVAS_SHORTCUTS.nextView, label: 'Next view' },
            { keys: CANVAS_SHORTCUTS.newView, label: 'New canvas view' },
            { keys: shortcut('F2'), label: 'Rename the focused sidebar item' }
        ]
    },
    {
        title: 'Split',
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.splitRight, label: 'Split the cell to the right' },
            { keys: CANVAS_SHORTCUTS.splitDown, label: 'Split the cell down' },
            { keys: FOCUS_SHORTCUTS.left, label: 'Focus the neighboring cell (any arrow key)' },
            { keys: CANVAS_SHORTCUTS.closeCell, label: 'Close the focused cell' }
        ]
    },
    {
        /*
         * The one place a bare letter is a shortcut: a drawing has the keyboard the way a terminal has
         * it, and the tools are the letters every sketching app uses. They never fire while a text
         * is being edited or a dialog is up.
         */
        title: 'Drawing',
        shortcuts: [
            { keys: shortcut('V'), label: 'Select (1)' },
            { keys: shortcut('H'), label: 'Pan (hand)' },
            { keys: shortcut('R'), label: 'Rectangle (2)' },
            { keys: shortcut('D'), label: 'Diamond (3)' },
            { keys: shortcut('O'), label: 'Ellipse (4)' },
            { keys: shortcut('A'), label: 'Arrow (5)' },
            { keys: shortcut('L'), label: 'Line (6)' },
            { keys: shortcut('P'), label: 'Freehand (7)' },
            { keys: shortcut('T'), label: 'Text (8)' },
            { keys: shortcut('E'), label: 'Eraser (0)' },
            { keys: shortcut('Q'), label: 'Keep the tool selected after drawing' },
            { keys: DRAWING_SHORTCUTS.lock, label: 'Lock or unlock the selection' },
            { keys: DRAWING_SHORTCUTS.duplicate, label: 'Duplicate the selection' },
            { keys: DRAWING_SHORTCUTS.bringToFront, label: 'Bring to front' },
            { keys: DRAWING_SHORTCUTS.sendToBack, label: 'Send to back' },
            { keys: MOD_HELD, then: 'drag', label: 'Toggle grid snapping while dragging' },
            { keys: DRAWING_SHORTCUTS.copy, label: 'Copy the selection' },
            { keys: DRAWING_SHORTCUTS.paste, label: 'Paste into the drawing' }
        ]
    },
    {
        title: 'Panels',
        shortcuts: [{ keys: CANVAS_SHORTCUTS.togglePanel, label: 'Toggle the last open panel' }]
    },
    {
        title: 'Nodes',
        shortcuts: [
            { keys: shortcut('Tab'), label: 'Move focus to the next node' },
            { keys: KEY_SHORTCUTS.enter, label: 'Step into the focused node' },
            { keys: KEY_SHORTCUTS.escape, label: 'Return to the canvas (a terminal passes Escape to its program)' },
            { keys: platformShortcut(LEAVE_NODE_SHORTCUT, apple), label: 'Leave a terminal node' }
        ]
    },
    {
        /*
         * A focused terminal keeps every shortcut that is not in this file's Views, Split or Panels group,
         * so a program sees the keyboard the way it would in a native terminal. That is why the clear
         * shortcut here is the palette's everywhere else on macOS. The line motions are what macOS gives
         * every native terminal, so only macOS lists them.
         */
        title: 'Terminal',
        shortcuts: [
            { keys: platformShortcut(CLEAR_SHORTCUT, apple), label: 'Clear the screen and the scrollback' },
            ...(apple
                ? [
                      { keys: shortcut('Meta+ArrowLeft'), label: 'Move to the beginning of the line' },
                      { keys: shortcut('Meta+ArrowRight'), label: 'Move to the end of the line' },
                      { keys: shortcut('Alt+ArrowLeft'), label: 'Move back one word' },
                      { keys: shortcut('Alt+ArrowRight'), label: 'Move forward one word' },
                      { keys: shortcut('Meta+Backspace'), label: 'Delete to the beginning of the line' }
                  ]
                : [])
        ]
    }
];

/* Commands that carry a shortcut become the first group. */
export const commandShortcuts = (commands: ReadonlyArray<{ label: string; shortcut?: Shortcut }>): ShortcutGroup => ({
    title: 'Commands',
    shortcuts: commands.flatMap((command) => (command.shortcut ? [{ keys: command.shortcut, label: command.label }] : []))
});

/* What a search can match on: the keys as printed together (`⌘z`) and as written out (`ctrl+z`). */
const searchableKeys = (row: ShortcutRow, apple: boolean): string[] => {
    const parts = [...shortcutParts(row.keys, apple), ...(row.then ? [row.then] : [])].map((part) => part.toLowerCase());
    return [parts.join(''), parts.join('+')];
};

/* Case-insensitive match on the label or the keys; empty groups drop out so nothing shows a bare header. */
export const filterShortcuts = (groups: readonly ShortcutGroup[], query: string, apple: boolean): ShortcutGroup[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...groups];
    }
    const keysNeedle = needle.replace(/ /g, '');
    return groups
        .map((group) => ({
            title: group.title,
            shortcuts: group.shortcuts.filter(
                (row) => row.label.toLowerCase().includes(needle) || searchableKeys(row, apple).some((keys) => keys.includes(keysNeedle))
            )
        }))
        .filter((group) => group.shortcuts.length > 0);
};
