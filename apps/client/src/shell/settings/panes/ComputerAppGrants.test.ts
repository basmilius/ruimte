import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ComputerAppGrants as Grants } from '@ruimte/contracts';
import { ComputerAppGrants } from './ComputerAppGrants';

const EMPTY: Grants = { always: [], terminals: [], thisTime: [] };

const render = (grants: Grants, held = false): string =>
    renderToStaticMarkup(
        createElement(I18nextProvider, { i18n: i18next }, createElement(ComputerAppGrants, { grants, held, busy: false, onRevoke: () => undefined }))
    );

describe('the grants of a machine in settings', () => {
    test('an empty list says so, and nothing is held this time', () => {
        const markup = render(EMPTY);
        expect(markup).toContain('No apps are allowed for always.');
        expect(markup).toContain('No apps have been seen running a shell.');
        expect(markup).not.toContain('This time');
        expect(markup).not.toContain('<button');
    });

    test('each grant has the button that takes it back', () => {
        const markup = render({
            always: [{ name: 'TextEdit', bundleId: 'com.example.textedit', at: Date.UTC(2026, 8, 19, 12) }],
            terminals: [{ name: 'Shells', bundleId: 'com.example.shells', at: Date.UTC(2026, 8, 20, 12) }],
            thisTime: [{ name: 'Notes', bundleId: 'com.example.notes', at: 1, nodeId: 'chat-1', nodeTitle: 'Fix the login', projectName: 'Ruimte' }]
        });
        expect(markup).toContain('TextEdit');
        expect(markup).toContain('Allowed Sep 19, 2026');
        expect(markup).toContain('aria-label="Remove TextEdit"');
        expect(markup).toContain('aria-label="Shells is not a terminal"');
        expect(markup).toContain('This time');
        expect(markup).toContain('Fix the login · Ruimte');
        expect(markup).toContain('aria-label="Remove Notes"');
        expect(markup).not.toContain('No apps');
        expect(markup).not.toContain('disabled=""');
    });

    test('a window an agent operates shows the list but takes nothing back', () => {
        const markup = render({ ...EMPTY, always: [{ name: 'TextEdit', bundleId: 'com.example.textedit', at: 1 }] }, true);
        expect(markup).toContain('disabled=""');
        expect(markup).toContain('An agent is operating Ruimte');
    });
});
