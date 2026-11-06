import { AGENT_COLORS } from '@adecore/editor';
import { lineMap } from '@adecore/merge';
import type { ProvenanceRun } from '@ruimte/contracts';

/* One piece of a run in the text of the editor, as the lines the bar covers. */
export interface DrawnRun {
    /* Unique per piece, since a run an edit cut in two draws two bars with one run id. */
    markId: string;
    run: ProvenanceRun;
    /* One-based and inclusive. */
    startLine: number;
    endLine: number;
}

/*
 * Where the runs the daemon mapped onto the text on disk stand in the text of the editor. A line typed
 * or replaced since has no run; a run an edit cut through draws as the pieces that are left.
 */
export function drawnRuns(runs: readonly ProvenanceRun[], disk: readonly string[], text: readonly string[], where = lineMap(disk, text)): DrawnRun[] {
    const drawn: DrawnRun[] = [];
    for (const run of runs) {
        let piece: DrawnRun | null = null;
        let pieces = 0;
        for (let line = run.start - 1; line < Math.min(run.end, disk.length); line++) {
            const place = where[line]!;
            if (piece !== null && place === piece.endLine) {
                piece.endLine = place + 1;
                continue;
            }
            piece = null;
            if (place >= 0) {
                piece = { markId: `${run.id}:${pieces++}`, run, startLine: place + 1, endLine: place + 1 };
                drawn.push(piece);
            }
        }
    }
    return drawn;
}

/* A run that only removed lines, and the line of the editor it stood in front of. */
export interface RemovalRun {
    run: ProvenanceRun;
    /* Zero-based; the number of lines of the editor when the removal was at the very end. */
    line: number;
}

/* Where the removals stand in the editor, which have no lines of their own to draw a bar on. */
export function removalRuns(runs: readonly ProvenanceRun[], disk: readonly string[], text: readonly string[], where = lineMap(disk, text)): RemovalRun[] {
    const found: RemovalRun[] = [];
    for (const run of runs) {
        if (run.end >= run.start) {
            continue;
        }
        const next = run.start - 1;
        const place = next >= disk.length ? text.length : where[next]!;
        if (place >= 0) {
            found.push({ run, line: place });
        }
    }
    return found;
}

/* The same color for a chat every time and in every file, spread over the palette by a hash of its id. */
export function colorOfChat(chatId: string): string {
    let hash = 5381;
    for (let i = 0; i < chatId.length; i++) {
        hash = (Math.imul(hash, 33) + chatId.charCodeAt(i)) | 0;
    }
    return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]!;
}

/* The piece a turn wrote last, which is where its cursor stands: the newest run, and the lowest piece of it. */
export function lastWritten(drawn: readonly DrawnRun[], chatId: string, turnId: string): DrawnRun | null {
    let found: DrawnRun | null = null;
    for (const candidate of drawn) {
        if (candidate.run.chatId !== chatId || candidate.run.turnId !== turnId) {
            continue;
        }
        if (found === null || candidate.run.at > found.run.at || (candidate.run.at === found.run.at && candidate.endLine > found.endLine)) {
            found = candidate;
        }
    }
    return found;
}
