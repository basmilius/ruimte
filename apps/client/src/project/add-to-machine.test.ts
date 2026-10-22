import { describe, expect, test } from 'bun:test';
import type { FsReadResult } from '@ruimte/contracts';
import { copyCandidates, copyIgnoredFiles, protocolOf, remoteUrlAs, repositoryName, type CopyCandidate } from './add-to-machine';

describe('the remote of a project on another machine', () => {
    test('reads which way a URL reaches its host', () => {
        expect(protocolOf('git@github.com:basmilius/ruimte.git')).toBe('ssh');
        expect(protocolOf('ssh://git@host.example.com:2222/team/app.git')).toBe('ssh');
        expect(protocolOf('https://github.com/basmilius/ruimte.git')).toBe('https');
        expect(protocolOf('/Users/bas/ruimte')).toBeNull();
    });

    test('writes the same repository over the other protocol', () => {
        expect(remoteUrlAs('git@github.com:basmilius/ruimte.git', 'https')).toBe('https://github.com/basmilius/ruimte.git');
        expect(remoteUrlAs('https://github.com/basmilius/ruimte.git', 'ssh')).toBe('git@github.com:basmilius/ruimte.git');
        expect(remoteUrlAs('ssh://git@host.example.com:2222/team/app.git', 'ssh')).toBe('ssh://git@host.example.com:2222/team/app.git');
        expect(remoteUrlAs('ssh://git@host.example.com:2222/team/app.git', 'https')).toBe('https://host.example.com/team/app.git');
        expect(remoteUrlAs('/Users/bas/ruimte', 'https')).toBeNull();
    });

    test('names the clone after the repository', () => {
        expect(repositoryName('git@github.com:basmilius/ruimte.git')).toBe('ruimte');
        expect(repositoryName('https://github.com/basmilius/ruimte/')).toBe('ruimte');
    });
});

describe('the ignored files that go with it', () => {
    test('checks .env files, and never copies a link or a file over the limit', () => {
        const candidates = copyCandidates({
            root: '/work/app',
            prefix: '',
            truncated: false,
            files: [
                { path: '.env', size: 10, link: false, mode: 0o640 },
                { path: 'api/.env.local', size: 10, link: false },
                { path: 'config.local.json', size: 10, link: false },
                { path: '.env.big', size: 2 * 1024 * 1024, link: false },
                { path: '.env.link', size: 10, link: true }
            ]
        });
        expect(candidates.map((file) => [file.path, file.checked, file.skip])).toEqual([
            ['.env', true, null],
            ['api/.env.local', true, null],
            ['config.local.json', false, null],
            ['.env.big', false, 'too-large'],
            ['.env.link', false, 'link']
        ]);
        // A machine that does not say keeps the copy private.
        expect(candidates.map((file) => file.mode).slice(0, 2)).toEqual([0o640, 0o600]);
    });

    test('copies text from one checkout into the other, and says what it did not copy and why', async () => {
        const written: Array<[string, string, number]> = [];
        const files: Record<string, FsReadResult> = {
            '/work/app/.env': { kind: 'text', text: 'KEY=1\n', encoding: 'utf-8', size: 6, mtime: 1 },
            '/work/app/key.p12': { kind: 'binary', mime: 'application/octet-stream', size: 6, mtime: 1 }
        };
        const candidate = (path: string): CopyCandidate => ({ path, size: 6, mode: 0o600, skip: null, checked: true });
        const outcomes = await copyIgnoredFiles(
            [candidate('.env'), candidate('key.p12'), candidate('gone'), { ...candidate('link'), skip: 'link' }],
            '/work/app',
            '/srv/app/',
            {
                read: async (path) => {
                    const found = files[path];
                    if (found === undefined) {
                        throw new Error('not found');
                    }
                    return found;
                },
                write: async (path, text, mode) => {
                    written.push([path, text, mode]);
                },
                keepsMode: true
            }
        );
        expect(written).toEqual([['/srv/app/.env', 'KEY=1\n', 0o600]]);
        expect(outcomes).toEqual([
            { path: '.env', copied: true },
            { path: 'key.p12', copied: false, reason: 'binary' },
            { path: 'gone', copied: false, reason: 'failed', message: 'not found' },
            { path: 'link', copied: false, reason: 'link' }
        ]);
    });

    test('never widens a file to a machine that writes every file 0644: only one all may read here goes there', async () => {
        const written: string[] = [];
        const outcomes = await copyIgnoredFiles(
            [
                { path: '.env', size: 6, mode: 0o600, skip: null, checked: true },
                { path: '.env.group', size: 6, mode: 0o640, skip: null, checked: true },
                { path: 'config.local.json', size: 6, mode: 0o644, skip: null, checked: true }
            ],
            '/work/app',
            '/srv/app',
            {
                read: async () => ({ kind: 'text', text: 'x', encoding: 'utf-8', size: 1, mtime: 1 }),
                write: async (path) => {
                    written.push(path);
                },
                keepsMode: false
            }
        );
        expect(written).toEqual(['/srv/app/config.local.json']);
        expect(outcomes).toEqual([
            { path: '.env', copied: false, reason: 'private' },
            { path: '.env.group', copied: false, reason: 'private' },
            { path: 'config.local.json', copied: true }
        ]);
    });
});
