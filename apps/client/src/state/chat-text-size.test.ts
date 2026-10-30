import { afterEach, expect, test } from 'bun:test';
import { endpointKey } from './keys';
import { DEFAULT_CHAT_TEXT_SIZE, useChatTextSizes } from './chat-text-size';

const HERE = endpointKey('here', 'review');
const THERE = endpointKey('there', 'review');

afterEach(() => useChatTextSizes.setState({ byKey: {} }));

test('text steps stop at the theme bounds and reset to default', () => {
    for (let step = 0; step < 4; step++) {
        useChatTextSizes.getState().step(HERE, 1);
    }

    expect(useChatTextSizes.getState().byKey[HERE]).toBe(3);

    for (let step = 0; step < 4; step++) {
        useChatTextSizes.getState().step(HERE, -1);
    }

    expect(useChatTextSizes.getState().byKey[HERE]).toBe(0);
    useChatTextSizes.getState().reset(HERE);
    expect(useChatTextSizes.getState().byKey[HERE] ?? DEFAULT_CHAT_TEXT_SIZE).toBe(1);
});

test('equal chat ids on different machines have independent preferences and cleanup', () => {
    useChatTextSizes.getState().step(HERE, 1);
    useChatTextSizes.getState().step(THERE, -1);
    useChatTextSizes.getState().forgetMachine('here');
    expect(useChatTextSizes.getState().byKey[HERE] ?? DEFAULT_CHAT_TEXT_SIZE).toBe(1);
    expect(useChatTextSizes.getState().byKey[THERE]).toBe(0);
});
