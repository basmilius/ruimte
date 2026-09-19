import i18next from 'i18next';
import { CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import { PROMPT_SHORTCUTS } from '@/prompts/logic/keys';
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

/* The words of one row, read while the list is built rather than when this file loads. */
const say = (key: string): string => i18next.t(`settings:shortcuts.${key}`);

/*
 * The shortcuts the handlers bind directly and that no command in `commands.ts` names, per platform.
 * The list is by hand on purpose: the handlers are chains of conditions, not one table.
 */
export const shortcutGroups = (apple: boolean): ShortcutGroup[] => [
    {
        title: say('canvas.title'),
        shortcuts: [
            { keys: APP_SHORTCUTS.palette, label: say('canvas.palette') },
            { keys: APP_SHORTCUTS.findInFiles, label: say('canvas.findInFiles') },
            { keys: shortcut('Space'), then: i18next.t('settings:gesture.drag'), label: say('canvas.pan') },
            { keys: MOD_HELD, then: i18next.t('settings:gesture.scroll'), label: say('canvas.zoomPointer') },
            { keys: CANVAS_SHORTCUTS.zoomIn, label: say('canvas.zoomIn') },
            { keys: CANVAS_SHORTCUTS.zoomOut, label: say('canvas.zoomOut') },
            { keys: CANVAS_SHORTCUTS.undo, label: say('canvas.undo') },
            { keys: CANVAS_SHORTCUTS.redo, label: say('canvas.redo') }
        ]
    },
    {
        title: say('selection.title'),
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.selectAll, label: say('selection.selectAll') },
            { keys: KEY_SHORTCUTS.shift, then: i18next.t('settings:gesture.click'), label: say('selection.add') },
            { keys: CANVAS_SHORTCUTS.deleteSelection, label: say('selection.delete') },
            { keys: KEY_SHORTCUTS.escape, label: say('selection.escape') }
        ]
    },
    {
        title: say('views.title'),
        shortcuts: [
            { keys: viewShortcut(0)!, label: say('views.goTo') },
            { keys: CANVAS_SHORTCUTS.previousView, label: say('views.previous') },
            { keys: CANVAS_SHORTCUTS.nextView, label: say('views.next') },
            { keys: CANVAS_SHORTCUTS.newView, label: say('views.new') },
            { keys: shortcut('F2'), label: say('views.rename') }
        ]
    },
    {
        title: say('split.title'),
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.splitRight, label: say('split.right') },
            { keys: CANVAS_SHORTCUTS.splitDown, label: say('split.down') },
            { keys: FOCUS_SHORTCUTS.left, label: say('split.focusNeighbor') },
            { keys: CANVAS_SHORTCUTS.closeCell, label: say('split.close') }
        ]
    },
    {
        /*
         * The one place a bare letter is a shortcut: a drawing has the keyboard the way a terminal has
         * it, and the tools are the letters every sketching app uses. They never fire while a text
         * is being edited or a dialog is up.
         */
        title: say('drawing.title'),
        shortcuts: [
            { keys: shortcut('V'), label: say('drawing.select') },
            { keys: shortcut('H'), label: say('drawing.hand') },
            { keys: shortcut('R'), label: say('drawing.rectangle') },
            { keys: shortcut('D'), label: say('drawing.diamond') },
            { keys: shortcut('O'), label: say('drawing.ellipse') },
            { keys: shortcut('A'), label: say('drawing.arrow') },
            { keys: shortcut('L'), label: say('drawing.line') },
            { keys: shortcut('P'), label: say('drawing.freehand') },
            { keys: shortcut('T'), label: say('drawing.text') },
            { keys: shortcut('E'), label: say('drawing.eraser') },
            { keys: shortcut('Q'), label: say('drawing.keepTool') },
            { keys: DRAWING_SHORTCUTS.lock, label: say('drawing.lock') },
            { keys: DRAWING_SHORTCUTS.duplicate, label: say('drawing.duplicate') },
            { keys: DRAWING_SHORTCUTS.bringToFront, label: say('drawing.bringToFront') },
            { keys: DRAWING_SHORTCUTS.sendToBack, label: say('drawing.sendToBack') },
            { keys: MOD_HELD, then: i18next.t('settings:gesture.drag'), label: say('drawing.snap') },
            { keys: DRAWING_SHORTCUTS.copy, label: say('drawing.copy') },
            { keys: DRAWING_SHORTCUTS.paste, label: say('drawing.paste') }
        ]
    },
    {
        title: say('panels.title'),
        shortcuts: [{ keys: CANVAS_SHORTCUTS.togglePanel, label: say('panels.toggle') }]
    },
    {
        title: say('prompts.title'),
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.focusPrompts, label: say('prompts.answerFront') },
            { keys: PROMPT_SHORTCUTS.primary, label: say('prompts.primary') },
            { keys: PROMPT_SHORTCUTS.previousPrompt, label: say('prompts.previous') },
            { keys: PROMPT_SHORTCUTS.nextPrompt, label: say('prompts.next') },
            { keys: KEY_SHORTCUTS.escape, label: say('prompts.escape') }
        ]
    },
    {
        title: say('chat.title'),
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.previousMessage, label: say('chat.previousMessage') },
            { keys: CANVAS_SHORTCUTS.nextMessage, label: say('chat.nextMessage') }
        ]
    },
    {
        title: say('browser.title'),
        shortcuts: [
            { keys: CANVAS_SHORTCUTS.browserBack, label: say('browser.back') },
            { keys: CANVAS_SHORTCUTS.browserForward, label: say('browser.forward') }
        ]
    },
    {
        title: say('nodes.title'),
        shortcuts: [
            { keys: shortcut('Tab'), label: say('nodes.nextNode') },
            { keys: KEY_SHORTCUTS.enter, label: say('nodes.select') },
            { keys: KEY_SHORTCUTS.escape, label: say('nodes.escape') },
            { keys: platformShortcut(LEAVE_NODE_SHORTCUT, apple), label: say('nodes.leave') }
        ]
    },
    {
        /*
         * A focused terminal keeps every shortcut that is not in this file's Views, Split or Panels group,
         * so a program sees the keyboard the way it would in a native terminal. That is why the clear
         * shortcut here is the palette's everywhere else on macOS. The line motions are what macOS gives
         * every native terminal, so only macOS lists them.
         */
        title: say('terminal.title'),
        shortcuts: [
            { keys: platformShortcut(CLEAR_SHORTCUT, apple), label: say('terminal.clear') },
            ...(apple
                ? [
                      { keys: shortcut('Meta+ArrowLeft'), label: say('terminal.lineStart') },
                      { keys: shortcut('Meta+ArrowRight'), label: say('terminal.lineEnd') },
                      { keys: shortcut('Alt+ArrowLeft'), label: say('terminal.wordBack') },
                      { keys: shortcut('Alt+ArrowRight'), label: say('terminal.wordForward') },
                      { keys: shortcut('Meta+Backspace'), label: say('terminal.deleteToLineStart') }
                  ]
                : [])
        ]
    }
];

/* Commands that carry a shortcut become the first group. */
export const commandShortcuts = (commands: ReadonlyArray<{ label: string; shortcut?: Shortcut }>): ShortcutGroup => ({
    title: say('commands.title'),
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
