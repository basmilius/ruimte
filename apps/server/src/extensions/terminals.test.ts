import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalProfileRefusal, terminalWriteRefusal } from './policy.ts';
import { ExtensionTerminals } from './terminals.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-terminals-unit-'));
const HARBOR = {
    id: 'dev.harbor',
    permissions: { 'terminals.profiles': 'Adds a shell' },
    provides: { terminalProfiles: ['service-shell'] },
    proposed: ['terminalProfiles']
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the terminals an extension had a hand in', () => {
    test('are kept over a restart of the machine, and go with their node', () => {
        const path = join(root, 'kept.json');
        const terminals = new ExtensionTerminals(path);

        terminals.put('terminal-1', { projectId: 'project-1', openedBy: 'dev.harbor', profile: { extension: 'dev.harbor', id: 'service-shell' } });
        terminals.put('terminal-2', { projectId: 'project-1', profile: { extension: 'dev.harbor', id: 'service-shell' } });
        terminals.put('terminal-3', { projectId: 'project-2', openedBy: 'dev.harbor' });

        const restarted = new ExtensionTerminals(path);

        expect(restarted.get('terminal-1')).toEqual({
            projectId: 'project-1',
            openedBy: 'dev.harbor',
            profile: { extension: 'dev.harbor', id: 'service-shell' }
        });
        expect(restarted.get('constructor')).toBeNull();

        restarted.places('project-1', new Set(['terminal-2', 'note-1']));

        expect([restarted.get('terminal-1'), restarted.get('terminal-2')?.projectId, restarted.get('terminal-3')?.projectId]).toEqual([
            null,
            'project-1',
            'project-2'
        ]);
        expect(new ExtensionTerminals(path).get('terminal-1')).toBeNull();
    });
});

describe('typing into a terminal', () => {
    test('is only for the extension the machine wrote down as the one that opened it', () => {
        expect(terminalWriteRefusal('dev.harbor', 'terminal-1', { openedBy: 'dev.harbor' }, false)).toBeNull();
        expect(terminalWriteRefusal('dev.harbor', 'terminal-1', { openedBy: 'acme.other' }, false)).toMatchObject({ code: 'refused' });
        // A profile a person picked starts the terminal, and still nobody but the person opened it.
        expect(terminalWriteRefusal('dev.harbor', 'terminal-1', {}, false)).toMatchObject({ code: 'refused' });
        expect(terminalWriteRefusal('dev.harbor', 'terminal-1', null, false)).toEqual({
            code: 'refused',
            message: 'dev.harbor did not open the terminal terminal-1, so it cannot type into it'
        });
    });

    test('stops while an agent in its own terminal waits for the person', () => {
        expect(terminalWriteRefusal('dev.harbor', 'terminal-1', { openedBy: 'dev.harbor' }, true)).toEqual({
            code: 'refused',
            message: 'An agent in the terminal terminal-1 waits for the person, so nothing is typed into it'
        });
    });
});

describe('a terminal profile', () => {
    test('starts a terminal only for a manifest that may supply it here', () => {
        expect(terminalProfileRefusal(HARBOR, 'service-shell', true)).toBeNull();
        expect(terminalProfileRefusal(HARBOR, 'service-shell', false)).toEqual({
            code: 'not-found',
            message: 'dev.harbor supplies no terminal profile service-shell'
        });
        expect(terminalProfileRefusal(HARBOR, 'another', true)).toMatchObject({ code: 'not-found' });
        expect(terminalProfileRefusal({ ...HARBOR, permissions: {} }, 'service-shell', true)).toMatchObject({ code: 'permission-denied' });
    });
});
