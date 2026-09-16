import { describe, expect, test } from 'bun:test';
import { joinDraftText, offerDraft, takeDraftOffers } from '@/chat/drafts';

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
