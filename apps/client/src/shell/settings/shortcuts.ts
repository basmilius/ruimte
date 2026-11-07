import { SEND_AND_NEW_SHORTCUT } from '@adecore/agents-react/chat';
import { PROMPT_SHORTCUTS } from '@adecore/agents-react/prompts';
import { KEY_SHORTCUTS, shortcut, shortcutParts, type Shortcut } from '@adecore/ui';
import i18next from 'i18next';
import { CANVAS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import { keyIn, overridesSnapshot, type OverrideSnapshot, type RowId } from '@/shell/shortcut-overrides';
import { CLEAR_SHORTCUT, LEAVE_NODE_SHORTCUT, platformShortcut, TERMINAL_FIND_SHORTCUT } from '@/terminal/keymap';

export interface ShortcutRow {
    /* The row a person may give a key of their own; without one the row only shows its keys. */
    id?: RowId;
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
export function shortcutGroups(apple: boolean, snapshot: OverrideSnapshot = overridesSnapshot()): ShortcutGroup[] {
    return [
        {
            id: 'general',
            title: areaTitle('general'),
            shortcuts: [
                { id: 'palette', keys: keyIn(snapshot, 'palette'), label: say('canvas.palette') },
                { keys: shortcut('Alt'), then: i18next.t('settings:gesture.hold'), label: say('canvas.usagePeek') },
                { id: 'voice-control', keys: keyIn(snapshot, 'voice-control'), label: i18next.t('voice:shortcut') }
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
                { id: 'edit-undo', keys: keyIn(snapshot, 'edit-undo'), label: say('canvas.undo') },
                { id: 'edit-redo', keys: keyIn(snapshot, 'edit-redo'), label: say('canvas.redo') },
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
                { id: 'view-previous', keys: keyIn(snapshot, 'view-previous'), label: say('views.previous') },
                { id: 'view-next', keys: keyIn(snapshot, 'view-next'), label: say('views.next') },
                { id: 'view-new', keys: keyIn(snapshot, 'view-new'), label: say('views.new') },
                { keys: shortcut('F2'), label: say('views.rename') },
                { id: 'split-right', keys: keyIn(snapshot, 'split-right'), label: say('split.right') },
                { id: 'split-down', keys: keyIn(snapshot, 'split-down'), label: say('split.down') },
                { id: 'focus-left', keys: keyIn(snapshot, 'focus-left'), label: say('split.focusLeft') },
                { id: 'focus-right', keys: keyIn(snapshot, 'focus-right'), label: say('split.focusRight') },
                { id: 'focus-up', keys: keyIn(snapshot, 'focus-up'), label: say('split.focusUp') },
                { id: 'focus-down', keys: keyIn(snapshot, 'focus-down'), label: say('split.focusDown') },
                { id: 'cell-maximize', keys: keyIn(snapshot, 'cell-maximize'), label: say('split.maximize') },
                { id: 'close-cell', keys: keyIn(snapshot, 'close-cell'), label: say('split.close') },
                { id: 'panel-toggle', keys: keyIn(snapshot, 'panel-toggle'), label: say('panels.toggle') }
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
                { id: 'launch-run', keys: keyIn(snapshot, 'launch-run'), label: say('launches.run') },
                { id: 'launch-stop', keys: keyIn(snapshot, 'launch-stop'), label: say('launches.stop') }
            ]
        },
        {
            id: 'chat',
            title: areaTitle('chat'),
            shortcuts: [
                { id: 'prompts', keys: keyIn(snapshot, 'prompts'), label: say('prompts.answerFront') },
                { id: 'needs-you-next', keys: keyIn(snapshot, 'needs-you-next'), label: say('prompts.nextNeedsYou') },
                { id: 'attention-queue', keys: keyIn(snapshot, 'attention-queue'), label: say('prompts.attentionQueue') },
                { keys: PROMPT_SHORTCUTS.primary, label: say('prompts.primary') },
                { keys: PROMPT_SHORTCUTS.previousPrompt, label: say('prompts.previous') },
                { keys: PROMPT_SHORTCUTS.nextPrompt, label: say('prompts.next') },
                { keys: KEY_SHORTCUTS.escape, label: say('prompts.escape') },
                { id: 'dictation', keys: keyIn(snapshot, 'dictation'), label: say('chat.dictation') },
                { id: 'chat-text-larger', keys: keyIn(snapshot, 'chat-text-larger'), label: say('chat.textLarger') },
                { id: 'chat-text-smaller', keys: keyIn(snapshot, 'chat-text-smaller'), label: say('chat.textSmaller') },
                { id: 'zoom-reset', keys: keyIn(snapshot, 'zoom-reset'), label: say('chat.textReset') },
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
