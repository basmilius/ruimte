import type { ChatItem } from '@ruimte/contracts';
import type { SpawnChatProcess } from './chat-process.ts';
import { CodexProtocol } from './codex-protocol.ts';
import { CodexTransport } from './codex-transport.ts';
import { ChatError } from './errors.ts';
import { readingThread, settledReading } from './subagent-projection.ts';
import { errorText } from '../error-text.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ThreadItemsParams {
    threadId: string;
    cursor?: string;
    limit: number;
    sortDirection: 'asc' | 'desc';
}

/* One `thread/items/list` answer as far as a reader needs it: the entries newest first, and the cursor to older ones. */
export const parseThreadItemsPage = (result: unknown): { entries: Record<string, unknown>[]; nextCursor: string | null } => {
    const data = isRecord(result) && Array.isArray(result.data) ? result.data.filter(isRecord) : [];
    const nextCursor = isRecord(result) && typeof result.nextCursor === 'string' && result.nextCursor !== '' ? result.nextCursor : null;
    return { entries: data, nextCursor };
};

const userText = (content: unknown): string =>
    Array.isArray(content)
        ? content
              .filter(isRecord)
              .map((block) => (typeof block.text === 'string' ? block.text : ''))
              .filter((text) => text !== '')
              .join('\n')
        : '';

/*
 * Items of a Codex thread, oldest first, through the mapping the live stream uses. Every entry is
 * projected on its own: consecutive reasoning would otherwise become one thinking item whose id
 * depends on where a page happened to start, and a client merging two reads by id would show that
 * thought twice.
 */
export const projectCodexItems = (entriesOldestFirst: Record<string, unknown>[], now: number): ChatItem[] => {
    const { thread, projector } = readingThread('Codex', () => now);
    const protocol = new CodexProtocol(0);
    for (const entry of entriesOldestFirst) {
        const item = isRecord(entry.item) ? entry.item : null;
        if (!item || typeof item.id !== 'string') {
            continue;
        }
        projector.reset();
        if (item.type === 'userMessage') {
            const text = userText(item.content);
            if (text !== '') {
                thread.upsert({ id: `user-${item.id}`, kind: 'user', createdAt: now, turnId: null, text });
            }
            continue;
        }
        for (const event of protocol.handle({ method: 'item/completed', params: { item } })) {
            projector.project(0, event);
        }
    }
    return thread.list().map(settledReading);
};

const CLIENT_INFO = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

export interface CodexProcessSpec {
    command: string[];
    cwd: string;
    env: Record<string, string>;
    spawn?: SpawnChatProcess;
}

/* An app-server started for the questions `work` asks and ended after them, for a chat whose own process may not run. */
const withAppServer = async <T>(spec: CodexProcessSpec, work: (transport: CodexTransport) => Promise<T>): Promise<T> => {
    const transport = new CodexTransport({
        command: spec.command,
        cwd: spec.cwd,
        env: spec.env,
        ...(spec.spawn ? { spawn: spec.spawn } : {}),
        onFrame: () => undefined,
        onExit: () => undefined
    });
    try {
        await transport.request('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true, requestAttestation: false } });
        transport.notify('initialized', {});
        return await work(transport);
    } finally {
        transport.end();
        transport.kill('SIGTERM');
    }
};

/*
 * A page asked of an app-server started for this one question, for a chat whose own process is not
 * running. The app-server reads a thread it never loaded from disk (checked against codex-cli 0.154.0),
 * so nothing has to be resumed first.
 */
export const listThreadItemsOnce = (spec: CodexProcessSpec, params: ThreadItemsParams): Promise<unknown> =>
    withAppServer(spec, (transport) => transport.request('thread/items/list', params));

export interface ThreadForkParams {
    threadId: string;
    /* The turn the fork goes on after; null for all of it. */
    at: { turnId: string } | { turns: number } | null;
    /* The thread options the fork runs with: `cwd`, `model` and what the runtime mode says. */
    options: Record<string, unknown>;
}

/* The id of the `turns`-th turn of a thread, oldest first, or null when it has fewer. */
const nthTurnId = async (transport: CodexTransport, threadId: string, turns: number): Promise<string | null> => {
    let seen = 0;
    let cursor: string | null = null;
    do {
        const page = await transport.request('thread/turns/list', { threadId, limit: 100, sortDirection: 'asc', ...(cursor === null ? {} : { cursor }) });
        const data = isRecord(page) && Array.isArray(page.data) ? page.data.filter(isRecord) : [];
        for (const turn of data) {
            if (++seen === turns) {
                return typeof turn.id === 'string' ? turn.id : null;
            }
        }
        cursor = isRecord(page) && typeof page.nextCursor === 'string' && page.nextCursor !== '' ? page.nextCursor : null;
    } while (cursor !== null);
    return null;
};

/*
 * A new thread with the turns of `threadId` up to the one named, through `thread/fork`, and its id.
 * Asked of a process of its own even while the chat's backend holds the thread: measured against
 * codex-cli 0.154.0, with the original answering on in its own process afterwards.
 */
export const forkThreadOnce = (spec: CodexProcessSpec, params: ThreadForkParams): Promise<string> =>
    withAppServer(spec, async (transport) => {
        let lastTurnId: string | null = null;
        if (params.at !== null) {
            lastTurnId = 'turnId' in params.at ? params.at.turnId : await nthTurnId(transport, params.threadId, params.at.turns);
            if (lastTurnId === null) {
                throw new ChatError('turn-not-found', 'Codex keeps fewer turns in this thread than the chat shows, so the turn could not be found');
            }
        }
        let result: unknown;
        try {
            result = await transport.request('thread/fork', {
                threadId: params.threadId,
                excludeTurns: true,
                ...params.options,
                ...(lastTurnId === null ? {} : { lastTurnId })
            });
        } catch (error) {
            throw new ChatError('fork-failed', errorText(error));
        }
        const thread = isRecord(result) && isRecord(result.thread) ? result.thread : null;
        if (thread === null || typeof thread.id !== 'string' || thread.id === '') {
            throw new ChatError('fork-failed', 'Codex answered the fork without a thread');
        }
        return thread.id;
    });
