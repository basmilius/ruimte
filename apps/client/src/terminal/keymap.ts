import { CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, VIEW_SHORTCUTS } from '@/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { shortcut, matchesShortcut, type Shortcut, type KeyLike } from '@/ui/shortcut';

/* A shortcut that is a different key on macOS than everywhere else, on purpose. */
export interface PlatformShortcut {
    mac: Shortcut;
    other: Shortcut;
}

export const platformShortcut = (pair: PlatformShortcut, apple: boolean): Shortcut => (apple ? pair.mac : pair.other);

/*
 * Escape belongs to the program in the terminal (Claude Code interrupts on it, vim lives on it), so
 * leaving a terminal is a shortcut. Plain Ctrl+Escape is the Windows Start menu, which never reaches the page.
 */
export const LEAVE_NODE_SHORTCUT: PlatformShortcut = { mac: shortcut('Meta+Escape'), other: shortcut('Ctrl+Shift+Escape') };

/* Clearing is Cmd+K, what every macOS terminal does; off macOS Ctrl+K is readline's kill-line. */
export const CLEAR_SHORTCUT: PlatformShortcut = { mac: shortcut('Meta+K'), other: shortcut('Ctrl+Shift+K') };

export const isLeaveNodeShortcut = (event: KeyLike, apple: boolean): boolean => matchesShortcut(platformShortcut(LEAVE_NODE_SHORTCUT, apple), event, apple);

export const isClearShortcut = (event: KeyLike, apple: boolean): boolean => matchesShortcut(platformShortcut(CLEAR_SHORTCUT, apple), event, apple);

/*
 * The shortcuts a focused terminal hands back to the app, the ones that move between views, cells, panels
 * and settings, so you never have to leave the terminal to reach another view. Every other shortcut is the
 * program's, which is why Cmd+K clears the screen here instead of opening the palette.
 */
export const TERMINAL_HANDED_BACK: readonly Shortcut[] = [
    ...VIEW_SHORTCUTS,
    CANVAS_SHORTCUTS.dictation,
    CANVAS_SHORTCUTS.voiceControl,
    CANVAS_SHORTCUTS.newView,
    CANVAS_SHORTCUTS.splitRight,
    CANVAS_SHORTCUTS.splitDown,
    CANVAS_SHORTCUTS.closeCell,
    CANVAS_SHORTCUTS.maximizeCell,
    CANVAS_SHORTCUTS.previousView,
    CANVAS_SHORTCUTS.nextView,
    CANVAS_SHORTCUTS.togglePanel,
    CANVAS_SHORTCUTS.toggleFlag,
    CANVAS_SHORTCUTS.focusPrompts,
    ...Object.values(FOCUS_SHORTCUTS),
    APP_SHORTCUTS.settings,
    APP_SHORTCUTS.sidebar
];

/* Off macOS these are control characters a program reads (Ctrl+B the tmux prefix, Ctrl+W delete-word,
   Ctrl+T transpose, Ctrl+\ SIGQUIT), so the terminal keeps them there. */
const PTY_CONTROL_SHORTCUTS: readonly Shortcut[] = [APP_SHORTCUTS.sidebar, CANVAS_SHORTCUTS.newView, CANVAS_SHORTCUTS.splitRight, CANVAS_SHORTCUTS.closeCell];

const matchesAny = (shortcuts: readonly Shortcut[], event: KeyLike, apple: boolean): boolean =>
    shortcuts.some((candidate) => matchesShortcut(candidate, event, apple));

export const isAppShortcut = (event: KeyLike, apple: boolean): boolean =>
    TERMINAL_HANDED_BACK.some((candidate) => (apple || !PTY_CONTROL_SHORTCUTS.includes(candidate)) && matchesShortcut(candidate, event, apple));

/*
 * What a text field that stops its own keys (the chat composer, the file editor) hands back, everything
 * a terminal does, the Ctrl shortcuts a terminal keeps off macOS (a text field has no program behind
 * it), the palette, find in files and the find bar. Ctrl+B stays out of it off macOS, as it always has.
 */
export const shellShortcuts = (apple: boolean): readonly Shortcut[] => [
    ...TERMINAL_HANDED_BACK.filter((candidate) => apple || candidate !== APP_SHORTCUTS.sidebar),
    APP_SHORTCUTS.palette,
    APP_SHORTCUTS.findInFiles,
    CANVAS_SHORTCUTS.find
];

export const isShellShortcut = (event: KeyLike, apple: boolean): boolean => matchesAny(shellShortcuts(apple), event, apple);

/* Home and End in both forms the application cursor keys mode (DECCKM) asks for. */
const HOME_NORMAL = '\x1b[H';
const HOME_APPLICATION = '\x1bOH';
const END_NORMAL = '\x1b[F';
const END_APPLICATION = '\x1bOF';
/* Readline's backward-word and forward-word. */
const WORD_BACK = '\x1bb';
const WORD_FORWARD = '\x1bf';
/* Ctrl+U, readline's unix-line-discard. */
const KILL_LINE_BACK = '\x15';

/**
 * The line and word motions macOS gives every native terminal that xterm does not. Cmd is the start
 * or the end of the line, Option a word, Cmd+Backspace kills back to the start. Returns the bytes to
 * write, or null when the shortcut is none of them and xterm should handle the key itself.
 */
export const macMotionSequence = (event: KeyLike, applicationCursorKeys: boolean): string | null => {
    if (event.ctrlKey) {
        return null;
    }
    if (event.metaKey && !event.altKey) {
        if (event.key === 'ArrowLeft') {
            return applicationCursorKeys ? HOME_APPLICATION : HOME_NORMAL;
        }
        if (event.key === 'ArrowRight') {
            return applicationCursorKeys ? END_APPLICATION : END_NORMAL;
        }
        if (event.key === 'Backspace') {
            return KILL_LINE_BACK;
        }
        return null;
    }
    if (event.altKey && !event.metaKey) {
        if (event.key === 'ArrowLeft') {
            return WORD_BACK;
        }
        if (event.key === 'ArrowRight') {
            return WORD_FORWARD;
        }
    }
    return null;
};
