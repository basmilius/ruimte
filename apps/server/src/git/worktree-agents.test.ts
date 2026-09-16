import { describe, expect, test } from 'bun:test';
import type { ChatInfo, SessionInfo } from '@ruimte/contracts';
import { worktreeAgents } from './worktree-agents.ts';

const chat = (chatId: string, cwd: string, extra: Partial<ChatInfo> = {}): ChatInfo =>
    ({ chatId, cwd, running: false, activeTurnId: null, ...extra }) as ChatInfo;
const session = (sessionId: string, cwd: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({ sessionId, cwd, exited: false, ...extra }) as SessionInfo;

describe('worktreeAgents', () => {
    test('finds chats and terminals inside the worktree and the node it was made for, with whether each is in a turn', () => {
        const stopped: string[] = [];
        const agents = worktreeAgents({
            chats: () => [
                chat('chat-lexer', '/wt/lexer', { running: true, activeTurnId: 'turn-1' }),
                chat('chat-idle', '/wt/lexer/src', { running: true }),
                chat('chat-else', '/project')
            ],
            sessions: () => [
                session('term-agent', '/wt/lexer', { agent: { live: true, status: 'running' } as SessionInfo['agent'] }),
                session('term-done', '/wt/lexer', { exited: true }),
                session('term-moved', '/elsewhere'),
                session('term-sibling', '/wt/lexer-2')
            ],
            stopNode: async (nodeId) => {
                stopped.push(nodeId);
            }
        });

        expect(agents.in('/wt/lexer', 'term-moved')).toEqual([
            { nodeId: 'chat-lexer', working: true, live: true },
            { nodeId: 'chat-idle', working: false, live: true },
            { nodeId: 'term-agent', working: true, live: true },
            { nodeId: 'term-done', working: false, live: false },
            { nodeId: 'term-moved', working: false, live: true }
        ]);
        void agents.stop('chat-lexer');
        expect(stopped).toEqual(['chat-lexer']);
    });
});
