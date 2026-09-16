import type { ChatInfo, ChatItem, ChatSubagentChangedEvent, ChatSubagentResult } from '@ruimte/contracts';
import { SYSTEM_WATCH, type DirectoryWatcher, type WatchSeams } from '../fs/watch-seam.ts';
import { findSubagentsDir, readSubagentMetas, TranscriptProjection } from './claude-transcript.ts';
import { listThreadItemsOnce, parseThreadItemsPage, projectCodexItems, type CodexProcessSpec, type ThreadItemsParams } from './codex-thread.ts';
import { ChatError } from './errors.ts';
import { readSubagentSettlement, type SubagentSettlement } from './subagent-settlement.ts';

const DEFAULT_PAGE = 60;
// How often an open panel asks a running Codex for the newest items of the thread it follows.
const CODEX_POLL_MS = 2000;
// A page asked of a process started for the question is kept this long, so paging back costs one process.
const CODEX_CACHE_MS = 5000;
// What a poll compares: enough of the newest end to see an item land or settle.
const CODEX_POLL_ITEMS = 10;
// Lines land in bursts; a panel is told once per burst, not once per line.
const CHANGE_SETTLE_MS = 150;
// Transcripts kept read, beyond the ones a client holds open.
const MAX_IDLE_PROJECTIONS = 8;
const CODEX_CURSOR = 'codex:';

/* What the reader needs of one chat, so a test can hand in a thread without a CLI. */
export interface SubagentChat {
    info: ChatInfo;
    /* Whether the chat's CLI runs now; a Codex child only works while the app-server of its parent does. */
    running: boolean;
    items(): ChatItem[];
    /* A page through the chat's own running app-server, or null when none runs. */
    listThreadItems(params: ThreadItemsParams): Promise<unknown> | null;
    noteNative(toolUseId: string, native: { agentId?: string; threadId?: string }): void;
}

export interface SubagentReaderOptions {
    chat(chatId: string): SubagentChat | null;
    /* Where Claude Code keeps its projects; empty when it has none on this machine. */
    claudeProjectsDir: string;
    /* How a Codex app-server is started for a chat whose own is not running. */
    codexProcess(info: ChatInfo): CodexProcessSpec;
    /* Tells one client that a conversation it holds has more in it. */
    notify(clientId: string, event: ChatSubagentChangedEvent): void;
    seams?: WatchSeams;
    now?(): number;
    listOnce?(spec: CodexProcessSpec, params: ThreadItemsParams): Promise<unknown>;
}

interface ClaudeFile {
    dir: string;
    path: string;
}

interface Hold {
    chatId: string;
    toolUseId: string;
    clients: Set<string>;
    stop: () => void;
}

const holdKey = (chatId: string, toolUseId: string): string => `${chatId}\n${toolUseId}`;

const findSubagent = (items: ChatItem[], toolUseId: string): ChatItem | undefined =>
    items.find((item) => item.kind === 'subagent' && item.toolUseId === toolUseId);

/*
 * The whole conversation of a subagent, which the chat's own thread only keeps the beginning of:
 * Claude's transcript beside the session, or the thread Codex keeps per agent. A client that holds a
 * conversation is told when it grows (a counted watch on Claude's folder, a poll of the running Codex)
 * for as long as it holds it, and the event carries nothing but that there is more.
 */
export class SubagentReader {
    private readonly options: SubagentReaderOptions;
    private readonly seams: WatchSeams;
    private readonly now: () => number;
    private readonly listOnce: (spec: CodexProcessSpec, params: ThreadItemsParams) => Promise<unknown>;
    private readonly claudeFiles = new Map<string, ClaudeFile>();
    // Keyed on the transcript path, with the chat it was read for so a grandchild's status can be found.
    private readonly projections = new Map<string, { chatId: string; projection: TranscriptProjection }>();
    // The subagents seen inside a Codex conversation, so a row of a grandchild knows its thread.
    private readonly codexRows = new Map<string, ChatItem>();
    private readonly codexCache = new Map<string, { at: number; result: unknown }>();
    // The newest end of every Codex thread as a reader last saw it, which is what a poll compares against.
    private readonly codexSeen = new Map<string, string>();
    private readonly holds = new Map<string, Hold>();
    private readonly dirWatches = new Map<string, { watcher: DirectoryWatcher; keys: Set<string> }>();
    private readonly changed = new Set<string>();
    private cancelSettle: (() => void) | null = null;

    constructor(options: SubagentReaderOptions) {
        this.options = options;
        this.seams = options.seams ?? SYSTEM_WATCH;
        this.now = options.now ?? Date.now;
        this.listOnce = options.listOnce ?? listThreadItemsOnce;
    }

    async read(chatId: string, toolUseId: string, cursor?: string, limit = DEFAULT_PAGE): Promise<ChatSubagentResult> {
        const chat = this.require(chatId);
        return chat.info.provider === 'codex' ? this.readCodex(chat, toolUseId, cursor, limit) : this.readClaude(chat, toolUseId, cursor, limit);
    }

    /* Every item, for an agent reading the conversation as text; a Codex thread is paged through to its start. */
    async readAll(chatId: string, toolUseId: string): Promise<ChatItem[]> {
        const chat = this.require(chatId);
        if (chat.info.provider !== 'codex') {
            return (await this.claudeProjection(chat, toolUseId)).items();
        }
        const pages: ChatItem[][] = [];
        let cursor: string | undefined;
        do {
            const page = await this.readCodex(chat, toolUseId, cursor, 100);
            pages.unshift(page.items);
            cursor = page.history.cursor ?? undefined;
        } while (cursor !== undefined);
        return pages.flat();
    }

    /*
     * What a Claude subagent's own transcript says about how it ended, for a row whose CLI is gone and
     * so will never send the notification; null when there is no transcript or it does not show an end.
     */
    async claudeSettlement(chatId: string, toolUseId: string): Promise<SubagentSettlement | null> {
        const chat = this.options.chat(chatId);
        if (!chat || chat.info.provider !== 'claude') {
            return null;
        }
        try {
            return await readSubagentSettlement((await this.claudeFile(chat, toolUseId)).path);
        } catch {
            return null;
        }
    }

    /* Keeps `clientId` told about this conversation until it lets go, closes its socket or the chat goes. */
    hold(clientId: string, chatId: string, toolUseId: string): void {
        const key = holdKey(chatId, toolUseId);
        const existing = this.holds.get(key);
        if (existing) {
            existing.clients.add(clientId);
            return;
        }
        const chat = this.options.chat(chatId);
        if (!chat) {
            return;
        }
        const stop = chat.info.provider === 'codex' ? this.pollCodex(key, chatId, toolUseId) : this.watchClaude(key);
        this.holds.set(key, { chatId, toolUseId, clients: new Set([clientId]), stop });
    }

    release(clientId: string, chatId: string, toolUseId: string): void {
        const key = holdKey(chatId, toolUseId);
        const hold = this.holds.get(key);
        if (!hold) {
            return;
        }
        hold.clients.delete(clientId);
        if (hold.clients.size === 0) {
            this.drop(key, hold);
        }
    }

    releaseClient(clientId: string): void {
        for (const hold of [...this.holds.values()]) {
            this.release(clientId, hold.chatId, hold.toolUseId);
        }
    }

    /* Forgets everything about a chat that is gone. */
    releaseChat(chatId: string): void {
        const ofChat = (key: string): boolean => key.startsWith(`${chatId}\n`);
        for (const [key, hold] of [...this.holds]) {
            if (ofChat(key)) {
                this.drop(key, hold);
            }
        }
        for (const [key, file] of [...this.claudeFiles]) {
            if (ofChat(key)) {
                this.claudeFiles.delete(key);
                this.projections.delete(file.path);
            }
        }
        for (const map of [this.codexRows, this.codexSeen]) {
            for (const key of [...map.keys()]) {
                if (ofChat(key)) {
                    map.delete(key);
                }
            }
        }
    }

    /* How many clients hold something, for a test that checks a socket let go of everything. */
    get holdCount(): number {
        return this.holds.size;
    }

    private require(chatId: string): SubagentChat {
        const chat = this.options.chat(chatId);
        if (!chat) {
            throw new ChatError('chat-not-found', `No chat ${chatId}`);
        }
        return chat;
    }

    private drop(key: string, hold: Hold): void {
        this.holds.delete(key);
        this.changed.delete(key);
        hold.stop();
    }

    /* Running while its row says so, whether that row is in the chat's thread or in a conversation read before. */
    private live(chat: SubagentChat, toolUseId: string, inside: ChatItem[]): boolean {
        const row = findSubagent(chat.items(), toolUseId) ?? findSubagent(inside, toolUseId);
        return row?.kind === 'subagent' && row.status === 'running';
    }

    private async readClaude(chat: SubagentChat, toolUseId: string, cursor: string | undefined, limit: number): Promise<ChatSubagentResult> {
        const projection = await this.claudeProjection(chat, toolUseId);
        const page = projection.page(limit, cursor);
        const seen = [...this.projections.values()].filter((entry) => entry.chatId === chat.info.chatId).flatMap((entry) => entry.projection.items());
        return { items: page.items, history: page.history, source: 'claude-transcript', live: this.live(chat, toolUseId, seen) };
    }

    private async claudeProjection(chat: SubagentChat, toolUseId: string): Promise<TranscriptProjection> {
        const file = await this.claudeFile(chat, toolUseId);
        let entry = this.projections.get(file.path);
        if (!entry) {
            entry = { chatId: chat.info.chatId, projection: new TranscriptProjection(file.path) };
            this.projections.set(file.path, entry);
            this.trimProjections();
        }
        if (!(await entry.projection.refresh())) {
            throw new ChatError('subagent-not-found', 'Claude has not written a transcript for this subagent');
        }
        return entry.projection;
    }

    private async claudeFile(chat: SubagentChat, toolUseId: string): Promise<ClaudeFile> {
        const key = holdKey(chat.info.chatId, toolUseId);
        const known = this.claudeFiles.get(key);
        if (known) {
            return known;
        }
        const sessionId = chat.info.agentSessionId;
        const dir = sessionId === null ? null : await findSubagentsDir(this.options.claudeProjectsDir, chat.info.cwd, sessionId);
        // A grandchild has a file of its own in the same folder, found by the call that opened it like any other.
        const meta = dir === null ? undefined : (await readSubagentMetas(dir)).find((candidate) => candidate.toolUseId === toolUseId);
        if (!dir || !meta) {
            throw new ChatError('subagent-not-found', 'Claude has not written a transcript for this subagent');
        }
        const file = { dir, path: meta.transcript };
        this.claudeFiles.set(key, file);
        chat.noteNative(toolUseId, { agentId: meta.agentId });
        return file;
    }

    /* The transcripts nobody holds are only a cache: past a handful, the oldest is read again when asked. */
    private trimProjections(): void {
        const held = new Set([...this.holds.values()].map((hold) => this.claudeFiles.get(holdKey(hold.chatId, hold.toolUseId))?.path));
        const idle = [...this.projections.keys()].filter((path) => !held.has(path));
        for (const path of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_PROJECTIONS))) {
            this.projections.delete(path);
        }
    }

    private async readCodex(chat: SubagentChat, toolUseId: string, cursor: string | undefined, limit: number): Promise<ChatSubagentResult> {
        const threadId = this.codexThread(chat, toolUseId);
        if (cursor !== undefined && !cursor.startsWith(CODEX_CURSOR)) {
            throw new ChatError('history-expired', 'The conversation changed. Reload its history.');
        }
        const params: ThreadItemsParams = {
            threadId,
            limit,
            sortDirection: 'desc',
            ...(cursor === undefined ? {} : { cursor: cursor.slice(CODEX_CURSOR.length) })
        };
        const { entries, nextCursor } = parseThreadItemsPage(await this.codexPage(chat, params));
        if (cursor === undefined) {
            // What a poll that starts after this read compares against, so a change in between is not lost.
            this.codexSeen.set(holdKey(chat.info.chatId, toolUseId), JSON.stringify(entries.slice(0, CODEX_POLL_ITEMS)));
        }
        const items = projectCodexItems([...entries].reverse(), this.now());
        for (const item of items) {
            if (item.kind === 'subagent') {
                this.codexRows.set(holdKey(chat.info.chatId, item.toolUseId), item);
            }
        }
        return {
            items,
            history: { cursor: nextCursor === null ? null : `${CODEX_CURSOR}${nextCursor}` },
            source: 'codex-thread',
            live: chat.running && this.live(chat, toolUseId, [...this.codexRows.values()])
        };
    }

    private codexThreadOf(chat: SubagentChat, toolUseId: string): string | null {
        const row = findSubagent(chat.items(), toolUseId) ?? this.codexRows.get(holdKey(chat.info.chatId, toolUseId));
        return row?.kind === 'subagent' ? (row.native?.threadId ?? null) : null;
    }

    private codexThread(chat: SubagentChat, toolUseId: string): string {
        const threadId = this.codexThreadOf(chat, toolUseId);
        if (threadId === null) {
            throw new ChatError('subagent-not-found', 'Codex has not said which thread this subagent works in');
        }
        return threadId;
    }

    private async codexPage(chat: SubagentChat, params: ThreadItemsParams): Promise<unknown> {
        const running = chat.listThreadItems(params);
        if (running !== null) {
            return running;
        }
        const key = JSON.stringify(params);
        const now = this.now();
        const cached = this.codexCache.get(key);
        if (cached && now - cached.at < CODEX_CACHE_MS) {
            return cached.result;
        }
        const result = await this.listOnce(this.options.codexProcess(chat.info), params);
        for (const [stale, entry] of [...this.codexCache]) {
            if (now - entry.at >= CODEX_CACHE_MS) {
                this.codexCache.delete(stale);
            }
        }
        this.codexCache.set(key, { at: now, result });
        return result;
    }

    /* One watch per subagents folder, however many of its transcripts are held. */
    private watchClaude(key: string): () => void {
        const file = this.claudeFiles.get(key);
        if (!file) {
            return () => undefined;
        }
        let shared = this.dirWatches.get(file.dir);
        if (!shared) {
            const watcher = this.seams.watch(file.dir, { recursive: false }, (_event, filename) => this.onClaudeChange(file.dir, filename));
            // A folder that disappears ends the growing, not the daemon.
            watcher.on('error', () => undefined);
            shared = { watcher, keys: new Set() };
            this.dirWatches.set(file.dir, shared);
        }
        shared.keys.add(key);
        return () => {
            const current = this.dirWatches.get(file.dir);
            current?.keys.delete(key);
            if (current && current.keys.size === 0) {
                current.watcher.close();
                this.dirWatches.delete(file.dir);
            }
        };
    }

    private onClaudeChange(dir: string, filename: string | null): void {
        for (const key of this.dirWatches.get(dir)?.keys ?? []) {
            const path = this.claudeFiles.get(key)?.path;
            // A platform that names no file could mean any of them.
            if (filename === null || (path !== undefined && path.endsWith(`/${filename}`))) {
                this.markChanged(key);
            }
        }
    }

    private pollCodex(key: string, chatId: string, toolUseId: string): () => void {
        let cancel: (() => void) | null = null;
        let stopped = false;
        const tick = async (): Promise<void> => {
            cancel = null;
            const chat = this.options.chat(chatId);
            const threadId = chat ? this.codexThreadOf(chat, toolUseId) : null;
            const asked = chat && threadId ? chat.listThreadItems({ threadId, limit: CODEX_POLL_ITEMS, sortDirection: 'desc' }) : null;
            if (asked !== null) {
                try {
                    const seen = JSON.stringify(parseThreadItemsPage(await asked).entries);
                    if (!stopped && this.codexSeen.get(key) !== seen) {
                        this.codexSeen.set(key, seen);
                        this.markChanged(key);
                    }
                } catch {
                    // The process went between the question and the answer; the next tick asks again.
                }
            }
            if (!stopped) {
                cancel = this.seams.schedule(() => tick(), CODEX_POLL_MS);
            }
        };
        cancel = this.seams.schedule(() => tick(), CODEX_POLL_MS);
        return () => {
            stopped = true;
            cancel?.();
        };
    }

    private markChanged(key: string): void {
        this.changed.add(key);
        if (this.cancelSettle !== null) {
            return;
        }
        this.cancelSettle = this.seams.schedule(() => this.flushChanged(), CHANGE_SETTLE_MS);
    }

    private flushChanged(): void {
        this.cancelSettle = null;
        const keys = [...this.changed];
        this.changed.clear();
        for (const key of keys) {
            const hold = this.holds.get(key);
            for (const clientId of hold?.clients ?? []) {
                this.options.notify(clientId, { chatId: hold!.chatId, toolUseId: hold!.toolUseId });
            }
        }
    }
}
