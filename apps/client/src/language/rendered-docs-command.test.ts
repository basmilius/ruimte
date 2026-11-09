import { describe, expect, test } from 'bun:test';
import { commandIds as registeredIds } from '@/commands/registry';
import { LANGUAGE_COMMANDS, LANGUAGE_COMMAND_IDS, offeredLanguageCommands } from './command-table';

describe('toggle rendered documentation command', () => {
    test('is described with the editor key', () => {
        expect(LANGUAGE_COMMANDS['toggle-rendered-docs']).toMatchObject({
            menu: 'code',
            key: 'toggleRenderedDocs',
            keymap: 'toggleRenderedDocs'
        });
    });

    test('is left out of the menu and the palette while the feature is off', () => {
        expect(registeredIds()).not.toContain('toggle-rendered-docs');
        expect(LANGUAGE_COMMAND_IDS).not.toContain('toggle-rendered-docs');
    });

    test('sits in the Code menu once the feature is on', () => {
        expect(offeredLanguageCommands(true)).toContain('toggle-rendered-docs');
        expect(offeredLanguageCommands(false)).not.toContain('toggle-rendered-docs');
    });
});
