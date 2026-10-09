import { z } from 'zod';

// Navigation metadata only. Neither this stream nor its snapshots authorize terminal input.
export const TERMINAL_CWD_OSC = 777;
const PREFIX = 'ruimte-cwd;';
const MAX_CHANGES = 128;
const MAX_SNAPSHOT_UNITS = 32_768;
const CwdSchema = z
    .string()
    .max(4096)
    .startsWith('/')
    .refine((path) => !/[\p{Cc}\p{Cf}]/u.test(path));
export const TerminalCwdSnapshotSchema = z.object({
    version: z.literal(1),
    cols: z.number().int().positive().max(2048),
    rows: z.number().int().positive().max(512),
    length: z.number().int().positive().max(20_000),
    cwd: CwdSchema.nullable(),
    pending: z.boolean(),
    entries: z.array(z.object({ row: z.number().int().nonnegative(), cwd: CwdSchema.nullable() })).max(MAX_CHANGES + 1)
});

type Snapshot = z.infer<typeof TerminalCwdSnapshotSchema>;
interface Disposable {
    dispose(): void;
}
interface Marker extends Disposable {
    readonly line: number;
    onDispose(callback: () => void): Disposable;
}
interface BufferView {
    readonly type: 'normal' | 'alternate';
    readonly length: number;
    readonly baseY: number;
    readonly cursorY: number;
    getLine(row: number): { readonly isWrapped: boolean; translateToString(trim?: boolean): string } | undefined;
}

/* The protocol runs on the daemon and browser against xterm's public API, with no renderer dependency. */
export interface CwdTerminal {
    readonly cols: number;
    readonly rows: number;
    readonly buffer: { readonly active: BufferView; readonly normal: BufferView; onBufferChange(callback: () => void): Disposable };
    readonly parser: {
        registerOscHandler(code: number, callback: (data: string) => boolean): Disposable;
        registerEscHandler(id: { final: string }, callback: () => boolean): Disposable;
        registerCsiHandler(id: { final: string; prefix?: string }, callback: (params: (number | number[])[]) => boolean): Disposable;
    };
    registerMarker(offset: number): Marker | undefined;
    onLineFeed(callback: () => void): Disposable;
}

export interface TerminalCwd {
    at(row: number): string | null;
    snapshot(scrollback: number): string;
    clear(): void;
    dispose(): void;
}

/* One marker per cwd transition, not per output line. Retention and lookup work stay bounded even
   for a process that writes millions of lines; evicted history becomes unknown. */
export function trackTerminalCwd(term: CwdTerminal): TerminalCwd {
    const entries = new Map<Marker, { cwd: string | null; order: number }>();
    let order = 0;
    let base: { cwd: string | null; order: number } = { cwd: null, order: -1 };
    let cwd: string | null = null;
    let pending = false;
    let clearing = false;
    const add = (row: number, value: string | null): void => {
        const buffer = term.buffer.active;
        if (buffer.type !== 'normal') {
            return;
        }
        const marker = term.registerMarker(row - buffer.baseY - buffer.cursorY);
        if (!marker) {
            return;
        }
        const entry = { cwd: value, order: order++ };
        entries.set(marker, entry);
        marker.onDispose(() => {
            // A trim carries the preceding context into the retained prefix. Destructive screen
            // edits clear the tracker before xterm disposes their markers.
            if (!clearing && marker.line < 0 && entry.order > base.order) {
                base = entry;
            }
            entries.delete(marker);
        });
        if (entries.size > MAX_CHANGES) {
            clearing = true;
            entries.keys().next().value?.dispose();
            clearing = false;
            base = { cwd: null, order: -1 };
        }
    };
    const at = (row: number): string | null => {
        if (term.buffer.active.type !== 'normal') {
            return null;
        }
        let found = base;
        let line = -1;
        for (const [marker, entry] of entries) {
            if (marker.line < row && (marker.line > line || (marker.line === line && entry.order > found.order))) {
                found = entry;
                line = marker.line;
            }
        }
        return found.cwd;
    };
    const change = (value: string | null): void => {
        const buffer = term.buffer.active;
        const previous = cwd;
        cwd = buffer.type === 'normal' ? value : null;
        if (buffer.type !== 'normal') {
            return;
        }
        if (previous === cwd && !pending && at(buffer.baseY + buffer.cursorY + 1) === cwd) {
            return;
        }
        let row = buffer.baseY + buffer.cursorY;
        while (row > 0 && buffer.getLine(row)?.isWrapped) {
            row--;
        }
        const occupied = buffer.getLine(row)?.translateToString(true) !== '';
        pending = occupied;
        add(row, occupied ? null : cwd);
    };
    const clear = (): void => {
        clearing = true;
        for (const marker of entries.keys()) {
            marker.dispose();
        }
        clearing = false;
        cwd = null;
        pending = false;
        base = { cwd: null, order: -1 };
    };
    const osc = term.parser.registerOscHandler(7, (data) => {
        let value: string | null = null;
        try {
            const url = new URL(data);
            const parsed = CwdSchema.safeParse(decodeURIComponent(url.pathname));
            if (url.protocol === 'file:' && !url.search && !url.hash && parsed.success) {
                value = parsed.data;
            }
        } catch {
            /* Malformed metadata revokes the previous context. */
        }
        change(value);
        return true;
    });
    const restore = term.parser.registerOscHandler(TERMINAL_CWD_OSC, (data) => {
        if (!data.startsWith(PREFIX)) {
            return false;
        }
        clear();
        if (data.length > MAX_SNAPSHOT_UNITS) {
            return true;
        }
        try {
            const parsed = TerminalCwdSnapshotSchema.safeParse(JSON.parse(data.slice(PREFIX.length)));
            const buffer = term.buffer.active;
            if (
                !parsed.success ||
                buffer.type !== 'normal' ||
                parsed.data.cols !== term.cols ||
                parsed.data.rows !== term.rows ||
                parsed.data.length !== buffer.length
            ) {
                return true;
            }
            const saved = parsed.data;
            if (saved.entries.some((entry, index) => entry.row >= saved.length || (index > 0 && entry.row <= saved.entries[index - 1]!.row))) {
                return true;
            }
            for (const entry of saved.entries) {
                add(entry.row, entry.cwd);
            }
            cwd = saved.cwd;
            pending = saved.pending;
        } catch {
            /* A damaged snapshot must remain readable without supplying a cwd. */
        }
        return true;
    });
    const lineFeed = term.onLineFeed(() => {
        if (pending) {
            pending = false;
            const buffer = term.buffer.active;
            add(buffer.baseY + buffer.cursorY, cwd);
        }
    });
    let returningRow: number | null = null;
    const leaveAlternate = term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
        if (term.buffer.active.type === 'alternate' && params.some((param) => param === 47 || param === 1047 || param === 1049)) {
            const normal = term.buffer.normal;
            returningRow = normal.baseY + normal.cursorY;
        }
        return false;
    });
    const buffers = term.buffer.onBufferChange(() => {
        cwd = null;
        pending = false;
        if (term.buffer.active.type === 'normal') {
            // xterm announces the buffer switch before restoring its saved cursor. Read the
            // normal cursor before the sequence, so a TUI cannot invalidate an older output row.
            if (returningRow === null) {
                clear();
            } else {
                while (returningRow > 0 && term.buffer.normal.getLine(returningRow)?.isWrapped) {
                    returningRow--;
                }
                add(returningRow, null);
            }
            returningRow = null;
        }
    });
    const reset = ['c', '8', 'M'].map((final) =>
        term.parser.registerEscHandler({ final }, () => {
            if (final === 'c' || term.buffer.active.type === 'normal') {
                clear();
            }
            return false;
        })
    );
    // Cursor-addressed output can overwrite rows from an earlier directory. Once that happens,
    // only a new cwd boundary can make subsequent output unambiguous.
    const destructive = ['A', 'B', 'E', 'F', 'H', 'f', 'd', 'e', 'L', 'M', 'S', 'T', 'r', 'u'].map((final) =>
        term.parser.registerCsiHandler({ final }, () => {
            if (term.buffer.active.type === 'normal') {
                clear();
            }
            return false;
        })
    );
    const erase = term.parser.registerCsiHandler({ final: 'J' }, (params) => {
        if (term.buffer.active.type !== 'normal') {
            return false;
        }
        if ((params[0] ?? 0) !== 0) {
            clear();
        } else {
            // ZLE clears the unused screen below its prompt on every redraw. Only boundaries
            // in the erased tail are invalidated; scrollback and the current cwd survive.
            const buffer = term.buffer.active;
            const row = buffer.baseY + buffer.cursorY;
            clearing = true;
            for (const marker of entries.keys()) {
                if (marker.line > row) {
                    marker.dispose();
                }
            }
            clearing = false;
        }
        return false;
    });
    return {
        at,
        clear,
        snapshot(scrollback) {
            const buffer = term.buffer.normal;
            const offset = Math.max(0, buffer.length - term.rows - scrollback);
            const rows = new Map<number, string | null>([[0, at(offset + 1)]]);
            for (const [marker, entry] of entries) {
                if (marker.line >= offset) {
                    rows.set(marker.line - offset, entry.cwd);
                }
            }
            const saved: Snapshot = { version: 1, cols: term.cols, rows: term.rows, length: buffer.length - offset, cwd, pending, entries: [] };
            let size = JSON.stringify(saved).length + PREFIX.length;
            for (const [row, value] of [...rows].sort(([left], [right]) => right - left)) {
                const entry = { row, cwd: value };
                size += JSON.stringify(entry).length + 1;
                if (size >= MAX_SNAPSHOT_UNITS) {
                    break;
                }
                saved.entries.unshift(entry);
            }
            return `\x1b]${TERMINAL_CWD_OSC};${PREFIX}${JSON.stringify(saved)}\x07`;
        },
        dispose() {
            osc.dispose();
            restore.dispose();
            lineFeed.dispose();
            buffers.dispose();
            leaveAlternate.dispose();
            reset.forEach((handler) => handler.dispose());
            erase.dispose();
            destructive.forEach((handler) => handler.dispose());
            clear();
        }
    };
}

/* A persisted screen must first replay on its original grid, then reflow to the new client's grid. */
export function terminalCwdScreenSize(screen: string): { cols: number; rows: number } | null {
    const start = screen.lastIndexOf(`\x1b]${TERMINAL_CWD_OSC};${PREFIX}`);
    if (start < 0 || screen.length - start > MAX_SNAPSHOT_UNITS + 16 || !screen.endsWith('\x07')) {
        return null;
    }
    try {
        const parsed = TerminalCwdSnapshotSchema.safeParse(JSON.parse(screen.slice(start + String(TERMINAL_CWD_OSC).length + 3 + PREFIX.length, -1)));
        return parsed.success ? { cols: parsed.data.cols, rows: parsed.data.rows } : null;
    } catch {
        return null;
    }
}
