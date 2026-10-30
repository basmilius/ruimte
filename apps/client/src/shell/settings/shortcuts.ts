import i18next from 'i18next';
import { CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import { PROMPT_SHORTCUTS } from '@adecore/agents-react/prompts';
import { SEND_AND_NEW_SHORTCUT } from '@adecore/agents-react/chat';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { CLEAR_SHORTCUT, LEAVE_NODE_SHORTCUT, platformShortcut, TERMINAL_FIND_SHORTCUT } from '@/terminal/keymap';
import { KEY_SHORTCUTS, shortcut, shortcutParts, type Shortcut } from '@adecore/ui';

export interface ShortcutRow {
    keys: Shortcut;
    /* The pointer gesture the keys go with, printed as a cap after them: "drag", "scroll", "click". */
    then?: string;
    label: string;
}

/* The categories of the Keyboard pane, in the order it lists them. */
export const KEYBOARD_AREAS = ['general', 'canvas', 'views', 'editor', 'navigation', 'code', 'terminal', 'launches', 'chat', 'drawing', 'browser'] as const;

export type KeyboardArea = (typeof KEYBOARD_AREAS)[number];

export interface ShortcutGroup {
    /* Stable across languages, for a search result that has to find its row again. */
    id: KeyboardArea;
    title: string;
    shortcuts: ShortcutRow[];
}

const MOD_HELD = shortcut('Mod');

/* The words of one row, read while the list is built rather than when this file loads. */
function say(key: string): string {
    return i18next.t(`settings:shortcuts.${key}`);
}

export function areaTitle(area: KeyboardArea): string {
    return say(`areas.${area}`);
}

/*
 * The shortcuts the handlers bind directly and that no command in `commands.ts` names, per platform, in
 * the category of their area. The list is by hand on purpose: the handlers are chains of conditions, not
 * one table. The categories of the editor are not here: `keyboard-groups.ts` builds them from its keymap.
 */
export function shortcutGroups(apple: boolean): ShortcutGroup[] {
    return [
        {
            id: 'general',
            title: areaTitle('general'),
            shortcuts: [
                { keys: APP_SHORTCUTS.palette, label: say('canvas.palette') },
                { keys: APP_SHORTCUTS.findInFiles, label: say('canvas.findInFiles') },
                { keys: CANVAS_SHORTCUTS.voiceControl, label: i18next.t('voice:shortcut') }
            ]
        },
        {
            id: 'canvas',
            title: areaTitle('canvas'),
            shortcuts: [
                { keys: shortcut('Space'), then: i18next.t('settings:gesture.drag'), label: say('canvas.pan') },
                { keys: shortcut('Space'), then: i18next.t('settings:gesture.scroll'), label: say('canvas.pan') },
                { keys: shortcut('Alt'), then: i18next.t('settings:gesture.drag'), label: say('canvas.gaps') },
                { keys: KEY_SHORTCUTS.enter, label: say('canvas.enterNode') },
                { keys: MOD_HELD, then: i18next.t('settings:gesture.scroll'), label: say('canvas.zoomPointer') },
                { keys: CANVAS_SHORTCUTS.zoomIn, label: say('canvas.zoomIn') },
                { keys: CANVAS_SHORTCUTS.zoomOut, label: say('canvas.zoomOut') },
                { keys: CANVAS_SHORTCUTS.undo, label: say('canvas.undo') },
                { keys: CANVAS_SHORTCUTS.redo, label: say('canvas.redo') },
                { keys: CANVAS_SHORTCUTS.selectAll, label: say('selection.selectAll') },
                { keys: KEY_SHORTCUTS.shift, then: i18next.t('settings:gesture.click'), label: say('selection.add') },
                { keys: CANVAS_SHORTCUTS.deleteSelection, label: say('selection.delete') },
                { keys: KEY_SHORTCUTS.escape, label: say('selection.escape') },
                { keys: shortcut('Tab'), label: say('nodes.nextNode') },
                { keys: KEY_SHORTCUTS.enter, label: say('nodes.select') },
                { keys: KEY_SHORTCUTS.escape, label: say('nodes.escape') },
                { keys: platformShortcut(LEAVE_NODE_SHORTCUT, apple), label: say('nodes.leave') }
            ]
        },
        {
            id: 'views',
            title: areaTitle('views'),
            shortcuts: [
                { keys: viewShortcut(0)!, label: say('views.goTo') },
                { keys: CANVAS_SHORTCUTS.previousView, label: say('views.previous') },
                { keys: CANVAS_SHORTCUTS.nextView, label: say('views.next') },
                { keys: CANVAS_SHORTCUTS.newView, label: say('views.new') },
                { keys: shortcut('F2'), label: say('views.rename') },
                { keys: CANVAS_SHORTCUTS.splitRight, label: say('split.right') },
                { keys: CANVAS_SHORTCUTS.splitDown, label: say('split.down') },
                { keys: FOCUS_SHORTCUTS.left, label: say('split.focusNeighbor') },
                { keys: CANVAS_SHORTCUTS.maximizeCell, label: say('split.maximize') },
                { keys: CANVAS_SHORTCUTS.closeCell, label: say('split.close') },
                { keys: CANVAS_SHORTCUTS.togglePanel, label: say('panels.toggle') }
            ]
        },
        {
            /*
             * The one place a bare letter is a shortcut: the tools of a drawing, which never fire while a
             * text is being edited or a dialog is up.
             */
            id: 'drawing',
            title: areaTitle('drawing'),
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
            id: 'launches',
            title: areaTitle('launches'),
            shortcuts: [
                { keys: CANVAS_SHORTCUTS.launchRun, label: say('launches.run') },
                { keys: CANVAS_SHORTCUTS.launchStop, label: say('launches.stop') }
            ]
        },
        {
            id: 'chat',
            title: areaTitle('chat'),
            shortcuts: [
                { keys: CANVAS_SHORTCUTS.focusPrompts, label: say('prompts.answerFront') },
                { keys: CANVAS_SHORTCUTS.nextNeedsYou, label: say('prompts.nextNeedsYou') },
                { keys: CANVAS_SHORTCUTS.attentionQueue, label: say('prompts.attentionQueue') },
                { keys: PROMPT_SHORTCUTS.primary, label: say('prompts.primary') },
                { keys: PROMPT_SHORTCUTS.previousPrompt, label: say('prompts.previous') },
                { keys: PROMPT_SHORTCUTS.nextPrompt, label: say('prompts.next') },
                { keys: KEY_SHORTCUTS.escape, label: say('prompts.escape') },
                { keys: CANVAS_SHORTCUTS.dictation, label: say('chat.dictation') },
                { keys: CANVAS_SHORTCUTS.previousMessage, label: say('chat.previousMessage') },
                { keys: CANVAS_SHORTCUTS.nextMessage, label: say('chat.nextMessage') },
                { keys: SEND_AND_NEW_SHORTCUT, label: say('chat.sendAndNewChat') }
            ]
        },
        {
            id: 'browser',
            title: areaTitle('browser'),
            shortcuts: [
                { keys: CANVAS_SHORTCUTS.browserBack, label: say('browser.back') },
                { keys: CANVAS_SHORTCUTS.browserForward, label: say('browser.forward') }
            ]
        },
        {
            /*
             * A focused terminal keeps every shortcut outside the Views and Launches groups, so a
             * program sees the keyboard as in a native terminal; that is why clear is the palette's key elsewhere
             * on macOS. The line motions are what macOS gives every native terminal, so only macOS lists them.
             */
            id: 'terminal',
            title: areaTitle('terminal'),
            shortcuts: [
                { keys: platformShortcut(CLEAR_SHORTCUT, apple), label: say('terminal.clear') },
                { keys: platformShortcut(TERMINAL_FIND_SHORTCUT, apple), label: say('terminal.find') },
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
}

/* The `searchId` of one row of the Keyboard pane, which the settings search leads to. */
export function shortcutRowId(groupId: string, index: number): string {
    return `keyboard.${groupId}.${index}`;
}

/* The category a row id of `shortcutRowId` sits in, or null for an id of another pane. */
export function shortcutGroupOf(rowId: string): string | null {
    const area = /^keyboard\.(\w+)\.\d+$/.exec(rowId)?.[1];
    return KEYBOARD_AREAS.find((candidate) => candidate === area) ?? null;
}

/* What a search can match on: the keys as printed together (`⌘z`) and as written out (`ctrl+z`). */
function searchableKeys(row: ShortcutRow, apple: boolean): string[] {
    const parts = [...shortcutParts(row.keys, apple), ...(row.then ? [row.then] : [])].map((part) => part.toLowerCase());
    return [parts.join(''), parts.join('+')];
}

/* Case-insensitive match on the label or the keys; empty groups drop out so nothing shows a bare header. */
export function filterShortcuts(groups: readonly ShortcutGroup[], query: string, apple: boolean): ShortcutGroup[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...groups];
    }
    const keysNeedle = needle.replace(/ /g, '');
    return groups
        .map((group) => ({
            ...group,
            shortcuts: group.shortcuts.filter(
                (row) => row.label.toLowerCase().includes(needle) || searchableKeys(row, apple).some((keys) => keys.includes(keysNeedle))
            )
        }))
        .filter((group) => group.shortcuts.length > 0);
}
