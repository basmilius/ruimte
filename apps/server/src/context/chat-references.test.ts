import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { ChatItem, ProjectCanvasView } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';
import { runContext } from '../cli/context.ts';
import { ProjectIndex } from '../projects/project-index.ts';
import { chatReferenceNote, referencedChats, resolveChatReferences } from './chat-references.ts';
import { handleContextRequest } from './context-route.ts';
import { ContextStore } from './context-store.ts';

const canvas: ProjectCanvasView = {
    id: 'main',
    name: 'Canvas',
    kind: 'canvas',
    nodes: [
        { id: 'asker', kind: 'chat', title: 'Planner', x: 0, y: 0, w: 400, h: 300 },
        { id: 'earlier', kind: 'chat', title: 'Auth "rewrite"', x: 500, y: 0, w: 400, h: 300 },
        { id: 'shell', kind: 'terminal', title: 'dev server', x: 0, y: 400, w: 400, h: 300 }
    ],
    texts: [],
    edges: [],
    layouts: []
};

const index = new ProjectIndex();
index.set('project-a', '/work/a', {
    views: [canvas, { id: 'standalone', kind: 'chat', name: 'Release notes', node: { provider: 'codex' } }]
});
index.set('project-b', '/work/b', {
    views: [{ id: 'elsewhere', kind: 'chat', name: 'Other project', node: { provider: 'claude' } }]
});

const titleFor = (fromId: string) => (id: string) => index.chatTitleBeside(fromId, id);

const earlierThread: ChatItem[] = [
    { id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Move the tokens to the shell' },
    { id: 'a1', kind: 'assistant', createdAt: 2, turnId: 't1', text: 'The refresh token now stays in the shell.', streaming: false }
];

describe('chat references', () => {
    test('only a chat of the same project resolves, under its current title', () => {
        expect(resolveChatReferences(['earlier', 'standalone', 'shell', 'elsewhere', 'asker', 'gone', 'earlier'], titleFor('asker'))).toEqual([
            { id: 'earlier', title: 'Auth "rewrite"' },
            { id: 'standalone', title: 'Release notes' }
        ]);
        expect(resolveChatReferences(undefined, titleFor('asker'))).toEqual([]);
    });

    test('the note names each chat by title and the command that reads it', () => {
        expect(chatReferenceNote([])).toBeNull();
        expect(chatReferenceNote([{ id: 'earlier', title: 'Auth "rewrite"' }])).toBe(
            [
                'The person attached a chat of this project to this message. Read that conversation with the command below before you answer.',
                '- "Auth \\"rewrite\\"": `ruimte-context read earlier`'
            ].join('\n')
        );
        expect(
            chatReferenceNote([
                { id: 'earlier', title: 'A' },
                { id: 'standalone', title: 'B' }
            ])
        ).toContain('Read each conversation');
    });

    test('a chat is readable once a message of the reader attached it, and never listed', () => {
        const thread: ChatItem[] = [
            { id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'See this', chats: ['earlier', 'elsewhere'] },
            { id: 'a1', kind: 'assistant', createdAt: 2, turnId: 't1', text: 'Read it.', streaming: false, chats: ['shell'] } as ChatItem
        ];
        expect(referencedChats(thread, titleFor('asker'))).toEqual([{ id: 'earlier', kind: 'chat', title: 'Auth "rewrite"' }]);
    });
});

describe('reading an attached chat', () => {
    const threads = new Map<string, ChatItem[]>([
        ['asker', []],
        ['earlier', earlierThread]
    ]);
    const store = new ContextStore({
        sources: () => [],
        referenced: (targetId) => referencedChats(threads.get(targetId) ?? [], titleFor(targetId)),
        terminalText: async () => null,
        chatItems: (id) => threads.get(id) ?? null,
        drawingElements: async () => null,
        diagramDocument: async () => null
    });
    const host = {
        locate: () => null,
        context: { list: (id: string) => store.list(id), read: store.answer.bind(store) }
    } as Partial<CanvasHost> as CanvasHost;
    const restore: Array<() => void> = [];

    afterEach(() => {
        for (const undo of restore.splice(0)) {
            undo();
        }
    });

    /* The command the note hands the agent, run by the real CLI against the real route. */
    const run = async (note: string): Promise<{ code: number; stdout: string }> => {
        const command = /`ruimte-context (read \S+)`/.exec(note)?.[1];
        expect(command).toBeDefined();
        const requests = spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
            const request = new Request(input, init);
            return handleContextRequest(request, new URL(request.url).pathname, { targetForToken: (token) => (token === 'tok' ? 'asker' : null), host });
        }) as typeof fetch);
        let stdout = '';
        const out = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdout += String(chunk);
            return true;
        });
        const log = spyOn(console, 'log').mockImplementation((...parts) => {
            stdout += `${parts.join(' ')}\n`;
        });
        const quiet = spyOn(process.stderr, 'write').mockImplementation(() => true);
        restore.push(...[requests, out, log, quiet].map((spy) => () => spy.mockRestore()));
        const code = await runContext(command!.split(' '), { RUIMTE_CONTEXT_URL: 'http://daemon.test/context', RUIMTE_CONTEXT_TOKEN: 'tok' });
        return { code, stdout };
    };

    test('the command in the note reads the conversation once the message is in the thread', async () => {
        const note = chatReferenceNote(resolveChatReferences(['earlier'], titleFor('asker')))!;
        expect((await run(note)).code).toBe(3);

        threads.set('asker', [{ id: 'u1', kind: 'user', createdAt: 1, turnId: 't1', text: 'Carry on from there', chats: ['earlier'] }]);
        const read = await run(note);
        expect(read.code).toBe(0);
        expect(read.stdout).toContain('The refresh token now stays in the shell.');
        expect(store.list('asker')).toEqual([]);
    });
});
