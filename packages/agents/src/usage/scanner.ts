import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRoot } from '@ruimte/agent-contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { decodeIndex, encodeIndex, type IndexedFile, type UsageIndex } from './index-file.ts';
import { foldByKey, type UsageRecord } from './record.ts';
import { claudeMightCarryUsage, parseClaudeLine } from './readers/claude.ts';
import { cloneCodexState, codexMightCarryUsage, createCodexState, parseCodexLine, type CodexParserState } from './readers/codex.ts';
import { usageRoots, type UsageRootPath } from './roots.ts';
import { errorText } from '../error-text.ts';

/* What a file holds from `from` to its end, as it is at the read. */
const readFrom = async (path: string, from: number): Promise<string> => {
    const handle = await open(path, 'r');
    try {
        const { size } = await handle.stat();
        const buffer = Buffer.alloc(Math.max(0, size - from));
        let filled = 0;
        while (filled < buffer.length) {
            const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, from + filled);
            if (bytesRead === 0) {
                break;
            }
            filled += bytesRead;
        }
        return buffer.subarray(0, filled).toString('utf8');
    } finally {
        await handle.close();
    }
};

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

export interface UsageScannerOptions {
    /* The account of every session the daemon knows ran, by `<provider>\0<sessionId>`, the default one under its kind. */
    sessionAccounts?: () => ReadonlyMap<string, string>;
}

type AccountOf = (record: UsageRecord) => string | undefined;

/*
 * The account a record of a root belongs to, as a record keeps it (absent for the default account):
 * the one account that writes there, else the one the daemon knows ran the session, else the
 * default account of the CLI, which is the only one a session nobody started through the host ran under.
 */
export const accountResolver = (root: UsageRootPath, sessionAccounts: () => ReadonlyMap<string, string>): AccountOf => {
    const accounts = root.accounts ?? [root.provider];
    const stored = (id: string): string | undefined => (id === root.provider ? undefined : id);
    if (accounts.length === 1) {
        const only = stored(accounts[0]!);
        return () => only;
    }
    const fallback = accounts.includes(root.provider) ? root.provider : accounts[0]!;
    return (record) => {
        const ran = sessionAccounts().get(`${root.provider}\0${record.sessionId}`);
        return stored(ran !== undefined && accounts.includes(ran) ? ran : fallback);
    };
};

const withAccount = (records: UsageRecord[], accountOf: AccountOf): UsageRecord[] =>
    records.map((record) => {
        const account = accountOf(record);
        return account === undefined ? record : { ...record, account };
    });

/*
 * Read appended transcript bytes incrementally, but restart after rewrites or truncation. Preserve
 * totals for deleted transcripts because their usage still happened.
 */
export class UsageScanner {
    private readonly home: string;
    private readonly roots: () => UsageRootPath[];
    private readonly sessionAccounts: () => ReadonlyMap<string, string>;
    private index: UsageIndex = new Map();
    private loaded = false;
    private dirty = false;

    /* `roots` as a function is asked again on every scan, so an account added since is walked too. */
    constructor(home: string, roots: UsageRootPath[] | (() => UsageRootPath[]) = usageRoots(), options: UsageScannerOptions = {}) {
        this.home = home;
        this.roots = typeof roots === 'function' ? roots : () => roots;
        this.sessionAccounts = options.sessionAccounts ?? (() => new Map());
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
        let sessions: ReadonlyMap<string, string> | null = null;
        const sessionAccounts = (): ReadonlyMap<string, string> => {
            sessions ??= this.sessionAccounts();
            return sessions;
        };

        for (const root of this.roots()) {
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
                    message: missing ? null : errorText(e)
                });
                continue;
            }
            let failure: string | null = null;
            const accountOf = accountResolver(root, sessionAccounts);
            for (const path of await listJsonl(root.path)) {
                files += 1;
                try {
                    if (await this.readFileInto(path, root.provider, accountOf)) {
                        changedFiles += 1;
                    }
                } catch (e) {
                    // One unreadable transcript is not the root failing; the count simply misses it.
                    failure ??= errorText(e);
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

    private async readFileInto(path: string, provider: 'claude' | 'codex', accountOf: AccountOf): Promise<boolean> {
        const info = await stat(path);
        const known = this.index.get(path);
        if (known !== undefined && known.provider === provider && known.size === info.size && known.mtimeMs === info.mtimeMs) {
            return false;
        }
        const grown = known !== undefined && known.provider === provider && info.size > known.size;
        const from = grown ? known.offset : 0;
        const text = await readFrom(path, from);
        const parsed = parseChunk(text, provider, from, grown ? known.codex : null);
        const before = grown ? known.records : [];
        const entry: IndexedFile = {
            provider,
            size: info.size,
            mtimeMs: info.mtimeMs,
            offset: parsed.offset,
            // Folding here keeps the streaming copies of one message out of the index entirely.
            records: foldByKey([...before, ...withAccount(parsed.records, accountOf)]),
            tail: withAccount(parsed.tail, accountOf),
            codex: parsed.codex
        };
        this.index.set(path, entry);
        this.dirty = true;
        return true;
    }
}
