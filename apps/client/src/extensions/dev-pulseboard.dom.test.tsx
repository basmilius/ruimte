import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useContributions } from '@/state/extension-registry';
import { loadProduct } from '../../testing/poc';

let extension: LoadedExtension;

beforeAll(async () => {
    extension = await loadProduct('pulseboard', 'Pulseboard');
});
afterAll(() => {
    extension.disposers.forEach((dispose) => dispose());
    localStorage.clear();
});

describe('Pulseboard', () => {
    test('offers a view, a card and something to ask for by voice', () => {
        const state = useContributions.getState();

        expect(state.extensionViews.map((entry) => entry.id)).toContain('dev.pulseboard/activity');
        expect(state.sidebarCards.map((entry) => entry.id)).toContain('dev.pulseboard/now');
        expect(state.voiceActions.map((action) => action.id)).toEqual(['dev.pulseboard/activity']);
    });

    test('answers by voice with what this computer counted when the machine does not answer', async () => {
        const [action] = useContributions.getState().voiceActions;

        expect(await action?.run({})).toBe('0 turns ended here. The machine could not say how many it started.');
    });
});
