import type { ChatItem, ContextSource } from '@ruimte/contracts';

export interface ChatReference {
    id: string;
    title: string;
}

/* The chats a person attached to a message that still stand in its project; `titleOf` answers null for any other id. */
export const resolveChatReferences = (ids: readonly string[] | undefined, titleOf: (id: string) => string | null): ChatReference[] => {
    const references: ChatReference[] = [];
    for (const id of new Set(ids ?? [])) {
        const title = titleOf(id);
        if (title !== null) {
            references.push({ id, title });
        }
    }
    return references;
};

/* What the agent is told in front of a message with chats attached: where to read them, never what they say. */
export const chatReferenceNote = (references: readonly ChatReference[]): string | null => {
    if (references.length === 0) {
        return null;
    }
    const lead =
        references.length === 1
            ? 'The person attached a chat of this project to this message. Read that conversation with the command below before you answer.'
            : 'The person attached chats of this project to this message. Read each conversation with the command beside it before you answer.';
    return [lead, ...references.map((reference) => `- ${JSON.stringify(reference.title)}: \`ruimte-context read ${reference.id}\``)].join('\n');
};

/*
 * What a chat may read because a person attached it to one of its messages, without a line on a
 * canvas. Asked at every read, so a chat that left the project since is no longer one of them.
 */
export const referencedChats = (items: readonly ChatItem[], titleOf: (id: string) => string | null): ContextSource[] =>
    resolveChatReferences(
        items.flatMap((item) => (item.kind === 'user' ? (item.chats ?? []) : [])),
        titleOf
    ).map((reference) => ({ id: reference.id, kind: 'chat', title: reference.title }));
