/* What these helpers read from a key event. A real `KeyboardEvent` satisfies it, a test writes one by hand. */
export interface KeyChord {
    key: string;
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
