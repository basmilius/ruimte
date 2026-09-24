import { create } from 'zustand';
import type { ChatAttachmentUpload } from '@ruimte/contracts';
import { checkAttachmentLimits, uploadBytes } from '@/chat/attachments';
import { persistedJson } from '@/chat/persisted-json';

const STORAGE_KEY = 'ruimte.chat.drafts';

export interface ChatDraft {
    text: string;
    mentions: string[];
    skills: string[];
    /* Chats of the project picked with `@`, drawn beside the text rather than in it. */
    chats: string[];
    attachments: ChatAttachmentUpload[];
    /* A piece of an answer that goes above the text as a blockquote; empty for none. */
    quote: string;
}

export const EMPTY_DRAFT: ChatDraft = { text: '', mentions: [], skills: [], chats: [], attachments: [], quote: '' };

// Older records only had text; the rest is filled in on read.
type DraftRecord = { text: string; mentions?: string[]; skills?: string[]; chats?: string[]; attachments?: ChatAttachmentUpload[]; quote?: string };

const storage = persistedJson<Record<string, DraftRecord>>(STORAGE_KEY, (raw) => (raw ? (JSON.parse(raw) as Record<string, DraftRecord>) : {}), {});

const readAll = (): Record<string, DraftRecord> => storage.read();

const store = (drafts: Record<string, DraftRecord>): boolean => storage.write(drafts);

export const isEmptyDraft = (draft: ChatDraft): boolean => draft.text.trim() === '' && draft.attachments.length === 0 && draft.quote === '';

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
    return record
        ? {
              text: record.text,
              mentions: record.mentions ?? [],
              skills: record.skills ?? [],
              chats: record.chats ?? [],
              attachments: record.attachments ?? [],
              quote: record.quote ?? ''
          }
        : EMPTY_DRAFT;
};

export const writeDraft = (chatId: string, draft: ChatDraft): void => {
    const drafts = readAll();
    trackDraft(chatId, !isEmptyDraft(draft));
    if (isEmptyDraft(draft)) {
        delete drafts[chatId];
        store(drafts);
        return;
    }
    drafts[chatId] = {
        text: draft.text,
        mentions: draft.mentions,
        skills: draft.skills,
        chats: draft.chats,
        attachments: draft.attachments,
        quote: draft.quote
    };
    if (store(drafts)) {
        return;
    }
    // A file can outgrow the storage quota; the text is the part worth keeping then.
    drafts[chatId] = { text: draft.text, mentions: draft.mentions, skills: draft.skills, chats: draft.chats, quote: draft.quote };
    store(drafts);
};

/* Text handed to a draft from outside the composer goes under what was already typed, never over it. */
export const joinDraftText = (current: string, added: string): string => (current.trim() === '' ? added : `${current.replace(/\s+$/, '')}\n\n${added}`);

const union = (first: readonly string[], second: readonly string[]): string[] => [...first, ...second.filter((entry) => !first.includes(entry))];

/*
 * A queued message taken back to edit goes above what was typed since. Its files join the draft's as
 * far as the limits let them, and the rest come back rejected, the way a dropped file would. A quote
 * it was sent with is part of its text; the draft keeps the one it holds.
 */
export const takeBackIntoDraft = (
    current: ChatDraft,
    taken: Omit<ChatDraft, 'quote'>
): { draft: ChatDraft; rejected: Array<{ name: string; reason: string }> } => {
    const checked = checkAttachmentLimits(
        current.attachments.length,
        taken.attachments.map((upload) => ({ name: upload.name, mime: upload.mime, bytes: uploadBytes(upload), upload })),
        current.attachments.reduce((bytes, upload) => bytes + uploadBytes(upload), 0)
    );
    return {
        draft: {
            text: current.text.trim() === '' ? taken.text : joinDraftText(taken.text, current.text),
            mentions: union(taken.mentions, current.mentions),
            skills: union(taken.skills, current.skills),
            chats: union(taken.chats, current.chats),
            attachments: [...checked.accepted.map((entry) => entry.upload), ...current.attachments],
            quote: current.quote
        },
        rejected: checked.rejected
    };
};

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
