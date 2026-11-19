import { describe, expect, test } from 'bun:test';
import { ghError, runGh } from './github.ts';

describe('ghError', () => {
    test('tells a missing gh and a missing login apart', () => {
        expect(ghError({ code: 128, stdout: '', stderr: 'gh could not be started' }).code).toBe('gh-missing');
        expect(ghError({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }).code).toBe('gh-unauthenticated');
        expect(ghError({ code: 1, stdout: '', stderr: 'boom' }).code).toBe('gh-failed');
    });
});

describe('runGh', () => {
    test('says the folder is missing instead of a gh that cannot start', async () => {
        await expect(runGh(['--version'], '/definitely/not/a/folder')).rejects.toMatchObject({ code: 'folder-missing' });
    });
});
