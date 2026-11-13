import { describe, expect, test } from 'bun:test';
import { ChatError } from '@adecore/agents/chat';
import { referenceNote, type Reference } from '../projects/references.ts';
import { continuedBrief, endRunProcess, type RunChats } from './routines.ts';

const SKETCH: Reference = { id: 'sketch', kind: 'drawing', name: 'Sketch', canvas: null, sources: [] };
const lookup = (id: string): Reference | null => (id === SKETCH.id ? SKETCH : null);

describe('the brief of a run that continues its chat', () => {
    test('names the views the prompt points at, since a wake carries no message of the person', () => {
        expect(continuedBrief('publish it', { references: ['sketch', 'gone'] }, lookup)).toBe(`publish it\n\n${referenceNote([SKETCH])}`);
    });

    test('stays as it was without picks, and stays absent without a brief', () => {
        expect(continuedBrief('publish it', undefined, lookup)).toBe('publish it');
        expect(continuedBrief(undefined, { references: ['sketch'] }, lookup)).toBeUndefined();
    });
});

describe('ending the CLI of a chat whose routine run ended', () => {
    function chatsWith(pid: number | null, restart: () => Promise<void> = async () => undefined): { chats: RunChats; restarted: string[] } {
        const restarted: string[] = [];

        return {
            restarted,
            chats: {
                get: (chatId) => (chatId === 'chat-run' ? { pid } : undefined),
                restart: async (chatId) => {
                    restarted.push(chatId);
                    await restart();
                }
            }
        };
    }

    test('ends the process of a chat that has one', async () => {
        const { chats, restarted } = chatsWith(4242);
        await endRunProcess(chats, 'chat-run');
        expect(restarted).toEqual(['chat-run']);
    });

    test('leaves a chat without a process, and one that left memory, alone', async () => {
        const { chats, restarted } = chatsWith(null);
        await endRunProcess(chats, 'chat-run');
        await endRunProcess(chats, 'chat-gone');
        expect(restarted).toEqual([]);
    });

    test('a chat that took up work again keeps its process, and any other failure is told', async () => {
        const busy = chatsWith(4242, async () => {
            throw new ChatError('chat-busy', 'Chat chat-run is still working');
        });
        await endRunProcess(busy.chats, 'chat-run');
        const broken = chatsWith(4242, async () => {
            throw new Error('The process would not end');
        });
        await expect(endRunProcess(broken.chats, 'chat-run')).rejects.toThrow('The process would not end');
    });
});
