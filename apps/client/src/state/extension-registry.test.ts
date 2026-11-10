import { afterEach, describe, expect, test } from 'bun:test';
import { Package } from 'lucide-react';
import { contribute, useContributions, type PanelContribution } from '@/state/extension-registry';

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
