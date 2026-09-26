import { create } from 'zustand';
import { uploadBytes } from '@/chat/attachments';
import { isEmptyDraft, type ChatDraft } from '@/chat/drafts';
import { isRecord } from '@/chat/logic/json';
import { persistedJson } from '@ruimte/agents-react/chat/persisted-json';
import { withQuote } from '@/chat/quote';
import { shortcut } from '@ruimte/ui/shortcut';

/* Puts the draft away, or takes the last one back on an empty box. */
export const STASH_SHORTCUT = shortcut('Mod+S');

const STORAGE_KEY = 'ruimte.chat.stash';

// Past this the list is an archive nobody reads; the oldest entry makes room for a new one.
export const STASH_LIMIT = 20;

/* What was attached when the prompt was put away. The bytes are not kept, only what they were. */
export interface StashedAttachment {
    name: string;
    mime: string;
    size: number;
}

export interface StashedPrompt {
    id: string;
    text: string;
    mentions: string[];
    skills: string[];
    attachments: StashedAttachment[];
    createdAt: number;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

const attachments = (value: unknown): StashedAttachment[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord).map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : '',
        mime: typeof entry.mime === 'string' ? entry.mime : '',
        size: typeof entry.size === 'number' ? entry.size : 0
    }));
};

/* Only the fields we know today, so anything an older or a broken write left behind falls away here. */
export const parseStash = (raw: string | null): StashedPrompt[] => {
    if (raw === null) {
        return [];
    }
    try {
        const stored: unknown = JSON.parse(raw);
        if (!Array.isArray(stored)) {
            return [];
        }
        return stored
            .filter(isRecord)
            .filter((entry) => typeof entry.id === 'string' && typeof entry.text === 'string')
            .map((entry) => ({
                id: entry.id as string,
                text: entry.text as string,
                mentions: strings(entry.mentions),
                skills: strings(entry.skills),
                attachments: attachments(entry.attachments),
                createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0
            }))
            .slice(0, STASH_LIMIT);
    } catch {
        return [];
    }
};

/* Newest first, capped: the entry that has been waiting longest is the one nobody comes back for. */
export const withStashed = (prompts: StashedPrompt[], entry: StashedPrompt): StashedPrompt[] => [entry, ...prompts].slice(0, STASH_LIMIT);

/* What a draft looks like on the shelf, its quote folded into the text; null when there is nothing worth putting there. */
export const stashedFrom = (draft: ChatDraft, id: string, now: number): StashedPrompt | null => {
    if (isEmptyDraft(draft)) {
        return null;
    }
    return {
        id,
        text: withQuote(draft.quote, draft.text),
        mentions: [...draft.mentions],
        skills: [...draft.skills],
        attachments: draft.attachments.map((attachment) => ({ name: attachment.name, mime: attachment.mime, size: uploadBytes(attachment) })),
        createdAt: now
    };
};

const storage = persistedJson<StashedPrompt[]>(STORAGE_KEY, parseStash, []);

/*
 * Prompts put aside for later, one list for the whole app rather than one per chat: on a canvas a
 * stashed prompt usually moves to another node, which is the reason to stash it at all.
 */
export const useStash = create<{ prompts: StashedPrompt[] }>(() => ({ prompts: storage.read() }));

const write = (prompts: StashedPrompt[]): void => {
    useStash.setState({ prompts });
    storage.write(prompts);
};

/* Puts a draft on the shelf; false when the composer held nothing to put there. */
export const stashDraft = (draft: ChatDraft): boolean => {
    const entry = stashedFrom(draft, `stash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, Date.now());
    if (!entry) {
        return false;
    }
    write(withStashed(useStash.getState().prompts, entry));
    return true;
};

export const forgetStashed = (id: string): void => {
    write(useStash.getState().prompts.filter((entry) => entry.id !== id));
};
