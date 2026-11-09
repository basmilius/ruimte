import type { Referables } from '@adecore/agents-react/chat';
import { promptPicks, type PromptDraft } from '@adecore/agents-react/chat/ui';
import type { RoutinePicked } from '@ruimte/contracts';

export function promptDraftOf(text: string, picked: RoutinePicked | undefined): PromptDraft {
    return {
        text,
        mentions: picked?.mentions ?? [],
        skills: picked?.skills ?? [],
        chats: picked?.chats ?? [],
        references: picked?.references ?? []
    };
}

/*
 * What a routine keeps of the picks still in its prompt; undefined for none, so a routine without any keeps
 * its approval. `referables` is null for a project other than the open one, whose views this window does
 * not know: what was picked there stays as it was.
 */
export function routinePicked(draft: PromptDraft, referables: Referables | null): RoutinePicked | undefined {
    const present = promptPicks(draft, referables ?? { items: [], chatsOnly: false });
    const lists: Array<[keyof RoutinePicked & string, string[]]> = [
        ['mentions', present.mentions ?? []],
        ['skills', present.skills ?? []],
        ['chats', referables === null ? draft.chats : (present.chats ?? [])],
        ['references', referables === null ? draft.references : (present.references ?? [])]
    ];
    const kept = lists.filter(([, ids]) => ids.length > 0);
    return kept.length === 0 ? undefined : (Object.fromEntries(kept) as RoutinePicked);
}
