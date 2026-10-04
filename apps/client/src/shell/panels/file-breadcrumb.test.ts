import { describe, expect, test } from 'bun:test';
import { pathCrumbs } from '@/shell/panels/file-breadcrumb';

describe('pathCrumbs', () => {
    test('is relative to the project folder', () => {
        expect(pathCrumbs('/repo/backend/src/score.ts', '/repo')).toEqual({ folders: ['backend', 'src'], name: 'score.ts' });
        expect(pathCrumbs('/repo/score.ts', '/repo')).toEqual({ folders: [], name: 'score.ts' });
    });

    test('keeps the last folders of a long path and marks the cut', () => {
        expect(pathCrumbs('/repo/a/b/c/d/e/score.ts', '/repo')).toEqual({ folders: ['…', 'c', 'd', 'e'], name: 'score.ts' });
    });

    test('shows the path of a file outside the project, or without one open', () => {
        expect(pathCrumbs('/etc/hosts', '/repo')).toEqual({ folders: ['etc'], name: 'hosts' });
        expect(pathCrumbs('/home/me/notes.md', null)).toEqual({ folders: ['home', 'me'], name: 'notes.md' });
        expect(pathCrumbs('C:\\work\\a.ts', null)).toEqual({ folders: ['C:', 'work'], name: 'a.ts' });
    });
});
