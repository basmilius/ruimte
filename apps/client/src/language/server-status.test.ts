import { describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import i18next from 'i18next';
import { buildHeldDetail, serverDetail } from './server-status';

const t = i18next.getFixedT('en', 'panels');

function status(extra: Partial<LanguageServerStatus> = {}): LanguageServerStatus {
    return { server: 'php-native', state: 'ready', version: '0.3.0', documents: 2, ...extra };
}

describe('the line under a server', () => {
    test('says what an update brings, or that a checkout changed since its build', () => {
        expect(serverDetail(status({ update: { version: '0.4.1' } }), t)).toBe('Version 0.4.1 is available.');
        expect(serverDetail(status({ update: { version: '0.4.1', rebuild: true } }), t)).toBe('The checkout changed since this build.');
    });

    test('says that building is off in a worktree, and nothing for a server that builds', () => {
        expect(buildHeldDetail(status({ buildHeld: true }), t)).toBe('Build scripts and macros are off in this worktree.');
        expect(buildHeldDetail(status({ buildAllowed: true }), t)).toBe('Build scripts and macros run in the worktrees of agents.');
        expect(buildHeldDetail(status(), t)).toBe('');
    });

    test('says why the last update did not come, and the open files without one', () => {
        expect(serverDetail(status({ update: { version: '0.4.1' }, message: 'The download does not match its checksum' }), t)).toBe(
            'The download does not match its checksum'
        );
        expect(serverDetail(status(), t)).toBe('2 open files');
    });
});
