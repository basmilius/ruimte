import { shortcut, matchesShortcut, type Shortcut, type KeyLike } from '@adecore/ui';
import { VIEW_SHORTCUTS } from '@/surface/canvas/shortcuts';
import type { DefaultKeyId } from '@/surface/default-keys';
import { isRebound, keyOf, overridesSnapshot } from '@/surface/shortcut-overrides';

/* A shortcut that is a different key on macOS than everywhere else, on purpose. */
interface PlatformShortcut {
    mac: Shortcut;
    other: Shortcut;
}

export function platformShortcut(pair: PlatformShortcut, apple: boolean): Shortcut {
    return apple ? pair.mac : pair.other;
}

/*
 * Escape belongs to the program in the terminal (Claude Code interrupts on it, vim lives on it), so
 * leaving a terminal is a shortcut. Plain Ctrl+Escape is the Windows Start menu, which never reaches the page.
 */
export const LEAVE_NODE_SHORTCUT: PlatformShortcut = { mac: shortcut('Meta+Escape'), other: shortcut('Ctrl+Shift+Escape') };

/* Clearing is Cmd+K, what every macOS terminal does; off macOS Ctrl+K is readline's kill-line. */
export const CLEAR_SHORTCUT: PlatformShortcut = { mac: shortcut('Meta+K'), other: shortcut('Ctrl+Shift+K') };

/*
 * Find is Cmd+F on macOS. Off macOS Ctrl+F is readline's forward-char, so the terminal takes Ctrl+Shift+F,
 * which no program reads; the window's find in files lives on that key, but a focused terminal never hands it back.
 */
export const TERMINAL_FIND_SHORTCUT: PlatformShortcut = { mac: shortcut('Meta+F'), other: shortcut('Ctrl+Shift+F') };

export function isLeaveNodeShortcut(event: KeyLike, apple: boolean): boolean {
    return matchesShortcut(platformShortcut(LEAVE_NODE_SHORTCUT, apple), event, apple);
}

export function isClearShortcut(event: KeyLike, apple: boolean): boolean {
    return matchesShortcut(platformShortcut(CLEAR_SHORTCUT, apple), event, apple);
}

export function isTerminalFindShortcut(event: KeyLike, apple: boolean): boolean {
    return matchesShortcut(platformShortcut(TERMINAL_FIND_SHORTCUT, apple), event, apple);
}

/*
 * Off macOS Ctrl+V pastes this machine's clipboard. Written as ^V it reaches the program instead, and a CLI
 * that reads ^V as paste (Claude Code, Codex, PowerShell) pastes the clipboard of the machine it runs on.
 * The letter the layout types, not the physical key, the way the browser's own paste reads it.
 */
export function isTerminalPaste(event: KeyLike, apple: boolean): boolean {
    return !apple && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'v';
}

/*
 * The rows whose keys a focused terminal hands back to the app, the ones that move between views, cells, panels
 * and settings, so you never have to leave the terminal to reach another view. Every other shortcut is the
 * program's, which is why Cmd+K clears the screen here instead of opening the palette. They are rows and not
 * keys, so a key a person rebinds still reaches the app.
 */
const TERMINAL_HANDED_BACK_ROWS: readonly DefaultKeyId[] = [
    'dictation',
    'voice-control',
    'view-new',
    'split-right',
    'split-down',
    'close-cell',
    'cell-maximize',
    'zoom-node',
    'view-previous',
    'view-next',
    'camera-back',
    'camera-forward',
    'tab-previous',
    'tab-next',
    'tab-move-left',
    'tab-move-right',
    'panel-toggle',
    'flag-toggle',
    'launch-run',
    'launch-stop',
    'prompts',
    'needs-you-next',
    'attention-queue',
    'focus-left',
    'focus-right',
    'focus-up',
    'focus-down',
    'settings',
    'sidebar',
    'window-new',
    'chat-new'
];

/*
 * Off macOS these are control characters a program reads (Ctrl+B the tmux prefix, Ctrl+W delete-word,
 * Ctrl+T transpose, Ctrl+\ SIGQUIT, Ctrl+Alt+[ Meta-Escape), so the terminal keeps them there. Only while the
 * row holds its default: someone who chooses a Ctrl key for it means it.
 */
const PTY_CONTROL_ROWS: readonly DefaultKeyId[] = ['sidebar', 'view-new', 'split-right', 'close-cell', 'camera-back', 'camera-forward'];

function keptByProgram(row: DefaultKeyId): boolean {
    return PTY_CONTROL_ROWS.includes(row) && !isRebound(overridesSnapshot(), row);
}

/* The keys a focused terminal hands back now, the views of a window included. */
export function terminalHandedBack(): readonly Shortcut[] {
    return [...VIEW_SHORTCUTS, ...TERMINAL_HANDED_BACK_ROWS.map((row) => keyOf(row))];
}

function matchesAny(shortcuts: readonly Shortcut[], event: KeyLike, apple: boolean): boolean {
    return shortcuts.some((candidate) => matchesShortcut(candidate, event, apple));
}

export function isAppShortcut(event: KeyLike, apple: boolean): boolean {
    const rows = TERMINAL_HANDED_BACK_ROWS.filter((row) => apple || !keptByProgram(row));

    return matchesAny([...VIEW_SHORTCUTS, ...rows.map((row) => keyOf(row))], event, apple);
}

/*
 * What a text field that stops its own keys (the chat composer, the file editor) hands back, everything
 * a terminal does, the Ctrl shortcuts a terminal keeps off macOS (a text field has no program behind
 * it), the palette, find in files and the find bar. Ctrl+B stays out of it off macOS.
 */
export function shellShortcuts(apple: boolean): readonly Shortcut[] {
    const rows = TERMINAL_HANDED_BACK_ROWS.filter((row) => apple || row !== 'sidebar' || isRebound(overridesSnapshot(), row));

    return [...VIEW_SHORTCUTS, ...rows.map((row) => keyOf(row)), keyOf('palette'), keyOf('find-in-files'), keyOf('find')];
}

export function isShellShortcut(event: KeyLike, apple: boolean): boolean {
    return matchesAny(shellShortcuts(apple), event, apple);
}

/* The chat's own keys, which the composer hands back besides those so a chat steps its reasoning effort while you type. */
// Not Alt+Up or Alt+Down: in the composer they recall your earlier prompts, and stepping between messages is the thread's, the menu's and the palette's.
const COMPOSER_HANDED_BACK_ROWS: readonly DefaultKeyId[] = ['chat-effort-up', 'chat-effort-down'];

export function isComposerShortcut(event: KeyLike, apple: boolean): boolean {
    return (
        isShellShortcut(event, apple) ||
        matchesAny(
            COMPOSER_HANDED_BACK_ROWS.map((row) => keyOf(row)),
            event,
            apple
        )
    );
}

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
export function macMotionSequence(event: KeyLike, applicationCursorKeys: boolean): string | null {
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
}
