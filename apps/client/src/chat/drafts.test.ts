import { describe, expect, test } from 'bun:test';
import { CHAT_ATTACHMENTS_MAX_COUNT } from '@ruimte/contracts';
import { EMPTY_DRAFT, joinDraftText, offerDraft, takeBackIntoDraft, takeDraftOffers } from '@/chat/drafts';

describe('text offered to a chat prompt', () => {
    test('goes under what was typed, never over it', () => {
        expect(joinDraftText('', 'Results')).toBe('Results');
        expect(joinDraftText('Look at this  \n', 'Results')).toBe('Look at this\n\nResults');
    });

    test('a composer on screen takes it, and only the one of that chat', () => {
        const taken: string[] = [];
        const off = takeDraftOffers('chat-a', (text) => taken.push(text));
        const other = takeDraftOffers('chat-b', () => taken.push('wrong'));
        offerDraft('chat-a', 'Results');
        expect(taken).toEqual(['Results']);
        off();
        other();
    });
});

describe('a queued message taken back to edit', () => {
    const upload = (name: string) => ({ name, mime: 'text/plain', data: 'aGVsbG8=' });

    test('fills an empty composer as it was queued', () => {
        const taken = { text: 'see @src/a.ts', mentions: ['src/a.ts'], skills: ['review'], chats: ['chat-a'], attachments: [upload('a.txt')] };
        expect(takeBackIntoDraft(EMPTY_DRAFT, taken)).toEqual({ draft: { ...taken, quote: '' }, rejected: [] });
    });

    test('goes above what was typed since, with a blank line between, joins its mentions, chats and files, and leaves the quote in place', () => {
        const current = {
            text: 'and @src/b.ts',
            mentions: ['src/b.ts', 'src/a.ts'],
            skills: [],
            chats: ['chat-b', 'chat-a'],
            attachments: [upload('b.txt')],
            quote: 'The cache is per machine.'
        };
        const taken = { text: 'see @src/a.ts\n', mentions: ['src/a.ts'], skills: ['review'], chats: ['chat-a'], attachments: [upload('a.txt')] };
        expect(takeBackIntoDraft(current, taken).draft).toEqual({
            text: 'see @src/a.ts\n\nand @src/b.ts',
            mentions: ['src/a.ts', 'src/b.ts'],
            skills: ['review'],
            chats: ['chat-a', 'chat-b'],
            attachments: [upload('a.txt'), upload('b.txt')],
            quote: 'The cache is per machine.'
        });
    });

    test('keeps files only up to the per-message limit and names the rest', () => {
        const current = { ...EMPTY_DRAFT, attachments: Array.from({ length: CHAT_ATTACHMENTS_MAX_COUNT - 1 }, (_, i) => upload(`held-${i}.txt`)) };
        const merged = takeBackIntoDraft(current, { ...EMPTY_DRAFT, attachments: [upload('fits.txt'), upload('over.txt')] });
        expect(merged.draft.attachments).toHaveLength(CHAT_ATTACHMENTS_MAX_COUNT);
        expect(merged.draft.attachments[0]?.name).toBe('fits.txt');
        expect(merged.rejected).toEqual([{ name: 'over.txt', reason: `At most ${CHAT_ATTACHMENTS_MAX_COUNT} files per message` }]);
    });
});
