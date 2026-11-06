import { beforeEach, describe, expect, test } from 'bun:test';
import type { GitPrWatch } from '@ruimte/contracts';
import { endpointKey } from '@/state/keys';
import { usePrWatches } from './pr-watches';

function watch(chatId: string): GitPrWatch {
    return { id: `watch-${chatId}`, projectId: 'p', chatId, cwd: '/repo', repo: 'o/r', number: 12, startedAt: 1, head: 'abc', checkState: 'pending' };
}

beforeEach(() => {
    usePrWatches.setState({ byChat: {}, ended: {} });
});

describe('the watches of a machine', () => {
    test("are read per chat, and a list replaces the machine's earlier one", () => {
        usePrWatches.getState().receive('m1', [watch('a'), watch('b')]);
        usePrWatches.getState().receive('m2', [watch('c')]);
        usePrWatches.getState().receive('m1', [watch('b')]);
        expect(Object.keys(usePrWatches.getState().byChat).sort()).toEqual([endpointKey('m1', 'b'), endpointKey('m2', 'c')].sort());
    });

    test('remember why one ended until a person has seen it', () => {
        usePrWatches.getState().receive('m1', [], { chatId: 'a', reason: 'merged' });
        expect(usePrWatches.getState().ended[endpointKey('m1', 'a')]).toBe('merged');
        usePrWatches.getState().dismissEnded('m1', 'a');
        expect(usePrWatches.getState().ended).toEqual({});
    });
});
