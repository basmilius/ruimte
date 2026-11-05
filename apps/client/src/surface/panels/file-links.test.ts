import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { FsLocatePayload, RequestType } from '@ruimte/contracts';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { normalizedPath, openFileLink, parseFileRef, resolveFileRef, useFileChoice } from '@/surface/panels/file-links';
import { machineTransport } from '@/transport/index';

describe('parseFileRef', () => {
    test('takes a path with a separator, whatever the extension is', () => {
        expect(parseFileRef('apps/client/src/main.tsx')).toEqual({ path: 'apps/client/src/main.tsx', directory: false });
        expect(parseFileRef('apps/server/src/pty/adapter.odd')).toEqual({ path: 'apps/server/src/pty/adapter.odd', directory: false });
    });

    test('takes a bare name only when its extension is one a project writes', () => {
        expect(parseFileRef('README.md')).toEqual({ path: 'README.md', directory: false });
        expect(parseFileRef('report.pdf')).toEqual({ path: 'report.pdf', directory: false });
        for (const archive of ['build.zip', 'release.tar', 'site.tar.gz', 'site.tgz', 'library.jar']) {
            expect(parseFileRef(archive)).toEqual({ path: archive, directory: false });
        }
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

    test('retains the line and column a reference names', () => {
        expect(parseFileRef('src/state/files.ts:42')).toEqual({ path: 'src/state/files.ts', line: 42, directory: false });
        expect(parseFileRef('src/state/files.ts:42:7')).toEqual({ path: 'src/state/files.ts', line: 42, column: 7, directory: false });
        expect(parseFileRef('src/state/files.ts#L42')).toEqual({ path: 'src/state/files.ts', line: 42, directory: false });
    });

    test('spaces, quoted paths, columns and inclusive ranges share one location', () => {
        for (const text of ['"src/a file.ts:12:4-16"', '"src/a file.ts":12:4-16', '`src/a file.ts#L12C4-L16`']) {
            expect(parseFileRef(text)).toEqual({ path: 'src/a file.ts', line: 12, column: 4, endLine: 16, directory: false });
        }
        expect(parseFileRef('a file.ts:12-16', true)).toEqual({ path: 'a file.ts', line: 12, endLine: 16, directory: false });
        expect(parseFileRef('missing.ts:3')).toEqual({ path: 'missing.ts', line: 3, directory: false });
        for (const text of ['file.ts:0', 'file.ts:2:0', 'src/a.ts:12-4', 'file.ts#L0-L2']) {
            expect(parseFileRef(text)).toBeNull();
        }
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

describe('normalizedPath', () => {
    test('takes out the dots, so one file reached two ways is one path', () => {
        expect(normalizedPath('/repo/./src/../lib/a.ts')).toBe('/repo/lib/a.ts');
        expect(normalizedPath('/repo/src/')).toBe('/repo/src');
        expect(normalizedPath('/../a.ts')).toBe('/a.ts');
        expect(normalizedPath('C:\\repo\\src\\..\\a.ts')).toBe('C:\\repo\\a.ts');
        expect(normalizedPath('../a.ts')).toBe('../a.ts');
    });

    test('a backslash in a POSIX path stays part of its name', () => {
        expect(normalizedPath('/repo/a \\ b/./same.ts')).toBe('/repo/a \\ b/same.ts');
        expect(resolveFileRef('/repo/a \\ b', { path: 'same.ts', directory: false })).toBe('/repo/a \\ b/same.ts');
        expect(normalizedPath('C:/repo\\src/..\\a.ts')).toBe('C:/repo/a.ts');
    });

    test('a relative reference that climbs out of its folder resolves to where it lands', () => {
        expect(resolveFileRef('/repo/apps/client', { path: '../server/main.ts', directory: false })).toBe('/repo/apps/server/main.ts');
    });
});

describe('openFileLink', () => {
    beforeEach(() => {
        // Without a project id, the tabs stay out of the storage the test environment does not have.
        useFiles.setState({ projectId: null, tabs: [], focusRequest: null, reveal: null, revealLine: null });
        useDocument.getState().load(null, null);
        useProject.setState({ current: { folder: '/repo' } as never });
    });

    afterEach(() => {
        useProject.setState({ current: null });
    });

    test('a file opens as a tab, and a host takes a cell of the grid', async () => {
        await openFileLink('/repo', { path: 'src/main.ts', directory: false });
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/repo/src/main.ts']);
        expect(useDocument.getState().activeViewId).toBe('/repo/src/main.ts');
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

    test('the complete range reaches the existing preview action', async () => {
        await openFileLink('/repo', { path: 'src/a file.ts', line: 12, column: 4, endLine: 16, directory: false });
        expect(useFiles.getState().revealLine).toEqual({ key: '/repo/src/a file.ts', line: 12, column: 4, endLine: 16, nonce: 1 });
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

describe('openFileLink on a machine that locates files', () => {
    const asked: FsLocatePayload[] = [];
    let matches: string[] = [];
    let restore: () => void = () => undefined;

    beforeEach(() => {
        asked.length = 0;
        useFiles.setState({ projectId: null, tabs: [], focusRequest: null, reveal: null, revealLine: null });
        useDocument.getState().load(null, null);
        useProject.setState({ current: { folder: '/repo' } as never, currentEndpointId: currentEndpointId() });
        useFileChoice.setState({ choice: null });
        useToasts.setState({ toasts: [] } as never);
        const transport = machineTransport(currentEndpointId());
        Object.defineProperty(transport, 'connection', { configurable: true, get: () => ({ status: 'open', features: ['fs.locate'] }) });
        const request = spyOn(transport, 'request').mockImplementation((async (type: RequestType, payload: unknown) => {
            if (type === 'fs.locate') {
                asked.push(payload as FsLocatePayload);
                return { matches };
            }
            throw new Error(`unexpected ${type}`);
        }) as never);
        restore = () => {
            request.mockRestore();
            delete (transport as unknown as Record<string, unknown>).connection;
        };
    });

    afterEach(() => {
        restore();
        useProject.setState({ current: null, currentEndpointId: null });
        useFileChoice.setState({ choice: null });
    });

    test("asks with the agent's folder and the project's, and opens the one place the machine names", async () => {
        matches = ['/repo/lib/src/a.ts'];
        await openFileLink('/worktree', { path: 'src/a.ts', line: 3, directory: false });
        expect(asked).toEqual([{ path: 'src/a.ts', cwd: '/worktree', folder: '/repo' }]);
        expect(useFiles.getState().tabs.map((tab) => tab.key)).toEqual(['/repo/lib/src/a.ts']);
        expect(useFiles.getState().revealLine?.line).toBe(3);
    });

    test('a path that is nowhere opens nothing and says so', async () => {
        matches = [];
        await openFileLink('/repo', { path: 'src/gone.ts', directory: false });
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(['src/gone.ts is not on this machine']);
    });

    test('more than one place asks the person which one', async () => {
        matches = ['/repo/lib/src/a.ts', '/repo/other/src/a.ts'];
        await openFileLink('/repo', { path: 'src/a.ts', directory: false });
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useFileChoice.getState().choice?.matches).toEqual(matches);
    });
});
