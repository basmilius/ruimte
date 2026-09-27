import type { PromptNotes } from '../chat/chat-session.ts';
import type { MessageWords } from './deliver-notice.ts';
import type { NoticeStore } from './notice-store.ts';

/*
 * What another node left for a chat, taken from the queue in front of its next prompt so the model
 * hears it once. Nothing of it is shown: a person read each message in the thread as it landed
 * (`showNotices`), so repeating it above the turn says the same thing twice.
 */
export class NoticeNotes implements PromptNotes {
    private readonly store: Pick<NoticeStore, 'take'>;
    private readonly chatId: string;
    private readonly words: Pick<MessageWords, 'heard'>;

    constructor(store: Pick<NoticeStore, 'take'>, chatId: string, words: Pick<MessageWords, 'heard'>) {
        this.store = store;
        this.chatId = chatId;
        this.words = words;
    }

    next(): { shown: string[]; heard: string[] } {
        return { shown: [], heard: this.store.take(this.chatId).map((notice) => this.words.heard(notice)) };
    }

    reset(): void {}
}

/*
 * The lines a chat that just loaded owes a person for what landed while nobody held it, marked so a
 * reload writes none again. The model still hears the messages themselves from the queue.
 */
export const unshownNotes = async (store: Pick<NoticeStore, 'show'>, chatId: string, words: Pick<MessageWords, 'shown'>): Promise<string[]> =>
    (await store.show(chatId)).map((notice) => words.shown(notice));
