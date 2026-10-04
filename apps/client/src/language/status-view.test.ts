import { describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { actionsOf, chipServer, listedServers, toneOf } from './status-view';

function status(server: string, state: LanguageServerStatus['state'], extra: Partial<LanguageServerStatus> = {}): LanguageServerStatus {
    return { server, state, version: '1.0.0', documents: 0, ...extra };
}

describe('listedServers', () => {
    test('lists the server of the file, installed or not, and any other one that is up', () => {
        const all = [status('typescript', 'not-installed'), status('vue', 'ready'), status('php', 'stopped')];
        expect(listedServers(all, ['typescript']).map((entry) => entry.server)).toEqual(['typescript', 'vue']);
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
        expect(actionsOf(status('typescript', 'not-installed'))).toEqual({ install: true, restart: false, log: false });
        expect(actionsOf(status('typescript', 'not-installed', { message: 'bun install failed' })).log).toBe(true);
        expect(actionsOf(status('typescript', 'crashed'))).toEqual({ install: false, restart: true, log: true });
        expect(actionsOf(status('typescript', 'installing')).restart).toBe(false);
    });

    test('tells a running server from a stopped one', () => {
        expect(toneOf('ready')).toBe('ok');
        expect(toneOf('indexing')).toBe('busy');
        expect(toneOf('crashed')).toBe('error');
        expect(toneOf('stopped')).toBe('idle');
    });
});
