import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { bestEffort } from './best-effort.ts';

const saved = process.env.RUIMTE_DEBUG;

afterEach(() => {
    if (saved === undefined) {
        delete process.env.RUIMTE_DEBUG;
    } else {
        process.env.RUIMTE_DEBUG = saved;
    }
});

describe('bestEffort', () => {
    test('never rejects, and says nothing of what it drops unless debugging', async () => {
        const debug = spyOn(console, 'debug').mockImplementation(() => undefined);
        delete process.env.RUIMTE_DEBUG;

        await expect(bestEffort('remove the staging folder', Promise.reject(new Error('gone')))).resolves.toBeUndefined();
        expect(debug).not.toHaveBeenCalled();

        process.env.RUIMTE_DEBUG = '1';
        await bestEffort('remove the staging folder', Promise.reject(new Error('gone')));

        expect(debug).toHaveBeenCalledTimes(1);
        expect(String(debug.mock.calls[0]?.[0])).toContain('remove the staging folder failed and was dropped: gone');
        debug.mockRestore();
    });

    test('takes work that is not there', async () => {
        await expect(bestEffort('nothing', undefined)).resolves.toBeUndefined();
    });
});
