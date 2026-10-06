import { describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { actionsOf, alternativeTo, chipServer, groupedStatuses, isOwn, listedServers, nameOf, packageOf, toneOf } from './status-view';

function status(server: string, state: LanguageServerStatus['state'], extra: Partial<LanguageServerStatus> = {}): LanguageServerStatus {
    return { server, state, version: '1.0.0', documents: 0, ...extra };
}

describe('listedServers', () => {
    test('lists the server of the file, installed or not, and any other one that is up', () => {
        const all = [status('typescript', 'not-installed'), status('vue', 'ready'), status('php', 'stopped')];
        expect(listedServers(all, ['typescript']).map((entry) => entry.server)).toEqual(['typescript', 'vue']);
    });
});

describe('the two PHP servers', () => {
    const chosen = status('php-native', 'ready', { chosen: true });
    const other = status('php', 'stopped', { chosen: false });

    test("are named for what they are, Ruimte's server as plain PHP", () => {
        expect(nameOf('php-native')).toBe('PHP');
        expect(nameOf('php')).toBe('Intelephense');
        expect(packageOf('php-native')).toBe('php-language-server');
    });

    test('list only the one the machine uses, and name the other as what to switch to', () => {
        expect(listedServers([chosen, other], ['php-native']).map((entry) => entry.server)).toEqual(['php-native']);
        expect(listedServers([chosen, status('php', 'crashed', { chosen: false })], []).map((entry) => entry.server)).toEqual(['php-native']);
        expect(alternativeTo(chosen, [chosen, other])).toBe(other);
        expect(alternativeTo(other, [chosen, other])).toBeNull();
        expect(alternativeTo(status('css', 'ready'), [chosen, other])).toBeNull();
    });

    test('offer no Install for a server this build has none of', () => {
        expect(actionsOf(status('php-native', 'not-installed', { unavailable: true })).install).toBe(false);
        expect(actionsOf(status('php-native', 'not-installed')).install).toBe(true);
    });

    test('offer an update and a step back where the machine has them, and neither while it installs', () => {
        const both = { update: { version: '0.4.1' }, previous: { version: '0.3.0' } };
        expect(actionsOf(status('php-native', 'ready', both))).toMatchObject({ update: true, rollback: true, install: false });
        expect(actionsOf(status('php-native', 'installing', both))).toMatchObject({ update: false, rollback: false });
        expect(actionsOf(status('php-native', 'ready'))).toMatchObject({ update: false, rollback: false });
        expect(actionsOf(status('custom:zls', 'ready', both))).toMatchObject({ update: false, rollback: false });
    });
});

describe('chipServer', () => {
    test('reports the server of the file before any other', () => {
        const all = [status('vue', 'ready'), status('typescript', 'indexing')];
        expect(chipServer(all, ['typescript'])?.server).toBe('typescript');
        expect(chipServer(all, [])?.server).toBe('vue');
        expect(chipServer([status('php', 'stopped')], [])).toBeNull();
    });
});

describe('what a person can do', () => {
    test('offers Install only for a server that is not installed, and Restart for one that runs or crashed', () => {
        expect(actionsOf(status('typescript', 'not-installed'))).toEqual({ install: true, update: false, rollback: false, restart: false, log: false });
        expect(actionsOf(status('typescript', 'not-installed', { message: 'bun install failed' })).log).toBe(true);
        expect(actionsOf(status('typescript', 'crashed'))).toEqual({ install: false, update: false, rollback: false, restart: true, log: true });
        expect(actionsOf(status('typescript', 'installing')).restart).toBe(false);
    });

    test('tells a running server from a stopped one', () => {
        expect(toneOf('ready')).toBe('ok');
        expect(toneOf('indexing')).toBe('busy');
        expect(toneOf('crashed')).toBe('error');
        expect(toneOf('stopped')).toBe('idle');
    });
});

describe('the servers of a person of their own', () => {
    const own = status('custom:a', 'stopped', { version: '', name: 'Zig', languages: ['zig'], patterns: ['*.zon'] });

    test('are named by their status, and what they serve stands where a package would', () => {
        expect(nameOf('typescript')).toBe('TypeScript');
        expect(nameOf('custom:a', [own])).toBe('Zig');
        expect(nameOf('custom:gone')).toBe('custom:gone');
        expect(packageOf('custom:a', [own])).toBe('zig, *.zon');
        expect(packageOf('eslint')).toBe('vscode-langservers-extracted');
        expect(isOwn(own)).toBe(true);
        expect(isOwn(status('php', 'ready'))).toBe(false);
    });

    test('are restarted and read in a log, and never installed', () => {
        expect(actionsOf(status('custom:a', 'crashed', { name: 'Zig' }))).toEqual({ install: false, update: false, rollback: false, restart: true, log: true });
        expect(actionsOf(status('custom:a', 'not-installed')).install).toBe(false);
    });
});

describe('groupedStatuses', () => {
    test('puts the catalog under what it is for, in order, leaves out a group nothing is in, and keeps a server it does not know', () => {
        const all = [
            status('php', 'stopped'),
            status('php-native', 'stopped'),
            status('css', 'ready'),
            status('typescript', 'ready'),
            status('future', 'stopped'),
            own('custom:a')
        ];
        expect(groupedStatuses(all).map((group) => [group.id, group.statuses.map((entry) => entry.server)])).toEqual([
            ['scripts', ['typescript']],
            ['web', ['css']],
            ['other', ['php-native', 'php', 'future']]
        ]);
    });
});

function own(server: string): LanguageServerStatus {
    return status(server, 'stopped', { name: 'Zig', languages: [], patterns: [] });
}
