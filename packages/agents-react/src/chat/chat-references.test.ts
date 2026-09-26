import { describe, expect, test } from 'bun:test';
import { chatSuggestions } from './chat-references';

describe('chatSuggestions', () => {
    const chats = [
        { id: 'planner', title: 'Planner' },
        { id: 'notes', title: 'Release notes' }
    ];

    test('matches the query anywhere in the title, whatever its case', () => {
        expect(chatSuggestions(chats, 'NOTE', [], 5)).toEqual([{ id: 'notes', title: 'Release notes' }]);
        expect(chatSuggestions(chats, '', [], 5)).toHaveLength(2);
    });

    test('leaves out the chat typing and the chats already attached, and stops at the limit', () => {
        expect(chatSuggestions(chats, '', ['planner'], 5)).toEqual([{ id: 'notes', title: 'Release notes' }]);
        expect(chatSuggestions(chats, '', [], 1)).toEqual([{ id: 'planner', title: 'Planner' }]);
    });
});
