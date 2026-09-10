import type { UsageProvider } from '@ruimte/contracts';
import type { UsageRecord } from './record.ts';
import type { CodexParserState } from './readers/codex.ts';

/* A different version is thrown away rather than migrated: rebuilding costs one cold scan. */
const INDEX_VERSION = 1;

export interface IndexedFile {
    provider: UsageProvider;
    size: number;
    mtimeMs: number;
    /* Just past the last newline that was read, so a file that grew is read from there. */
    offset: number;
    records: UsageRecord[];
    /* What the line still being written at the end of the file says; read again on the next scan,
       so it is kept apart from the records the offset has already accounted for. */
    tail: UsageRecord[];
    /* What the reader has to remember to carry on halfway through a Codex file. */
    codex: CodexParserState | null;
}

export type UsageIndex = Map<string, IndexedFile>;

/*
 * The index is a few hundred thousand records of seven numbers each, and the same model, session
 * and directory strings over and over. Interning those three and writing a record as a tuple is
 * what keeps the file at a few megabytes instead of tens of them.
 */
type RecordRow = [number, number, number, number, number, number, number, number, number, number, number, string | 0];

interface FileRow {
    p: UsageProvider;
    s: number;
    m: number;
    o: number;
    r: RecordRow[];
    t: RecordRow[];
    c: CodexParserState | null;
}

interface IndexFile {
    version: number;
    models: string[];
    sessions: string[];
    folders: string[];
    files: Record<string, FileRow>;
}

class Interner {
    readonly values: string[] = [];
    private readonly at = new Map<string, number>();

    index(value: string): number {
        const seen = this.at.get(value);
        if (seen !== undefined) {
            return seen;
        }
        const next = this.values.length;
        this.values.push(value);
        this.at.set(value, next);
        return next;
    }
}

export const encodeIndex = (index: UsageIndex): string => {
    const models = new Interner();
    const sessions = new Interner();
    const folders = new Interner();
    const files: Record<string, FileRow> = {};
    const row = (record: UsageRecord): RecordRow => [
        record.timestampMs,
        models.index(record.model),
        sessions.index(record.sessionId),
        folders.index(record.cwd),
        record.totals.calls,
        record.totals.input,
        record.totals.cacheRead,
        record.totals.cacheWrite,
        record.totals.cacheWrite1h,
        record.totals.output,
        record.totals.reasoning,
        record.dedupeKey ?? 0
    ];
    for (const [path, file] of index) {
        files[path] = { p: file.provider, s: file.size, m: file.mtimeMs, o: file.offset, c: file.codex, r: file.records.map(row), t: file.tail.map(row) };
    }
    const document: IndexFile = { version: INDEX_VERSION, models: models.values, sessions: sessions.values, folders: folders.values, files };
    return JSON.stringify(document);
};

const isRow = (row: unknown): row is RecordRow =>
    Array.isArray(row) && row.length === 12 && row.slice(0, 11).every((value) => typeof value === 'number') && (typeof row[11] === 'string' || row[11] === 0);

/*
 * A row that does not read back costs a cold parse of the file it belonged to, never a wrong total,
 * so anything unexpected drops that file's entry rather than being repaired.
 */
export const decodeIndex = (text: string): UsageIndex => {
    const index: UsageIndex = new Map();
    let document: IndexFile;
    try {
        document = JSON.parse(text) as IndexFile;
    } catch {
        return index;
    }
    if (document?.version !== INDEX_VERSION || !Array.isArray(document.models) || !Array.isArray(document.sessions) || !Array.isArray(document.folders)) {
        return index;
    }
    const name = (table: string[], at: number): string | null => (typeof table[at] === 'string' ? table[at] : null);
    for (const [path, file] of Object.entries(document.files ?? {})) {
        if (file.p !== 'claude' && file.p !== 'codex') {
            continue;
        }
        if (typeof file.s !== 'number' || typeof file.m !== 'number' || typeof file.o !== 'number' || file.o < 0 || !Array.isArray(file.r)) {
            continue;
        }
        let broken = false;
        const decode = (rows: RecordRow[]): UsageRecord[] => {
            const records: UsageRecord[] = [];
            for (const row of rows) {
                const model = isRow(row) ? name(document.models, row[1]) : null;
                const sessionId = isRow(row) ? name(document.sessions, row[2]) : null;
                const cwd = isRow(row) ? name(document.folders, row[3]) : null;
                if (!isRow(row) || model === null || sessionId === null || cwd === null) {
                    broken = true;
                    return records;
                }
                records.push({
                    provider: file.p,
                    timestampMs: row[0],
                    model,
                    sessionId,
                    cwd,
                    totals: { calls: row[4], input: row[5], cacheRead: row[6], cacheWrite: row[7], cacheWrite1h: row[8], output: row[9], reasoning: row[10] },
                    dedupeKey: row[11] === 0 ? null : row[11]
                });
            }
            return records;
        };
        const records = decode(file.r);
        const tail = decode(Array.isArray(file.t) ? file.t : []);
        if (!broken) {
            index.set(path, { provider: file.p, size: file.s, mtimeMs: file.m, offset: file.o, records, tail, codex: file.c ?? null });
        }
    }
    return index;
};
