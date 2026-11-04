// A node title, a group label, the word on a line. Past this it is a paragraph in every header that prints it.
export const MAX_TITLE_LENGTH = 120;

/*
 * A terminal agent starts from a line typed into a shell that has not read a byte yet, so it waits in
 * the tty's canonical buffer (4 KiB on Linux, 8 KiB on macOS), which silently cuts off anything longer.
 */
export const MAX_PROMPT_LENGTH = 2000;

/*
 * Agent nodes one caller may have open at once, counting nodes that still exist. Per caller rather than
 * per project, so a person opening agents of their own never runs out because of a loop elsewhere.
 */
export const MAX_OPENED_PER_CALLER = 16;

/*
 * Per computer use call: the helper types a key every 40 ms while every other call for the app waits.
 * The helper enforces the same limit (`TypingLimit` in `apps/computer-use`).
 */
export const MAX_TYPED_LENGTH = 500;
export const MAX_KEY_COMBOS = 50;

// The most lines `terminal.read` hands back, which is also all a window keeps of a terminal out of sight.
export const MAX_TERMINAL_READ_LINES = 200;

/* Nodes, lines or flags one call changes at once: a loop of single calls writes the project and redraws every client once per item. */
export const MAX_PER_CALL = 100;
