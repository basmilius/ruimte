import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { CodedError } from '@adecore/agents/coded-error';
import type { AgentEvent } from '@adecore/agents/events';
import { KeyedSerializer } from '@adecore/agents/serializer';
import { splitLines } from '@adecore/merge';
import {
    PROVENANCE_LIMITS,
    type AgentKind,
    type ChatToolItem,
    type ChatTurnItem,
    type ProvenanceReadResult,
    type ProvenanceReviewState,
    type ProvenanceRun
} from '@ruimte/contracts';
import { isInside } from '../canvas/project-paths.ts';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { linesAtHead, linesInTree, MAX_TEXT_BYTES, repositoryOf } from './file-versions.ts';
import { hashLines, sameLines } from './line-hash.ts';
import { ProvenanceStore } from './provenance-store.ts';
import { boundedBefore, dropCommitted, lineCount, locatedHunks, mapRuns, uncoveredRanges, writtenHunks, type FileRecord, type WriteSignature } from './runs.ts';
import { toolWrites } from './tool-writes.ts';

export class ProvenanceError extends CodedError<'forbidden' | 'not-found'> {}

/* Runs older than this are dropped; whoever wrote the lines is in the history of the checkout by then. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RUNS_PER_FILE = 500;
const MAX_FILES_PER_PROJECT = 300;
/* The sweep that checks every record of a project for files that are gone runs at most this often, unless the project holds too many. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/* How many tool calls and turns are remembered as done, so an item that is sent again records nothing twice. */
const REMEMBERED = 2000;

/* What the daemon knows of a chat that the events do not carry. */
export interface ProvenanceChat {
    provider: AgentKind;
    cwd: string;
    /* The tree of the chat's folder at the start of the turn; absent outside a repository. */
    checkpointOf(turnId: string): string | undefined;
    /* The place of the turn in its chat, from 1. */
    turnNumberOf(turnId: string): number | null;
    /* What the person wrote to open the turn; null for a turn the daemon opened itself. */
    promptOf(turnId: string): string | null;
}

export interface ProvenanceOptions {
    home: string;
    /* The project a chat belongs to and the folder it is in; null for a chat no project places. */
    locate(chatId: string): { projectId: string; folder: string } | null;
    folderOf(projectId: string): string | null;
    chat(chatId: string): ProvenanceChat | null;
    /* The clients that have the project open, which is who hears a change. */
    holders(projectId: string): string[];
    now?: () => number;
}

interface Job {
    projectId: string;
    path: string;
    chatId: string;
    turnId: string;
    chat: ProvenanceChat;
    via: ProvenanceRun['via'];
    signature: WriteSignature;
}

function remember(seen: Set<string>, key: string): boolean {
    if (seen.has(key)) {
        return false;
    }
    seen.add(key);
    if (seen.size > REMEMBERED) {
        seen.delete(seen.values().next().value!);
    }
    return true;
}

async function readLines(path: string): Promise<{ lines: string[]; mtime: number } | null> {
    try {
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_TEXT_BYTES) {
            return null;
        }
        const text = await readFile(path, 'utf8');
        return text.includes('\0') ? null : { lines: splitLines(text), mtime: info.mtimeMs };
    } catch {
        return null;
    }
}

/*
 * Who wrote which lines of a file. An observer of the chats: it only notes, in the daemon's own
 * folder, and never acts on what it sees. A write the CLI reports is found again in the file on
 * disk, and a turn that changed files only its checkpoint shows (a shell command, a formatter)
 * is noted when the turn settles, with `via: 'checkpoint'`.
 */
export class ProvenanceService {
    private readonly store: ProvenanceStore;
    private readonly options: ProvenanceOptions;
    private readonly now: () => number;
    private readonly sinks = new ClientSinks();
    private readonly writes = new KeyedSerializer();
    private readonly pending = new Set<Promise<unknown>>();
    private readonly seenTools = new Set<string>();
    private readonly seenTurns = new Set<string>();
    private readonly settledTurns = new Set<string>();
    /* The files a running turn wrote, which get their last, not live, event when it ends. */
    private readonly touched = new Map<string, { projectId: string; chatId: string; turnId: string; paths: Set<string> }>();
    private readonly lastSweep = new Map<string, number>();

    constructor(options: ProvenanceOptions) {
        this.options = options;
        this.store = new ProvenanceStore(options.home);
        this.now = options.now ?? Date.now;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* For `chats.observe()`. */
    consume(event: AgentEvent): void {
        if (event.event !== 'chat.event' || event.payload.event.type !== 'item') {
            return;
        }
        const { chatId } = event.payload;
        const item = event.payload.event.item;
        if (item.kind === 'tool') {
            this.toolItem(chatId, item);
        } else if (item.kind === 'turn') {
            this.turnItem(chatId, item);
        }
    }

    /* Resolves once everything the events asked for is on disk. */
    async idle(): Promise<void> {
        while (this.pending.size > 0) {
            await Promise.allSettled([...this.pending]);
        }
    }

    /* The runs of a file, mapped onto the text on disk now. */
    async read(projectId: string, path: string): Promise<ProvenanceReadResult> {
        this.require(projectId, path);
        return this.queue(projectId, path, async () => {
            const current = await readLines(path);
            if (current === null) {
                await this.store.remove(projectId, path);
                return { mtime: 0, lines: 0, runs: [] };
            }
            const stored = await this.store.read(projectId, path);
            if (stored === null) {
                return { mtime: current.mtime, lines: current.lines.length, runs: [] };
            }
            const hashes = hashLines(current.lines);
            const runs = await this.refreshed(stored, hashes, path, await repositoryOf(dirname(path)));
            if (!sameLines(stored.lineHashes, hashes) || runs.length !== stored.runs.length || JSON.stringify(runs) !== JSON.stringify(stored.runs)) {
                await this.persist(projectId, { version: 1, path, lineHashes: hashes, mtime: current.mtime, runs });
            }
            return { mtime: current.mtime, lines: current.lines.length, runs };
        });
    }

    /* Sets what a person decided about runs; a run cut in pieces takes the state in every piece. */
    async review(projectId: string, path: string, runIds: readonly string[], state: ProvenanceReviewState): Promise<number> {
        this.require(projectId, path);
        return this.queue(projectId, path, async () => {
            const stored = await this.store.read(projectId, path);
            if (stored === null) {
                return 0;
            }
            const wanted = new Set(runIds);
            let updated = 0;
            const runs = stored.runs.map((run) => {
                if (!wanted.has(run.id) || run.review === state) {
                    return run;
                }
                updated++;
                return { ...run, review: state };
            });
            const changed = runs.find((run) => wanted.has(run.id));
            if (updated > 0 && changed !== undefined) {
                await this.store.write(projectId, { ...stored, runs });
                this.announce(projectId, path, changed.chatId, changed.turnId, false);
            }
            return updated;
        });
    }

    /* Drops every record of a project that left the registry, once the writes that were in flight are done. */
    async forget(projectId: string): Promise<void> {
        await this.idle();
        this.lastSweep.delete(projectId);
        await this.store.removeProject(projectId);
    }

    /* Every file request stops at the project's folder, so a client cannot read the records of a path it could not read. */
    private require(projectId: string, path: string): void {
        const folder = this.options.folderOf(projectId);
        if (folder === null || !isInside(folder, path)) {
            throw new ProvenanceError('forbidden', `${path} is not in project ${projectId}`);
        }
    }

    private queue<T>(projectId: string, path: string, work: () => Promise<T>): Promise<T> {
        return this.track(this.writes.run(`${projectId}\0${path}`, work));
    }

    private track<T>(work: Promise<T>): Promise<T> {
        const tracked = work.catch(() => undefined);
        this.pending.add(tracked);
        void tracked.then(() => this.pending.delete(tracked));
        return work;
    }

    private fail(what: string, e: unknown): void {
        console.error(`Noting ${what} failed:`, e instanceof Error ? e.message : e);
    }

    private announce(projectId: string, path: string, chatId: string, turnId: string, live: boolean): void {
        for (const clientId of this.options.holders(projectId)) {
            this.sinks.to(clientId, { event: 'provenance.changed', payload: { projectId, path, chatId, turnId, live } });
        }
    }

    private toolItem(chatId: string, item: ChatToolItem): void {
        if (item.turnId === null || (item.state !== 'running' && item.state !== 'done')) {
            return;
        }
        const place = this.options.locate(chatId);
        const chat = place === null ? null : this.options.chat(chatId);
        if (place === null || chat === null) {
            return;
        }
        const writes = toolWrites(item, chat.cwd).filter((write) => isInside(place.folder, write.path));
        if (writes.length === 0 || !remember(this.seenTools, `${chatId}\0${item.toolUseId}\0${item.state}`)) {
            return;
        }
        const { turnId } = item;
        const turn = this.touched.get(`${chatId}\0${turnId}`) ?? { projectId: place.projectId, chatId, turnId, paths: new Set<string>() };
        this.touched.set(`${chatId}\0${turnId}`, turn);
        for (const write of writes) {
            turn.paths.add(write.path);
            if (item.state === 'running') {
                this.announce(place.projectId, write.path, chatId, turnId, true);
                continue;
            }
            const job: Job = { projectId: place.projectId, path: write.path, chatId, turnId, chat, via: 'tool', signature: write.signature };
            void this.queue(place.projectId, write.path, async () => {
                await this.record(job);
                this.announce(place.projectId, write.path, chatId, turnId, true);
            }).catch((e: unknown) => this.fail(write.path, e));
        }
    }

    private turnItem(chatId: string, item: ChatTurnItem): void {
        const key = `${chatId}\0${item.id}`;
        if (item.state !== 'running' && remember(this.seenTurns, key)) {
            this.endTurn(key);
        }
        if (item.checkpoint !== undefined && item.checkpointDiff !== undefined && remember(this.settledTurns, key)) {
            this.settleTurn(
                chatId,
                item.id,
                item.checkpointDiff.files.flatMap((file) => (file.kind === 'delete' || file.omitted === 'binary' ? [] : [file.path]))
            );
        }
    }

    /* The files the turn wrote stop being live; queued behind their writes, so the last event is the last word. */
    private endTurn(key: string): void {
        const turn = this.touched.get(key);
        this.touched.delete(key);
        for (const path of turn?.paths ?? []) {
            void this.queue(turn!.projectId, path, async () => this.announce(turn!.projectId, path, turn!.chatId, turn!.turnId, false));
        }
    }

    private settleTurn(chatId: string, turnId: string, files: readonly string[]): void {
        const place = this.options.locate(chatId);
        const chat = place === null ? null : this.options.chat(chatId);
        if (place === null || chat === null || files.length === 0) {
            return;
        }
        void this.track(
            (async () => {
                const top = await repositoryOf(chat.cwd);
                if (top === null) {
                    return;
                }
                for (const file of files) {
                    const path = join(top, file);
                    if (!isInside(place.folder, path)) {
                        continue;
                    }
                    const job: Job = { projectId: place.projectId, path, chatId, turnId, chat, via: 'checkpoint', signature: { all: true, blocks: [] } };
                    await this.queue(place.projectId, path, async () => {
                        if (await this.record(job)) {
                            this.announce(place.projectId, path, chatId, turnId, false);
                        }
                    }).catch((e: unknown) => this.fail(path, e));
                }
            })()
        );
    }

    /* The runs of a record once the file changed, the old ones are cut and a commit may have taken lines over. */
    private async refreshed(stored: FileRecord, hashes: string[], path: string, top: string | null): Promise<ProvenanceRun[]> {
        const horizon = this.now() - MAX_AGE_MS;
        const mapped = mapRuns(stored.runs, stored.lineHashes, hashes).filter((run) => run.at >= horizon);
        if (top === null) {
            return mapped;
        }
        const head = await linesAtHead(top, relative(top, path));
        return dropCommitted(mapped, hashes, head === null ? null : hashLines(head));
    }

    /* Notes what one turn wrote in one file; answers whether the file's runs changed. */
    private async record(job: Job): Promise<boolean> {
        const { projectId, path, chat } = job;
        const current = await readLines(path);
        if (current === null) {
            await this.store.remove(projectId, path);
            return false;
        }
        const hashes = hashLines(current.lines);
        const stored = await this.store.read(projectId, path);
        const top = await repositoryOf(dirname(path));
        const existing = stored === null ? [] : await this.refreshed(stored, hashes, path, top);
        const tree = chat.checkpointOf(job.turnId);
        const previousLines = top !== null && tree !== undefined ? await linesInTree(top, tree, relative(top, path)) : null;
        const previous = previousLines === null ? (job.via === 'tool' ? (stored?.lineHashes ?? null) : null) : hashLines(previousLines);
        const hunks =
            previous === null
                ? job.via === 'tool'
                    ? locatedHunks(hashes, job.signature)
                    : []
                : writtenHunks(previous, previousLines, hashes, current.lines, job.signature);
        const turn = chat.turnNumberOf(job.turnId);
        const excerpt = (chat.promptOf(job.turnId) ?? '').trim().slice(0, PROVENANCE_LIMITS.promptExcerpt);
        const created: ProvenanceRun[] = [];
        for (const hunk of hunks) {
            const point = hunk.start === hunk.end;
            const gaps: Array<[number, number]> = point ? [[hunk.start, hunk.end]] : uncoveredRanges(hunk.start, hunk.end, existing);
            if (
                point &&
                existing.some((run) => lineCount(run) === 0 && run.start - 1 === hunk.start && run.chatId === job.chatId && run.turnId === job.turnId)
            ) {
                continue;
            }
            const whole = gaps.length === 1 && gaps[0]![0] === hunk.start && gaps[0]![1] === hunk.end;
            const replaced =
                previousLines !== null && hunk.trimmed !== true
                    ? previousLines.slice(hunk.baseStart, hunk.baseEnd)
                    : hunks.length === 1 && job.signature.blocks.length === 1
                      ? job.signature.blocks[0]!.removed
                      : [];
            const kept = whole ? boundedBefore(replaced) : undefined;
            for (const [from, to] of gaps) {
                created.push({
                    id: randomUUID(),
                    chatId: job.chatId,
                    turnId: job.turnId,
                    ...(turn === null ? {} : { turn }),
                    provider: chat.provider,
                    at: this.now(),
                    promptExcerpt: excerpt,
                    start: from + 1,
                    end: to,
                    ...(kept === undefined ? {} : { before: kept }),
                    review: 'pending',
                    via: job.via
                });
            }
        }
        const runs = [...existing, ...created].sort((left, right) => left.start - right.start || left.at - right.at);
        const capped = runs.length > MAX_RUNS_PER_FILE ? [...runs].sort((left, right) => right.at - left.at).slice(0, MAX_RUNS_PER_FILE) : runs;
        const changed = created.length > 0 || JSON.stringify(capped) !== JSON.stringify(stored?.runs ?? []);
        await this.persist(projectId, { version: 1, path, lineHashes: hashes, mtime: current.mtime, runs: capped }, stored === null);
        return changed;
    }

    /* A file with no runs keeps no record; a first record may push the project past what it keeps. */
    private async persist(projectId: string, record: FileRecord, created = false): Promise<void> {
        if (record.runs.length === 0) {
            await this.store.remove(projectId, record.path);
            return;
        }
        await this.store.write(projectId, record);
        if (created) {
            await this.sweep(projectId).catch((e: unknown) => this.fail(`the records of project ${projectId}`, e));
        }
    }

    /* Clears the records of files that are gone and of runs past their age, then the oldest records over the cap. */
    private async sweep(projectId: string): Promise<void> {
        const now = this.now();
        const files = await this.store.list(projectId);
        const due = now - (this.lastSweep.get(projectId) ?? -Infinity) >= SWEEP_INTERVAL_MS;
        if (!due && files.length <= MAX_FILES_PER_PROJECT) {
            return;
        }
        this.lastSweep.set(projectId, now);
        const alive: typeof files = [];
        for (const file of files) {
            const gone = await stat(file.record.path).then(
                () => false,
                () => true
            );
            if (gone || file.record.runs.every((run) => run.at < now - MAX_AGE_MS)) {
                await this.store.removeNamed(projectId, file.name);
            } else {
                alive.push(file);
            }
        }
        const oldest = alive.sort((left, right) => right.writtenAt - left.writtenAt).slice(MAX_FILES_PER_PROJECT);
        for (const file of oldest) {
            await this.store.removeNamed(projectId, file.name);
        }
    }
}
