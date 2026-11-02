import { afterEach, describe, expect, test } from 'bun:test';
import { Package } from 'lucide-react';
import { EXTENSION_SLOT_NAMES, type ExtensionSlotName } from '@ruimte/contracts';
import type * as PublicClient from '../../../../packages/extension/client';
import { contribute, useContributions, type PanelContribution } from '@/extensions/registry';

function panel(label: string): PanelContribution {
    return {
        kind: 'extension:acme.builds/panel',
        icon: Package,
        minWidth: 240,
        toolbar: true,
        group: 'extensions',
        label: () => label,
        component: () => null
    };
}

describe('contribute', () => {
    afterEach(() => {
        useContributions.setState({ panels: [], settingsSections: [] });
    });

    test('a reload replaces the contribution with the same id', () => {
        contribute('panels', panel('First'));
        contribute('panels', panel('Second'));

        expect(useContributions.getState().panels.map((entry) => entry.label())).toEqual(['Second']);
    });

    test('taking out an old contribution leaves the one that replaced it', () => {
        const remove = contribute('panels', panel('First'));

        contribute('panels', panel('Second'));
        remove();

        expect(useContributions.getState().panels.map((entry) => entry.label())).toEqual(['Second']);
    });
});

describe('the slot names', () => {
    test('are the places the types promise, each once', () => {
        // Both assignments compile only while the list and `SlotName` of `@ruimte/extension/client` hold the same names.
        const promised: readonly PublicClient.SlotName[] = EXTENSION_SLOT_NAMES;
        const known: readonly ExtensionSlotName[] = promised;

        expect(new Set(known).size).toBe(EXTENSION_SLOT_NAMES.length);
    });
});
