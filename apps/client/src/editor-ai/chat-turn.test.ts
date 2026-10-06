import { describe, expect, test } from 'bun:test';
import { registerTurnJumper } from '@adecore/agents-react/chat/timeline-scroll';
import { endpointKey } from '@/state/keys';
import { openChatAtTurn } from './chat-turn';

describe('opening a chat at a turn', () => {
    test('shows the chat first and then asks its thread for the turn, by the key of the machine and the chat', () => {
        const steps: string[] = [];
        const stop = registerTurnJumper(endpointKey('m1', 'chat-a'), (turnId, target) => steps.push(`jump ${turnId} ${target}`));
        openChatAtTurn('m1', 'chat-a', 'turn-4', 'changes', (chatId) => steps.push(`focus ${chatId}`));
        expect(steps).toEqual(['focus chat-a', 'jump turn-4 changes']);
        stop();
    });

    test('a thread that is not drawn yet gets the jump when it is', () => {
        openChatAtTurn('m1', 'chat-late', 'turn-2', 'prompt', () => undefined);
        const jumps: string[] = [];
        registerTurnJumper(endpointKey('m1', 'chat-late'), (turnId, target) => jumps.push(`${turnId} ${target}`))();
        expect(jumps).toEqual(['turn-2 prompt']);
    });

    test('another machine with the same chat id is another thread', () => {
        const jumps: string[] = [];
        const stop = registerTurnJumper(endpointKey('m2', 'chat-a'), (turnId) => jumps.push(turnId));
        openChatAtTurn('m1', 'chat-a', 'turn-4', 'prompt', () => undefined);
        expect(jumps).toEqual([]);
        stop();
    });
});
