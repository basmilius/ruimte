import { describe, expect, test } from 'bun:test';
import { answerFieldKey, choiceKey, headingKey, isPrimaryKey, pageKey, staysInCard, stepIndex, toolbarKey, type PromptKeyEvent } from './keys';

const key = (name: string, patch: Partial<PromptKeyEvent> = {}): PromptKeyEvent => ({
    key: name,
    code: name === ' ' ? 'Space' : name,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...patch
});

describe('prompt card keys', () => {
    test('a list wraps at both ends and jumps with Home and End', () => {
        expect(stepIndex(0, 3, 'previous')).toBe(2);
        expect(stepIndex(2, 3, 'next')).toBe(0);
        expect(stepIndex(1, 3, 'next')).toBe(2);
        expect(stepIndex(1, 3, 'first')).toBe(0);
        expect(stepIndex(0, 3, 'last')).toBe(2);
        expect(stepIndex(0, 0, 'next')).toBe(-1);
    });

    test('arrows move between choices, Space picks', () => {
        const single = { multiSelect: false, anyChosen: false };
        expect(choiceKey(key('ArrowDown'), single)).toEqual({ kind: 'move', to: 'next' });
        expect(choiceKey(key('ArrowUp'), single)).toEqual({ kind: 'move', to: 'previous' });
        expect(choiceKey(key('Home'), single)).toEqual({ kind: 'move', to: 'first' });
        expect(choiceKey(key('End'), single)).toEqual({ kind: 'move', to: 'last' });
        expect(choiceKey(key(' '), single)).toEqual({ kind: 'pick' });
        expect(choiceKey(key(' '), { multiSelect: true, anyChosen: true })).toEqual({ kind: 'pick' });
        expect(choiceKey(key('ArrowLeft'), single)).toBeNull();
        expect(choiceKey(key('1'), single)).toBeNull();
    });

    test('Enter picks a single choice and moves on', () => {
        expect(choiceKey(key('Enter'), { multiSelect: false, anyChosen: true })).toEqual({ kind: 'pick-and-commit' });
    });

    test('Enter on a multi select question moves on once something is chosen, and picks before that', () => {
        expect(choiceKey(key('Enter'), { multiSelect: true, anyChosen: false })).toEqual({ kind: 'pick' });
        expect(choiceKey(key('Enter'), { multiSelect: true, anyChosen: true })).toEqual({ kind: 'commit' });
    });

    test('a modifier or a composition leaves a choice alone', () => {
        const single = { multiSelect: false, anyChosen: false };
        expect(choiceKey(key('Enter', { shiftKey: true }), single)).toBeNull();
        expect(choiceKey(key('Enter', { metaKey: true }), single)).toBeNull();
        expect(choiceKey(key('ArrowDown', { altKey: true }), single)).toBeNull();
        expect(choiceKey(key('Enter', { isComposing: true }), single)).toBeNull();
    });

    test('a written answer leaves upward only from the very start and sends on Enter', () => {
        const field = { belowChoices: true, caretAtStart: true, hasText: true };
        expect(answerFieldKey(key('ArrowUp'), field)).toEqual({ kind: 'to-last-choice' });
        expect(answerFieldKey(key('ArrowUp'), { ...field, caretAtStart: false })).toBeNull();
        expect(answerFieldKey(key('ArrowUp'), { ...field, belowChoices: false })).toBeNull();
        expect(answerFieldKey(key('ArrowUp', { shiftKey: true }), field)).toBeNull();
        expect(answerFieldKey(key('Enter'), field)).toEqual({ kind: 'commit' });
        expect(answerFieldKey(key('Enter'), { ...field, hasText: false })).toEqual({ kind: 'ignore' });
        expect(answerFieldKey(key('Enter', { shiftKey: true }), field)).toBeNull();
        expect(answerFieldKey(key('ArrowDown'), field)).toBeNull();
    });

    test('an IME composition never sends or leaves a written answer', () => {
        const field = { belowChoices: true, caretAtStart: true, hasText: true };
        expect(answerFieldKey(key('Enter', { isComposing: true }), field)).toBeNull();
        expect(answerFieldKey(key('ArrowUp', { isComposing: true }), field)).toBeNull();
        expect(isPrimaryKey(key('Enter', { metaKey: true, isComposing: true }), true)).toBe(false);
    });

    test('ArrowDown enters the card from its heading', () => {
        expect(headingKey(key('ArrowDown'))).toBe(true);
        expect(headingKey(key('Enter'))).toBe(false);
        expect(headingKey(key('ArrowDown', { shiftKey: true }))).toBe(false);
    });

    test('the action row steps left and right', () => {
        expect(toolbarKey(key('ArrowLeft'))).toBe('previous');
        expect(toolbarKey(key('ArrowRight'))).toBe('next');
        expect(toolbarKey(key('End'))).toBe('last');
        expect(toolbarKey(key('ArrowDown'))).toBeNull();
        expect(toolbarKey(key('ArrowRight', { metaKey: true }))).toBeNull();
    });

    test('Mod+Enter is the primary action on each platform', () => {
        expect(isPrimaryKey(key('Enter', { metaKey: true }), true)).toBe(true);
        expect(isPrimaryKey(key('Enter', { ctrlKey: true }), false)).toBe(true);
        expect(isPrimaryKey(key('Enter', { ctrlKey: true }), true)).toBe(false);
        expect(isPrimaryKey(key('Enter'), true)).toBe(false);
    });

    test('Mod+Shift+arrows page a stack, except in a text field', () => {
        expect(pageKey(key('ArrowLeft', { metaKey: true, shiftKey: true }), true, false)).toBe(-1);
        expect(pageKey(key('ArrowRight', { ctrlKey: true, shiftKey: true }), false, false)).toBe(1);
        expect(pageKey(key('ArrowRight', { metaKey: true, shiftKey: true }), true, true)).toBeNull();
        expect(pageKey(key('ArrowRight', { metaKey: true }), true, false)).toBeNull();
    });

    test('bare keys stay in the card, while Escape, Tab and shortcuts go on', () => {
        expect(staysInCard(key('ArrowDown'))).toBe(true);
        expect(staysInCard(key(' '))).toBe(true);
        expect(staysInCard(key('Backspace'))).toBe(true);
        expect(staysInCard(key('!', { shiftKey: true }))).toBe(true);
        expect(staysInCard(key('Escape'))).toBe(false);
        expect(staysInCard(key('Tab', { shiftKey: true }))).toBe(false);
        expect(staysInCard(key('p', { metaKey: true, shiftKey: true }))).toBe(false);
        expect(staysInCard(key('t', { altKey: true }))).toBe(false);
    });
});
