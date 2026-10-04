import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ChatInfo, ProviderCapabilities } from '@ruimte/agent-contracts';
import { chatHost, setChatHost } from '../../../host';
import { ChatScopeContext, type ChatScope } from '../../../scope';
import { useChats } from '../../../state/chats';
import { useProvidersStore } from '../../../state/providers';
import { AssistantRow, ReplyHeader } from './MessageRows';
import { ReplyContext } from '../reply-context';

const scope: ChatScope = {
    id: 'reply-heading-test',
    keyOf: (chatId) => `reply-heading-test/${chatId}`,
    owns: (key) => key.startsWith('reply-heading-test/'),
    transport: {} as ChatScope['transport'],
    chats: {} as ChatScope['chats']
};
const authorBefore = chatHost().useReplyAuthor;
const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { 'agent-chat': { rows: { reply: { agent: 'Agent' } } } } } });
const item = { id: 'answer', kind: 'assistant' as const, turnId: null, createdAt: 0, text: '', streaming: false };
const capabilities: ProviderCapabilities = {
    chat: true,
    terminal: true,
    hooks: false,
    streamsToolOutput: false,
    diffs: 'none',
    attachments: false,
    mentions: false,
    denyReason: false,
    allowAlways: false,
    asyncQuestions: false,
    compaction: 'none',
    reportsCost: false,
    reportsContextWindow: false,
    reportsThinking: false,
    slashCommands: false
};
function render(context: { provider: ChatInfo['provider']; chatId?: string } | null = null) {
    return renderToStaticMarkup(
        createElement(
            I18nextProvider,
            { i18n },
            createElement(
                ChatScopeContext.Provider,
                { value: scope },
                createElement(
                    ReplyContext.Provider,
                    { value: context },
                    createElement(AssistantRow, { chatId: 'parent', item }),
                    createElement(ReplyHeader, { chatId: 'parent', at: null })
                )
            )
        )
    );
}

beforeEach(() => {
    useProvidersStore.getState().setProviders(scope.id, [
        { kind: 'codex', name: 'Codex', installed: true, version: '1', models: [], defaultModel: null, capabilities, resumeCommand: '' },
        { kind: 'claude', name: 'Claude Code', installed: true, version: '1', models: [], defaultModel: null, capabilities, resumeCommand: '' }
    ]);
    const info: ChatInfo = {
        chatId: 'parent',
        provider: 'codex',
        cwd: '/parent',
        agentSessionId: null,
        model: null,
        selection: { model: 'm', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 0, costUsd: 0, turns: 0 },
        createdAt: 0
    };
    useChats.getState().reset(scope.keyOf('parent'), info, []);
    // Server rendering reads Zustand's initial snapshot instead of the current browser state.
    useProvidersStore.getInitialState().byScope[scope.id] = useProvidersStore.getState().byScope[scope.id]!;
    useChats.getInitialState().byKey[scope.keyOf('parent')] = useChats.getState().byKey[scope.keyOf('parent')]!;
    setChatHost({ useReplyAuthor: () => null });
});

afterEach(() => {
    delete useProvidersStore.getInitialState().byScope[scope.id];
    delete useChats.getInitialState().byKey[scope.keyOf('parent')];
    setChatHost({ useReplyAuthor: authorBefore });
    useProvidersStore.getState().forget(scope.id);
    useChats.getState().forget(scope.keyOf('parent'));
});

describe('reply identity in a child conversation', () => {
    test('a Claude child under Codex has its own heading, and returning keeps the root heading', () => {
        expect(render({ provider: 'claude', chatId: 'child' })).toContain('>Claude Code</h3>');
        expect(render()).toContain('>Codex</h3>');
    });

    test('a delegated chat uses its own named author in both heading and header', () => {
        setChatHost({ useReplyAuthor: (_scopeId, chatId) => ({ name: chatId === 'child' ? 'Child author' : 'Parent author' }) });
        const child = render({ provider: 'claude', chatId: 'child' });
        expect(child).toContain('>Child author</h3>');
        expect(child).not.toContain('Parent author');
        expect(render()).toContain('>Parent author</h3>');
    });

    test('a native transcript never borrows the root author', () => {
        setChatHost({ useReplyAuthor: () => ({ name: 'Parent author' }) });
        const child = render({ provider: 'claude' });
        expect(child).toContain('>Claude Code</h3>');
        expect(child).not.toContain('Parent author');
    });
});
