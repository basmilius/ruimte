/// <reference types="bun" />
import { defineAgentTool, defineNodeContext, defineServer, emit, log, onEvent, schedule, secrets, storage } from '@ruimte/extension/server';
import { issueText, openService, type TracklineIssue, type TracklineService } from './service';

const KEY = 'key';
const CHATS = 'chats';
const NOT_CONNECTED = 'Connect your Trackline account first';

/* An issue as a list shows it, with the chat a person started on it. */
export interface IssueRow extends TracklineIssue {
    chat: string | null;
    working: boolean;
}

// The chats that work now, by their id. Kept in memory: a restart hears each chat's state again.
const working = new Set<string>();

async function service(): Promise<TracklineService> {
    const key = await secrets.get(KEY);

    if (key === undefined || key === '') {
        throw new Error(NOT_CONNECTED);
    }

    return openService(key);
}

async function chatsByIssue(): Promise<Record<string, string>> {
    return (await storage.get<Record<string, string>>(CHATS)) ?? {};
}

async function textOf(key: string): Promise<string> {
    const account = await service();
    const issue = account.issue(key);

    if (issue === null) {
        throw new Error(`Trackline has no issue ${key}`);
    }

    return issueText(account, issue);
}

defineNodeContext<{ key: string }>('issue', async (node) => {
    try {
        return [{ text: await textOf(node.data.key) }];
    } catch (e) {
        return [{ text: e instanceof Error ? e.message : String(e) }];
    }
});

defineAgentTool<{ key: string }>({
    id: 'issue',
    description: 'Reads an issue of the Trackline account by its key, such as TRK-101, with its changes and their checks',
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: ({ key }) => textOf(key)
});

schedule({
    id: 'sync',
    every: '5m',
    run: async () => {
        const key = await secrets.get(KEY);

        if (key === undefined || key === '') {
            return;
        }

        const open = openService(key)
            .issues()
            .filter((issue) => issue.state === 'open').length;

        log.info(`Trackline has ${open} open issues`);
        emit('issues.changed', { open });
    }
});

onEvent('chat.status', ({ chat }) => {
    const before = working.has(chat.id);

    if (chat.status === 'running') {
        working.add(chat.id);
    } else {
        working.delete(chat.id);
    }

    if (before !== working.has(chat.id)) {
        emit('issues.changed');
    }
});

const api = defineServer({
    /* Keeps the key once the service knows it, and answers whose account it is. */
    async connect(key: string) {
        const { account } = openService(key.trim());

        await secrets.set(KEY, key.trim());
        emit('issues.changed');

        return account;
    },
    async disconnect() {
        await secrets.set(KEY, '');
        emit('issues.changed');
    },
    /* Null while no key is kept. */
    async account() {
        const key = await secrets.get(KEY);

        return key === undefined || key === '' ? null : openService(key).account;
    },
    async issues(): Promise<IssueRow[]> {
        const account = await service();
        const chats = await chatsByIssue();

        return account.issues().map((issue) => {
            const chat = chats[issue.key] ?? null;

            return { ...issue, chat, working: chat !== null && working.has(chat) };
        });
    },
    async text(key: string) {
        return textOf(key);
    },
    /* Remembers the chat a person started on an issue. */
    async assign(key: string, chat: string) {
        await storage.set(CHATS, { ...(await chatsByIssue()), [key]: chat });
        emit('issues.changed');
    }
});

export type TracklineServer = typeof api;
export default api;
