import type { ChatItem } from '@ruimte/contracts';
import type { SpawnChatProcess } from './chat-process.ts';
import { CodexProtocol } from './codex-protocol.ts';
import { CodexTransport } from './codex-transport.ts';
import { readingThread, settledReading } from './subagent-projection.ts';

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

/*
 * A page asked of an app-server started for this one question, for a chat whose own process is not
 * running. The app-server reads a thread it never loaded from disk (checked against codex-cli 0.154.0),
 * so nothing has to be resumed first.
 */
export const listThreadItemsOnce = async (spec: CodexProcessSpec, params: ThreadItemsParams): Promise<unknown> => {
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
        return await transport.request('thread/items/list', params);
    } finally {
        transport.end();
        transport.kill('SIGTERM');
    }
};
