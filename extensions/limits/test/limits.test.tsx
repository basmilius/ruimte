import { describe, expect, test } from 'bun:test';
import { definitions, renderSurface } from '@ruimte/extension/testing';
import LimitsCard from '../client/LimitsCard';
import { limitRows } from '../client/limit-rows';
import '../client/index';

describe('Limits', () => {
    test('adds one sidebar card, which loads the card', async () => {
        const cards = definitions().filter((entry) => entry.kind === 'sidebarCard');
        const card = cards[0]?.definition as { id: string; title: string; component: () => Promise<{ default: unknown }> };

        expect(cards).toHaveLength(1);
        expect(card).toMatchObject({ id: 'limits', title: 'Limits' });
        expect((await card.component()).default).toBe(LimitsCard);
    });

    test('says so while the machine reports no plan window', () => {
        expect(renderSurface(LimitsCard)).toContain('No plan windows yet.');
    });

    test('shows each window as a whole percentage, marked from 70% on', () => {
        const rows = limitRows([
            {
                provider: 'claude',
                plan: 'max',
                windows: [
                    { label: '5h', used: 0.694, resetsAt: null },
                    { label: 'week', used: 0.7, resetsAt: null }
                ]
            },
            { provider: 'codex', plan: null, windows: [{ label: '5h', used: 0.125, resetsAt: 1 }] }
        ]);

        expect(rows).toEqual([
            { key: 'claude/5h', label: 'claude, 5h', percent: 69, near: false },
            { key: 'claude/week', label: 'claude, week', percent: 70, near: true },
            { key: 'codex/5h', label: 'codex, 5h', percent: 13, near: false }
        ]);
    });
});
