import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRoot } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { decodeIndex, encodeIndex, type IndexedFile, type UsageIndex } from './index-file.ts';
import { foldByKey, type UsageRecord } from './record.ts';
import { claudeMightCarryUsage, parseClaudeLine } from './readers/claude.ts';
import { cloneCodexState, codexMightCarryUsage, createCodexState, parseCodexLine, type CodexParserState } from './readers/codex.ts';
import { usageRoots, type UsageRootPath } from './roots.ts';
import { errorText } from '../error-text.ts';

export interface ScanReport {
    at: number;
    files: number;
    changedFiles: number;
    durationMs: number;
    roots: UsageRoot[];
}

interface ParsedFile {
    records: UsageRecord[];
    tail: UsageRecord[];
    offset: number;
    codex: CodexParserState | null;
}

const listJsonl = async (dir: string, out: string[] = []): Promise<string[]> => {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        // A directory that cannot be read is one the scan walks past; the root itself reports status.
        return out;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            await listJsonl(path, out);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            out.push(path);
        }
    }
    return out;
};

/*
 * Reads what a file added since the last scan. Only whole lines count towards the offset; the piece
 * after the last newline is a line still being written, so it is parsed for what it is worth and
 * read again next time. The Codex state is snapshotted before that tail for the same reason.
 */
const parseChunk = (text: string, provider: 'claude' | 'codex', from: number, state: CodexParserState | null): ParsedFile => {
    let records: UsageRecord[] = [];
    const end = text.lastIndexOf('\n');
    const whole = end === -1 ? '' : text.slice(0, end);
    const tail = text.slice(end + 1);
    const read = (chunk: string, codex: CodexParserState | null): void => {
        for (const raw of chunk.split('\n')) {
            const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
            if (line === '') {
                continue;
            }
            if (provider === 'claude') {
                if (claudeMightCarryUsage(line)) {
                    const record = parseClaudeLine(line);
                    if (record !== null) {
                        records.push(record);
                    }
                }
                continue;
            }
            if (codex !== null && codexMightCarryUsage(line)) {
                const record = parseCodexLine(line, codex);
                if (record !== null) {
                    records.push(record);
                }
            }
        }
    };
    const codex = provider === 'codex' ? (state ?? createCodexState()) : null;
    read(whole, codex);
    const committed = codex === null ? null : cloneCodexState(codex);
    const counted = records;
    records = [];
    read(tail, codex);
    return { records: counted, tail: records, offset: from + (end === -1 ? 0 : Buffer.byteLength(whole, 'utf8') + 1), codex: committed };
};

/*
 * Read appended transcript bytes incrementally, but restart after rewrites or truncation. Preserve
 * totals for deleted transcripts because their usage still happened.
 */
export class UsageScanner {
    private readonly home: string;
    private readonly roots: UsageRootPath[];
    private index: UsageIndex = new Map();
    private loaded = false;
    private dirty = false;

    constructor(home: string, roots: UsageRootPath[] = usageRoots()) {
        this.home = home;
        this.roots = roots;
    }

    private get file(): string {
        return join(this.home, 'usage', 'index.json');
    }

    async load(): Promise<void> {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        try {
            this.index = decodeIndex(await readFile(this.file, 'utf8'));
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The usage index would not read; starting from a cold scan:', errorText(e));
            }
        }
    }

    async scan(): Promise<ScanReport> {
        const started = Date.now();
        await this.load();
        const roots: UsageRoot[] = [];
        let files = 0;
        let changedFiles = 0;

        for (const root of this.roots) {
            try {
                const info = await stat(root.path);
                if (!info.isDirectory()) {
                    roots.push({ provider: root.provider, path: root.path, status: 'missing', message: null });
                    continue;
                }
            } catch (e) {
                const missing = isNotFound(e);
                roots.push({
                    provider: root.provider,
                    path: root.path,
                    status: missing ? 'missing' : 'failed',
                    message: missing ? null : e instanceof Error ? e.message : String(e)
                });
                continue;
            }
            let failure: string | null = null;
            for (const path of await listJsonl(root.path)) {
                files += 1;
                try {
                    if (await this.readFileInto(path, root.provider)) {
                        changedFiles += 1;
                    }
                } catch (e) {
                    // One unreadable transcript is not the root failing; the count simply misses it.
                    failure ??= e instanceof Error ? e.message : String(e);
                }
            }
            roots.push({ provider: root.provider, path: root.path, status: failure === null ? 'ok' : 'failed', message: failure });
        }

        if (this.dirty) {
            this.dirty = false;
            await mkdir(join(this.home, 'usage'), { recursive: true, mode: 0o700 });
            await writeAtomic(this.file, encodeIndex(this.index));
        }
        return { at: Date.now(), files, changedFiles, durationMs: Date.now() - started, roots };
    }

    /* Every record the index holds, with the copies one message left in several transcripts folded. */
    records(): UsageRecord[] {
        const all: UsageRecord[] = [];
        for (const file of this.index.values()) {
            all.push(...file.records, ...file.tail);
        }
        return foldByKey(all);
    }

    private async readFileInto(path: string, provider: 'claude' | 'codex'): Promise<boolean> {
        const info = await stat(path);
        const known = this.index.get(path);
        if (known !== undefined && known.provider === provider && known.size === info.size && known.mtimeMs === info.mtimeMs) {
            return false;
        }
        const grown = known !== undefined && known.provider === provider && info.size > known.size;
        const from = grown ? known.offset : 0;
        const text = await Bun.file(path).slice(from).text();
        const parsed = parseChunk(text, provider, from, grown ? known.codex : null);
        const before = grown ? known.records : [];
        const entry: IndexedFile = {
            provider,
            size: info.size,
            mtimeMs: info.mtimeMs,
            offset: parsed.offset,
            // Folding here keeps the streaming copies of one message out of the index entirely.
            records: foldByKey([...before, ...parsed.records]),
            tail: parsed.tail,
            codex: parsed.codex
        };
        this.index.set(path, entry);
        this.dirty = true;
        return true;
    }
}
