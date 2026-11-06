import { describe, expect, test } from 'bun:test';
import type { ChatExternalSession, ChatSearchHit } from '@ruimte/contracts';
import { chatSearchState, externalMatching, groupByChat, type ChatSearchAnswer } from './palette-chats';

const hit = (chatId: string, itemId: string): ChatSearchHit => ({
    chatId,
    itemId,
    author: 'person',
    snippet: 'a cache',
    matchStart: 2,
    matchLength: 5,
    createdAt: 1
});

const answer: ChatSearchAnswer = {
    projectId: 'p1',
    query: 'cache',
    hits: [hit('a', 'a1'), hit('a', 'a2'), hit('b', 'b1')],
    chats: [
        { chatId: 'a', title: 'Alpha' },
        { chatId: 'b', title: 'Beta' }
    ],
    searched: 2,
    failed: [],
    truncated: false,
    cancelled: false,
    failure: null
};

describe('chatSearchState', () => {
    test('is settled for the query it answered', () => {
        expect(chatSearchState(answer, 'p1', ' cache ')).toMatchObject({ busy: false, hits: answer.hits });
    });

    test('marks the answer of an earlier query, or of another project, as not current', () => {
        expect(chatSearchState(answer, 'p1', 'cach').busy).toBe(true);
        expect(chatSearchState(answer, 'p2', 'cache').busy).toBe(true);
    });

    test('shows nothing without a project or a query', () => {
        expect(chatSearchState(answer, null, 'cache')).toMatchObject({ hits: [], busy: false });
        expect(chatSearchState(answer, 'p1', '  ')).toMatchObject({ hits: [], busy: false });
    });
});

describe('groupByChat', () => {
    test('puts the hits under their chat', () => {
        const groups = groupByChat(answer.hits, answer.chats);
        expect(groups.map((group) => [group.title, group.hits.length])).toEqual([
            ['Alpha', 2],
            ['Beta', 1]
        ]);
    });
});

describe('externalMatching', () => {
    const session = (sessionId: string, title: string, provider: 'claude' | 'codex'): ChatExternalSession => ({
        provider,
        sessionId,
        title,
        updatedAt: 1,
        cwd: '/work'
    });
    const sessions = [session('s1', 'Fix the cache layer', 'claude'), session('s2', 'Write docs', 'codex')];

    test('lists everything for an empty query', () => {
        expect(externalMatching(sessions, ' ')).toHaveLength(2);
    });

    test('needs every word, in the title or the provider', () => {
        expect(externalMatching(sessions, 'cache fix').map((entry) => entry.sessionId)).toEqual(['s1']);
        expect(externalMatching(sessions, 'codex').map((entry) => entry.sessionId)).toEqual(['s2']);
        expect(externalMatching(sessions, 'cache docs')).toEqual([]);
    });
});
