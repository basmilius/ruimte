import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, createReleaseNotes, releasesFrom } from './release-notes';

// The body of v0.0.8 as GitHub serves it.
const BODY_0_0_8 = `## 🚀 Features

**Shortcuts**
- Every shortcut follows the platform it runs on: Cmd on macOS and Ctrl elsewhere, and its label reads ⌘⇧K or Ctrl+Shift+K to match.
- Off macOS a terminal keeps Ctrl+W, Ctrl+T and Ctrl+\\, and the canvas takes Ctrl+W so the window stays open.

## 🐛 Fixes

- Links in an HTML preview now open in the system browser instead of inside the app.

## 🎨 Styles

- The monospace font follows the terminal font setting.

**Full Changelog:** https://github.com/basmilius/ruimte/compare/v0.0.7...v0.0.8
`;

const release = (tag: string, patch: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-09-14T07:52:45Z',
    html_url: `https://github.com/basmilius/ruimte/releases/tag/${tag}`,
    body: null,
    ...patch
});

describe('releasesFrom', () => {
    test('takes the Full Changelog line off a real body and keeps its link', () => {
        const [entry] = releasesFrom([release('v0.0.8', { body: BODY_0_0_8 })]);
        expect(entry?.version).toBe('0.0.8');
        expect(entry?.compareUrl).toBe('https://github.com/basmilius/ruimte/compare/v0.0.7...v0.0.8');
        expect(entry?.body.startsWith('## 🚀 Features')).toBe(true);
        expect(entry?.body.endsWith('- The monospace font follows the terminal font setting.')).toBe(true);
        expect(entry?.body).not.toContain('Full Changelog');
    });

    test('reads a release without notes as an empty body', () => {
        expect(releasesFrom([release('v0.0.3', { body: null }), release('v0.0.2', { body: '' })])).toEqual([
            {
                version: '0.0.3',
                publishedAt: '2026-09-14T07:52:45Z',
                body: '',
                url: 'https://github.com/basmilius/ruimte/releases/tag/v0.0.3',
                compareUrl: null
            },
            {
                version: '0.0.2',
                publishedAt: '2026-09-14T07:52:45Z',
                body: '',
                url: 'https://github.com/basmilius/ruimte/releases/tag/v0.0.2',
                compareUrl: null
            }
        ]);
    });

    test('reads CRLF line endings', () => {
        const [entry] = releasesFrom([release('v0.0.8', { body: '- One\r\n\r\n**Full Changelog:** https://example.com/compare\r\n' })]);
        expect(entry?.body).toBe('- One');
        expect(entry?.compareUrl).toBe('https://example.com/compare');
    });

    test('leaves out drafts, prereleases and tags that are not versions', () => {
        const releases = releasesFrom([
            release('v0.0.9', { draft: true }),
            release('v0.1.0-beta.1', { prerelease: true }),
            release('v0.1.0', { prerelease: true }),
            release('nightly'),
            release('v0.0.8'),
            'not a release'
        ]);
        expect(releases.map((entry) => entry.version)).toEqual(['0.0.8']);
    });

    test('sorts by version rather than by the order GitHub answers in', () => {
        const releases = releasesFrom([release('v0.0.9'), release('v0.0.10'), release('v0.0.2')]);
        expect(releases.map((entry) => entry.version)).toEqual(['0.0.10', '0.0.9', '0.0.2']);
    });

    test('answers an empty list for anything that is not a list', () => {
        expect(releasesFrom({ message: 'Not Found' })).toEqual([]);
        expect(releasesFrom(null)).toEqual([]);
    });
});

describe('compareVersions', () => {
    test('compares each part as a number', () => {
        expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
        expect(compareVersions('0.0.8', '0.0.8')).toBe(0);
        expect(compareVersions('0.0.7', '0.0.8')).toBeLessThan(0);
    });
});

describe('createReleaseNotes', () => {
    let folder: string;
    let cacheFile: string;

    beforeEach(() => {
        folder = mkdtempSync(join(tmpdir(), 'ruimte-release-notes-'));
        cacheFile = join(folder, 'release-notes.json');
    });

    afterEach(() => {
        rmSync(folder, { recursive: true, force: true });
    });

    const answer = (status: number, json: unknown = null, etag: string | null = null): Response =>
        new Response(status === 304 ? null : JSON.stringify(json), { status, headers: etag ? { etag } : {} });

    test('fetches once with nothing cached, and not again unless asked to refresh', async () => {
        const asked: Record<string, string>[] = [];
        const notes = createReleaseNotes({
            cacheFile,
            fetch: async (_url, init) => {
                asked.push(init.headers);
                return answer(200, [release('v0.0.8', { body: BODY_0_0_8 })], '"abc"');
            }
        });
        const first = await notes.list(false);
        expect(first.releases.map((entry) => entry.version)).toEqual(['0.0.8']);
        expect(first.error).toBeNull();
        await notes.list(false);
        expect(asked).toHaveLength(1);
        await notes.list(true);
        expect(asked).toHaveLength(2);
        expect(asked[1]?.['If-None-Match']).toBe('"abc"');
    });

    test('keeps the list on a 304', async () => {
        let calls = 0;
        const notes = createReleaseNotes({
            cacheFile,
            fetch: async () => {
                calls += 1;
                return calls === 1 ? answer(200, [release('v0.0.8')], '"abc"') : answer(304);
            }
        });
        await notes.list(true);
        const second = await notes.list(true);
        expect(second.releases.map((entry) => entry.version)).toEqual(['0.0.8']);
    });

    test('offline, answers the list the previous run wrote to disk with the reason beside it', async () => {
        await createReleaseNotes({ cacheFile, fetch: async () => answer(200, [release('v0.0.8')], '"abc"') }).list(true);
        expect(JSON.parse(readFileSync(cacheFile, 'utf8')).etag).toBe('"abc"');

        const offline = createReleaseNotes({
            cacheFile,
            fetch: async () => {
                throw new Error('net::ERR_INTERNET_DISCONNECTED');
            }
        });
        const state = await offline.list(true);
        expect(state.releases.map((entry) => entry.version)).toEqual(['0.0.8']);
        expect(state.error).toBe('net::ERR_INTERNET_DISCONNECTED');
    });

    test('says why GitHub refused, with nothing cached', async () => {
        const notes = createReleaseNotes({ cacheFile, fetch: async () => answer(403, { message: 'rate limited' }) });
        const state = await notes.list(true);
        expect(state.releases).toEqual([]);
        expect(state.fetchedAt).toBeNull();
        expect(state.error).toBe('GitHub is limiting requests from this network. Try again later.');
    });

    test('answers two callers at the same moment with one request', async () => {
        let calls = 0;
        const notes = createReleaseNotes({
            cacheFile,
            fetch: async () => {
                calls += 1;
                return answer(200, [release('v0.0.8')]);
            }
        });
        await Promise.all([notes.list(true), notes.list(true)]);
        expect(calls).toBe(1);
    });
});
