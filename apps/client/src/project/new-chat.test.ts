import { describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { newChatMachine, offersNewChat } from './new-chat';

describe('where a new chat starts', () => {
    test('on the machine of the open project, wherever the window runs', () => {
        expect(newChatMachine('m1', true)).toBe('m1');
        expect(newChatMachine('m1', false)).toBe('m1');
    });

    test('on this machine from the start screen of the desktop app', () => {
        expect(newChatMachine(null, true)).toBe(LOCAL_ENDPOINT_ID);
    });

    test('on the machine a person picks from the start screen of the web client', () => {
        expect(newChatMachine(null, false)).toBeNull();
    });
});

describe('whether a window offers a new chat', () => {
    test('a machine that refused one offers it no more', () => {
        expect(offersNewChat('m1', {})).toBe(true);
        expect(offersNewChat('m1', { m1: true })).toBe(false);
        expect(offersNewChat('m2', { m1: true })).toBe(true);
    });

    test('a window where a person picks the machine keeps offering it', () => {
        expect(offersNewChat(null, { m1: true })).toBe(true);
    });
});
