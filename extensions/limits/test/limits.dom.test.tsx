import { describe, expect, test } from 'bun:test';
import { createTestHost } from '@ruimte/extension/testing';
import { limitRows } from '../client/limit-rows';

const LIMITS = [
    {
        provider: 'claude',
        plan: 'max',
        windows: [
            { label: '5h', used: 0.694, resetsAt: null },
            { label: 'week', used: 0.7, resetsAt: null }
        ]
    },
    { provider: 'codex', plan: null, windows: [{ label: '5h', used: 0.125, resetsAt: 1 }] }
];

describe('Limits', () => {
    test('says so in its card while the machine reports no plan window', async () => {
        const host = await createTestHost();
        const card = await host.render(host.card('limits'));

        expect(card.text()).toBe('No plan windows yet.');
    });

    test('shows each window of the machine in its card', async () => {
        const host = await createTestHost({ answers: { 'usage.limits': LIMITS } });
        const card = await host.render(host.card('limits'));

        expect(card.text()).toBe('claude, 5h69%claude, week70%codex, 5h13%');
    });

    test('fails its card without the permission usage.read, as Ruimte does', async () => {
        const host = await createTestHost({ manifest: { permissions: {} } });

        await expect(host.render(host.card('limits'))).rejects.toThrow('Limits did not ask for the permission usage.read in its manifest');
    });

    test('rounds each window to a whole percentage, marked from 70% on', () => {
        expect(limitRows(LIMITS)).toEqual([
            { key: 'claude/5h', label: 'claude, 5h', percent: 69, near: false },
            { key: 'claude/week', label: 'claude, week', percent: 70, near: true },
            { key: 'codex/5h', label: 'codex, 5h', percent: 13, near: false }
        ]);
    });
});
