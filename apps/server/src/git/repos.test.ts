import { describe, expect, test } from 'bun:test';
import { parseSubmodulePaths, repoLabel } from './repos.ts';

describe('repoLabel', () => {
    test('a repository under the folder reads as its path there', () => {
        expect(repoLabel('/work/app', '/work/app/packages/ui')).toBe('packages/ui');
        expect(repoLabel('/work/app', '/work/app/..vendored/ui')).toBe('..vendored/ui');
    });

    test('the folder itself reads as its own name', () => {
        expect(repoLabel('/work/app', '/work/app')).toBe('app');
    });

    test('so does a repository the folder is only a corner of', () => {
        expect(repoLabel('/work/app/apps/client', '/work/app')).toBe('app');
    });

    test('writes the path under a folder on Windows with forward slashes', () => {
        expect(repoLabel('C:\\work\\app', 'C:\\work\\app\\packages\\ui', 'win32')).toBe('packages/ui');
        expect(repoLabel('C:\\work\\app\\apps\\client', 'C:\\work\\app', 'win32')).toBe('app');
    });
});

describe('parseSubmodulePaths', () => {
    test('reads the path out of every line, whatever state it reports', () => {
        const output = [' 93e23dd backend (heads/main)', '+941f79a frontend (heads/main)', 'U0000000 broken'].join('\n');
        expect(parseSubmodulePaths(output)).toEqual(['backend', 'frontend', 'broken']);
    });

    test('a submodule that was never initialized has no checkout to read', () => {
        expect(parseSubmodulePaths('-93e23dd backend\n')).toEqual([]);
    });

    test('a nested submodule keeps the path the recursion reports', () => {
        expect(parseSubmodulePaths(' abc packages/ui/vendor/theme (v1.0)\n')).toEqual(['packages/ui/vendor/theme']);
    });
});
