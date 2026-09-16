import { create } from 'zustand';
import type { ChatAttachmentUpload } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.chat.drafts';

export interface ChatDraft {
    text: string;
    mentions: string[];
    skills: string[];
    attachments: ChatAttachmentUpload[];
}

export const EMPTY_DRAFT: ChatDraft = { text: '', mentions: [], skills: [], attachments: [] };

// Older records only had text; the arrays are filled in on read.
type DraftRecord = { text: string; mentions?: string[]; skills?: string[]; attachments?: ChatAttachmentUpload[] };

const readAll = (): Record<string, DraftRecord> => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Record<string, DraftRecord>) : {};
    } catch {
        return {};
    }
};

const store = (drafts: Record<string, DraftRecord>): boolean => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
        return true;
    } catch {
        return false;
    }
};

export const isEmptyDraft = (draft: ChatDraft): boolean => draft.text.trim() === '' && draft.attachments.length === 0;

/*
 * Which chats hold an unsent prompt, for the dot on their row in the sidebar. The drafts themselves
 * stay in storage: a node that is not on screen has no composer, and this is all anyone else needs.
 */
export const useDrafts = create<{ ids: string[] }>(() => ({ ids: Object.keys(readAll()) }));

export const useHasDraft = (chatId: string): boolean => useDrafts((s) => s.ids.includes(chatId));

const trackDraft = (chatId: string, held: boolean): void => {
    const { ids } = useDrafts.getState();
    if (ids.includes(chatId) === held) {
        return;
    }
    useDrafts.setState({ ids: held ? [...ids, chatId] : ids.filter((id) => id !== chatId) });
};

/* An unsent prompt per chat node, kept across reloads so a half-written message is never lost. */
export const readDraft = (chatId: string): ChatDraft => {
    const record = readAll()[chatId];
    return record ? { text: record.text, mentions: record.mentions ?? [], skills: record.skills ?? [], attachments: record.attachments ?? [] } : EMPTY_DRAFT;
};

export const writeDraft = (chatId: string, draft: ChatDraft): void => {
    const drafts = readAll();
    trackDraft(chatId, !isEmptyDraft(draft));
    if (isEmptyDraft(draft)) {
        delete drafts[chatId];
        store(drafts);
        return;
    }
    drafts[chatId] = { text: draft.text, mentions: draft.mentions, skills: draft.skills, attachments: draft.attachments };
    if (store(drafts)) {
        return;
    }
    // A file can outgrow the storage quota; the text is the part worth keeping then.
    drafts[chatId] = { text: draft.text, mentions: draft.mentions, skills: draft.skills };
    store(drafts);
};

/* Text handed to a draft from outside the composer goes under what was already typed, never over it. */
export const joinDraftText = (current: string, added: string): string => (current.trim() === '' ? added : `${current.replace(/\s+$/, '')}\n\n${added}`);

type DraftTaker = (text: string) => void;

/* The composers on screen, by chat. One that is not mounted reads what was offered from storage when it is. */
const takers = new Map<string, DraftTaker>();

export const takeDraftOffers = (chatId: string, take: DraftTaker): (() => void) => {
    takers.set(chatId, take);
    return () => {
        if (takers.get(chatId) === take) {
            takers.delete(chatId);
        }
    };
};

/*
 * Puts text in a chat's prompt without sending it: the person reads it and presses Enter. A mounted
 * composer owns its draft and writes it back to storage itself, so it has to be the one to take it.
 */
export const offerDraft = (chatId: string, text: string): void => {
    const take = takers.get(chatId);
    if (take) {
        take(text);
        return;
    }
    const current = readDraft(chatId);
    writeDraft(chatId, { ...current, text: joinDraftText(current.text, text) });
};
