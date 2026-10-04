/*
 * The most a screen may weigh in its frame, as JSON in UTF-8 bytes. Past 16 MB the socket closes and
 * a direct channel turns the frame away, and the reconnect that follows meets the same screen again.
 */
export const SCREEN_MAX_BYTES = 4 * 1024 * 1024;

// JSON writes a control character as `\u001b`, six bytes for one unit, and nothing costs more than that.
const MAX_BYTES_PER_UNIT = 6;

function frameBytes(screen: string): number {
    return Buffer.byteLength(JSON.stringify(screen));
}

/*
 * The screen with as much scrollback as fits in one frame. The oldest lines go first, half of them
 * at a time; what is on screen always stays.
 */
export function fitScreen(serialize: (scrollback: number) => string, scrollback: number, maxBytes: number = SCREEN_MAX_BYTES): string {
    let lines = scrollback;
    let screen = serialize(lines);
    while (lines > 0 && screen.length * MAX_BYTES_PER_UNIT > maxBytes && frameBytes(screen) > maxBytes) {
        lines = Math.floor(lines / 2);
        screen = serialize(lines);
    }
    return screen;
}
