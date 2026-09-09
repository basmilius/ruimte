const STORAGE_KEY = 'ruimte.chat.drafts';

interface DraftRecord {
    text: string;
}

const readAll = (): Record<string, DraftRecord> => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Record<string, DraftRecord>) : {};
    } catch {
        return {};
    }
};

const writeAll = (drafts: Record<string, DraftRecord>): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
    } catch {
        // A full or blocked storage loses the draft; typing carries on.
    }
};

/* An unsent prompt per chat node, kept across reloads so a half-written message is never lost. */
export const readDraft = (chatId: string): string => readAll()[chatId]?.text ?? '';

export const writeDraft = (chatId: string, text: string): void => {
    const drafts = readAll();
    if (text.trim() === '') {
        delete drafts[chatId];
    } else {
        drafts[chatId] = { text };
    }
    writeAll(drafts);
};
