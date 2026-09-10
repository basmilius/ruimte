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
