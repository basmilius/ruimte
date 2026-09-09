import type { ChatAttachment } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.chat.drafts';

export interface ChatDraft {
    text: string;
    mentions: string[];
    attachments: ChatAttachment[];
}

export const EMPTY_DRAFT: ChatDraft = { text: '', mentions: [], attachments: [] };

// Older records only had text; the arrays are filled in on read.
type DraftRecord = { text: string; mentions?: string[]; attachments?: ChatAttachment[] };

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

/* An unsent prompt per chat node, kept across reloads so a half-written message is never lost. */
export const readDraft = (chatId: string): ChatDraft => {
    const record = readAll()[chatId];
    return record ? { text: record.text, mentions: record.mentions ?? [], attachments: record.attachments ?? [] } : EMPTY_DRAFT;
};

export const writeDraft = (chatId: string, draft: ChatDraft): void => {
    const drafts = readAll();
    if (isEmptyDraft(draft)) {
        delete drafts[chatId];
        store(drafts);
        return;
    }
    drafts[chatId] = { text: draft.text, mentions: draft.mentions, attachments: draft.attachments };
    if (store(drafts)) {
        return;
    }
    // Images can outgrow the storage quota; the text is the part worth keeping then.
    drafts[chatId] = { text: draft.text, mentions: draft.mentions };
    store(drafts);
};
