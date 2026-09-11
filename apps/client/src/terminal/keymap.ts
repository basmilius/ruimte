/* What these helpers read from a key event. A real `KeyboardEvent` satisfies it, a test writes one by hand. */
export interface KeyChord {
    key: string;
    code: string;
    metaKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
}

/*
 * Escape belongs to the program in the terminal (Claude Code interrupts on it, vim lives on it), so
 * leaving node mode is a chord: Cmd+Escape on macOS, Ctrl+Shift+Escape elsewhere. Plain Ctrl+Escape
 * is the Windows Start menu, which never reaches the page.
 */
export const isLeaveNodeChord = (event: KeyChord, apple: boolean): boolean => {
    if (event.key !== 'Escape') {
        return false;
    }
    if (apple) {
        return event.metaKey;
    }
    return event.ctrlKey && event.shiftKey;
};

/* The chord as a tooltip or a chip prints it. The Keyboard pane says ⌘ where Windows reads Ctrl; this one cannot. */
export const leaveNodeChordLabel = (apple: boolean): string => (apple ? '⌘Esc' : '⌃⇧Esc');

/*
 * The chords a focused terminal hands back to the app: the ones that move between views, panels and
 * settings, so you never have to leave the terminal to reach another view. Every other chord is the
 * program's, which is why ⌘K clears the screen here instead of opening the palette.
 */
export const isAppChord = (event: KeyChord, apple: boolean): boolean => {
    const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod) {
        return false;
    }
    if (event.altKey) {
        return event.code === 'KeyB';
    }
    if (event.shiftKey) {
        return event.code === 'BracketLeft' || event.code === 'BracketRight';
    }
    // Ctrl+B is readline's backward-char and tmux's prefix, so off macOS the shell keeps it.
    return /^Digit[1-9]$/.test(event.code) || event.code === 'KeyT' || event.key === ',' || (apple && event.code === 'KeyB');
};

/* Clearing is ⌘K, what every macOS terminal does; off macOS the shell owns Ctrl+K, so it is ⌃⇧K. */
export const isClearChord = (event: KeyChord, apple: boolean): boolean => {
    if (event.code !== 'KeyK' || event.altKey) {
        return false;
    }
    if (apple) {
        return event.metaKey && !event.ctrlKey && !event.shiftKey;
    }
    return event.ctrlKey && event.shiftKey && !event.metaKey;
};

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
 * The line and word motions macOS gives every native terminal and xterm does not: Cmd is the start
 * or the end of the line, Option a word, Cmd+Backspace kills back to the start. Returns the bytes to
 * write, or null when the chord is none of them and xterm should handle the key itself.
 */
export const macMotionSequence = (event: KeyChord, applicationCursorKeys: boolean): string | null => {
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
