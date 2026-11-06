import { describe, expect, mock, test } from 'bun:test';
import { pullRequestCommands } from '@/github/pull-request-commands';

describe('the palette rows that show a pull request', () => {
    test('a folder with one repository keeps the single row, on that repository', () => {
        const show = mock<(cwd: string) => void>(() => undefined);
        const rows = pullRequestCommands('/work', [{ path: '/work/backend', label: 'backend' }], show);
        expect(rows.map((row) => row.id)).toEqual(['pr-show']);
        rows[0]!.run();
        expect(show.mock.calls).toEqual([['/work/backend']]);
    });

    test('a folder whose repositories are not read yet keeps the single row, on the folder', () => {
        const show = mock<(cwd: string) => void>(() => undefined);
        const rows = pullRequestCommands('/work', [], show);
        expect(rows.map((row) => row.id)).toEqual(['pr-show']);
        rows[0]!.run();
        expect(show.mock.calls).toEqual([['/work']]);
    });

    test('several repositories get a row each, named after the repository', () => {
        const show = mock<(cwd: string) => void>(() => undefined);
        const rows = pullRequestCommands(
            '/work',
            [
                { path: '/work/backend', label: 'backend' },
                { path: '/work/web', label: 'web' }
            ],
            show
        );
        expect(rows.map((row) => row.id)).toEqual(['pr-show-in-/work/backend', 'pr-show-in-/work/web']);
        expect(rows[0]!.label).toContain('backend');
        expect(rows[1]!.label).toContain('web');
        for (const row of rows) {
            row.run();
        }
        expect(show.mock.calls).toEqual([['/work/backend'], ['/work/web']]);
    });
});
