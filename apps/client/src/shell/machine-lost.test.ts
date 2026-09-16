import { describe, expect, test } from 'bun:test';
import { machineLost } from './machine-lost';

describe('when the workspace says its machine stopped answering', () => {
    test('only once a try to bring the link back failed, and until it is open again', () => {
        expect(machineLost({ status: 'open', attempts: 0 })).toBe(false);
        // A link that is opening for the first time is a wait, not a machine that went away.
        expect(machineLost({ status: 'connecting', attempts: 0 })).toBe(false);
        expect(machineLost({ status: 'closed', attempts: 1 })).toBe(true);
        expect(machineLost({ status: 'connecting', attempts: 2 })).toBe(true);
        expect(machineLost({ status: 'closed', attempts: 0, failure: 'No network path to the machine' })).toBe(true);
    });
});
