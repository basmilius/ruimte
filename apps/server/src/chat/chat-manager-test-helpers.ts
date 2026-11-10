import { OPEN_BOUNDS } from '../sessions/open-bounds-test-helpers.ts';
import { ChatManager, type ChatFacts } from './chat-manager.ts';

/* The facts of a daemon that knows nothing about the chat: no lineage, no project, nobody to refuse it. */
export function quietFacts(overrides: Partial<ChatFacts> = {}): ChatFacts {
    return {
        depthOf: () => 0,
        standalone: () => false,
        computer: () => false,
        reachOpenProjects: () => false,
        visualReplies: () => false,
        databases: () => false,
        openingAgent: () => undefined,
        contextSources: () => [],
        reference: () => null,
        messageNotes: () => null,
        unshownMessages: () => Promise.resolve([]),
        firstPrompt: () => Promise.resolve(null),
        endedAt: () => null,
        inlineChat: () => false,
        design: () => null,
        turnEnded: () => undefined,
        taskRows: () => [],
        dropWakes: () => Promise.resolve(),
        endChildren: () => Promise.resolve(),
        modeCeiling: OPEN_BOUNDS.modeCeiling,
        peerChat: () => false,
        checkCwd: OPEN_BOUNDS.checkCwd,
        holdsProject: () => Promise.resolve(true),
        projectAccount: () => null,
        ...overrides
    };
}

export type TestChatOptions = Omit<ConstructorParameters<typeof ChatManager>[0], 'facts'> & Partial<ChatFacts>;

export function testChatManager(options: TestChatOptions): ChatManager {
    const factKeys = new Set(Object.keys(quietFacts()));
    const facts: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
        (factKeys.has(key) ? facts : rest)[key] = value;
    }

    return new ChatManager({ ...(rest as Omit<TestChatOptions, keyof ChatFacts>), facts: quietFacts(facts as Partial<ChatFacts>) });
}
