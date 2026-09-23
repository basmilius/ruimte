import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openFileLink, parseFileRef, resolveFileRef } from '@/shell/panels/file-links';
import { FILES_VIEW_ID } from '@/shell/files-view';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';

describe('parseFileRef', () => {
    test('takes a path with a separator, whatever the extension is', () => {
        expect(parseFileRef('apps/client/src/main.tsx')).toEqual({ path: 'apps/client/src/main.tsx', directory: false });
        expect(parseFileRef('apps/server/src/pty/adapter.odd')).toEqual({ path: 'apps/server/src/pty/adapter.odd', directory: false });
    });

    test('takes a bare name only when its extension is one a project writes', () => {
        expect(parseFileRef('README.md')).toEqual({ path: 'README.md', directory: false });
        expect(parseFileRef('report.pdf')).toEqual({ path: 'report.pdf', directory: false });
        expect(parseFileRef('useFiles.getState')).toBeNull();
        expect(parseFileRef('v1.2')).toBeNull();
    });

    test('takes a dotfile and the files a project spells without an extension', () => {
        expect(parseFileRef('.editorconfig')).toEqual({ path: '.editorconfig', directory: false });
        expect(parseFileRef('.env')).toEqual({ path: '.env', directory: false });
        expect(parseFileRef('Dockerfile')).toEqual({ path: 'Dockerfile', directory: false });
        expect(parseFileRef('.')).toBeNull();
        expect(parseFileRef('..')).toBeNull();
    });

    test('reads the line a reference names and drops the column', () => {
        expect(parseFileRef('src/state/files.ts:42')).toEqual({ path: 'src/state/files.ts', line: 42, directory: false });
        expect(parseFileRef('src/state/files.ts:42:7')).toEqual({ path: 'src/state/files.ts', line: 42, directory: false });
        expect(parseFileRef('src/state/files.ts#L42')).toEqual({ path: 'src/state/files.ts', line: 42, directory: false });
    });

    test('an absolute path keeps its root, on either kind of machine', () => {
        expect(parseFileRef('/Users/bas/project/main.ts')).toEqual({ path: '/Users/bas/project/main.ts', directory: false });
        expect(parseFileRef('C:\\project\\main.ts')).toEqual({ path: 'C:\\project\\main.ts', directory: false });
    });

    test('a trailing separator is a directory and carries no line', () => {
        expect(parseFileRef('apps/server/src/usage/')).toEqual({ path: 'apps/server/src/usage/', directory: true });
    });

    test('leaves a url, a mail address and a home-relative path alone', () => {
        expect(parseFileRef('https://ruimte.app/docs.md')).toBeNull();
        expect(parseFileRef('mailto:someone@example.com')).toBeNull();
        expect(parseFileRef('~/.ruimte/sessions/a.txt')).toBeNull();
    });

    test('leaves prose, globs and anything with a space alone', () => {
        expect(parseFileRef('the files.ts and the rest')).toBeNull();
        expect(parseFileRef('src/**/*.ts')).toBeNull();
        expect(parseFileRef('e.g.')).toBeNull();
        expect(parseFileRef('')).toBeNull();
    });

    test('drops the punctuation a sentence leaves behind and the ./ that says nothing', () => {
        expect(parseFileRef('see src/main.ts.')).toBeNull();
        expect(parseFileRef('src/main.ts,')).toEqual({ path: 'src/main.ts', directory: false });
        expect(parseFileRef('./vite.config.ts')).toEqual({ path: 'vite.config.ts', directory: false });
    });
});

describe('resolveFileRef', () => {
    test('a relative reference counts from the folder it was read in', () => {
        expect(resolveFileRef('/repo', { path: 'src/main.ts', directory: false })).toBe('/repo/src/main.ts');
    });

    test('an absolute reference needs no folder, a relative one has nowhere to go without it', () => {
        expect(resolveFileRef(null, { path: '/repo/src/main.ts', directory: false })).toBe('/repo/src/main.ts');
        expect(resolveFileRef(null, { path: 'src/main.ts', directory: false })).toBeNull();
    });

    test('a directory resolves without its trailing separator, the way a tab and a reveal name one', () => {
        expect(resolveFileRef('/repo', { path: 'src/usage/', directory: true })).toBe('/repo/src/usage');
        expect(resolveFileRef(null, { path: '/repo/src/usage/', directory: true })).toBe('/repo/src/usage');
    });
});

describe('openFileLink', () => {
    beforeEach(() => {
        // Without a project id, the tabs stay out of the storage the test environment does not have.
        useFiles.setState({ projectId: null, tabs: [], active: null, focusRequest: 0, reveal: null, revealLine: null });
        useDocument.getState().load(null, null);
        useProject.setState({ current: { folder: '/repo' } as never });
    });

    afterEach(() => {
        useProject.setState({ current: null });
    });

    test('a file opens as a tab, and the files take a cell of the grid', async () => {
        await openFileLink('/repo', { path: 'src/main.ts', directory: false });
        expect(useFiles.getState().tabs.map((tab) => tab.path)).toEqual(['/repo/src/main.ts']);
        expect(useDocument.getState().activeViewId).toBe(FILES_VIEW_ID);
    });

    test('the line a reference names travels to the viewer, once per ask', async () => {
        await openFileLink('/repo', { path: 'src/main.ts', line: 42, directory: false });
        expect(useFiles.getState().revealLine).toEqual({ key: '/repo/src/main.ts', line: 42, nonce: 1 });
        await openFileLink('/repo', { path: 'src/main.ts', line: 42, directory: false });
        expect(useFiles.getState().revealLine?.nonce).toBe(2);
    });

    test('a file without a line leaves the jump that was asked for before it alone', async () => {
        await openFileLink('/repo', { path: 'src/main.ts', line: 42, directory: false });
        await openFileLink('/repo', { path: 'src/other.ts', directory: false });
        expect(useFiles.getState().revealLine?.line).toBe(42);
    });

    test('a folder is brought into view in the files panel instead of opened as a tab', async () => {
        await openFileLink('/repo', { path: 'src/usage/', directory: true });
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useFiles.getState().reveal?.path).toBe('/repo/src/usage');
    });

    test('a relative reference with no folder to count from opens nothing', async () => {
        await openFileLink(null, { path: 'src/main.ts', directory: false });
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useDocument.getState().layout).toBeNull();
    });
});
