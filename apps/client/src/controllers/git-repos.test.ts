import { describe, expect, test } from 'bun:test';
import type { GitRepo } from '@ruimte/contracts';
import type { GitFile, GitStatus } from '@ruimte/contracts';
import { TransportError, type TransportStatus } from '@/transport-api/transport';
import { assumeStaged, deadReadDelay, headMoved, readProjectRepos, soleRepo, visibleRepos, withoutNestedRepos } from './git-repos.ts';

function file(path: string, state: GitFile['state']): GitFile {
    return {
        path,
        state,
        status: state === 'untracked' ? '?' : 'M',
        added: 1,
        deleted: 0,
        binary: false
    };
}

function status(files: GitFile[]): GitStatus {
    return {
        repo: true,
        root: '/work/app',
        branch: 'main',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        base: null,
        mergeBase: null,
        files,
        truncated: false,
        live: true
    };
}

const repos: GitRepo[] = [
    { path: '/work/app', label: 'app', kind: 'root' },
    { path: '/work/app/backend', label: 'backend', kind: 'submodule' },
    { path: '/work/app/frontend', label: 'frontend', kind: 'submodule' }
];

describe('which repositories the panel draws', () => {
    test('the ones a person hid are out, by the label they were hidden under', () => {
        expect(visibleRepos(repos, ['backend']).map((repo) => repo.label)).toEqual(['app', 'frontend']);
    });

    test('a label nobody has anymore hides nothing', () => {
        expect(visibleRepos(repos, ['tools'])).toEqual(repos);
    });

    test('hiding every one of them leaves the panel with none, not with all', () => {
        expect(visibleRepos(repos, ['app', 'backend', 'frontend'])).toEqual([]);
    });
});

describe('a repository inside another', () => {
    const others = ['/work/app', '/work/app/inner'];

    test('the untracked folder it shows up as in the one above it is dropped', () => {
        const before = status([file('inner/', 'untracked'), file('a.ts', 'unstaged')]);
        expect(withoutNestedRepos(before, '/work/app', others)?.files.map((entry) => entry.path)).toEqual(['a.ts']);
    });

    test('a tracked change at that path stays, which is what a submodule gitlink is', () => {
        const before = status([file('inner', 'unstaged')]);
        expect(withoutNestedRepos(before, '/work/app', others)).toBe(before);
    });

    test('a checkout with nothing inside it keeps the very status it was given', () => {
        const before = status([file('a.ts', 'untracked')]);
        expect(withoutNestedRepos(before, '/work/app/inner', others)).toBe(before);
        expect(withoutNestedRepos(null, '/work/app', others)).toBeNull();
    });
});

describe('when the log has to be read again', () => {
    test('the first status of a checkout is no move, since the log is read beside it', () => {
        expect(headMoved(null, status([]))).toBe(false);
    });

    test('a file that changed moves no commit', () => {
        expect(headMoved(status([]), status([file('a.ts', 'unstaged')]))).toBe(false);
    });

    test('a commit, a pull and a switch all show up', () => {
        const before = status([]);
        expect(headMoved(before, { ...before, ahead: 1 })).toBe(true);
        expect(headMoved(before, { ...before, behind: 2 })).toBe(true);
        expect(headMoved(before, { ...before, branch: 'feature/x' })).toBe(true);
        expect(headMoved(before, { ...before, detached: true })).toBe(true);
        expect(headMoved(before, { ...before, upstream: 'origin/main' })).toBe(true);
        expect(headMoved(before, { ...before, mergeBase: 'abc' })).toBe(true);
    });
});

describe('a checkout the machine does not watch', () => {
    test('is read again every 10 seconds while a status is quick, and spends at most a twentieth of the time on a slow one', () => {
        expect(deadReadDelay(80)).toBe(10_000);
        expect(deadReadDelay(500)).toBe(10_000);
        expect(deadReadDelay(3_000)).toBe(60_000);
    });
});

describe('reading the repositories of a folder', () => {
    function link(request: () => Promise<{ repos: GitRepo[]; truncated: boolean }>) {
        const listeners = new Set<(status: TransportStatus) => void>();
        return {
            request: request as never,
            subscribeStatus: (listener: (status: TransportStatus) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            listeners,
            open: () => [...listeners].forEach((listener) => listener('open'))
        };
    }

    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    test('a real answer, an empty one included, is the list', async () => {
        const answers: unknown[] = [];
        readProjectRepos(
            link(async () => ({ repos: [], truncated: false })),
            '/work',
            false,
            { answered: (a) => answers.push(a), again: () => {}, timedOut: () => {} }
        );
        await settle();
        expect(answers).toEqual([{ repos: [], truncated: false }]);
    });

    test('a failure that is an answer of the machine means no repository', async () => {
        const answers: unknown[] = [];
        const failing = link(async () => {
            throw new TransportError('git-failed', 'No');
        });
        readProjectRepos(failing, '/work', false, { answered: (a) => answers.push(a), again: () => {}, timedOut: () => {} });
        await settle();
        expect(answers).toEqual([{ repos: [], truncated: false }]);
    });

    test('a dropped link keeps the list and asks again once the link is open', async () => {
        for (const code of ['disconnected', 'not-connected']) {
            const answers: unknown[] = [];
            let again = 0;
            const dropped = link(async () => {
                throw new TransportError(code, 'Gone');
            });
            readProjectRepos(dropped, '/work', false, { answered: (a) => answers.push(a), again: () => again++, timedOut: () => {} });
            await settle();
            expect(answers).toEqual([]);
            expect(again).toBe(0);
            dropped.open();
            dropped.open();
            expect(again).toBe(1);
            expect(dropped.listeners.size).toBe(0);
        }
    });

    test('a timeout on a link that stays open says so at once and waits on nothing', async () => {
        const answers: unknown[] = [];
        let timedOut = 0;
        const slow = link(async () => {
            throw new TransportError('timeout', 'Slow');
        });
        readProjectRepos(slow, '/work', false, { answered: (a) => answers.push(a), again: () => {}, timedOut: () => timedOut++ });
        await settle();
        expect(answers).toEqual([]);
        expect(timedOut).toBe(1);
        expect(slow.listeners.size).toBe(0);
    });

    test('the sole repository is the folder itself', () => {
        expect(soleRepo('/work/shop')).toEqual([{ path: '/work/shop', label: 'shop', kind: 'root' }]);
    });

    test('cancelling stops the wait for the link', async () => {
        let again = 0;
        const dropped = link(async () => {
            throw new TransportError('disconnected', 'Gone');
        });
        const cancel = readProjectRepos(dropped, '/work', false, { answered: () => {}, again: () => again++, timedOut: () => {} });
        await settle();
        cancel();
        dropped.open();
        expect(again).toBe(0);
    });
});

describe('assumeStaged', () => {
    const file = (path: string, state: GitFile['state'], status: string): GitFile => ({ path, state, status, added: 1, deleted: 0, binary: false });

    test('staging moves a change and a new file into the index', () => {
        const next = assumeStaged(status([file('a', 'unstaged', 'M'), file('b', 'untracked', '?'), file('c', 'unstaged', 'M')]), ['a', 'b'], true);
        expect(next.files.map((entry) => `${entry.path} ${entry.state} ${entry.status}`)).toEqual(['a staged M', 'b staged A', 'c unstaged M']);
    });

    test('staging a file that is in both groups leaves one staged entry', () => {
        const next = assumeStaged(status([file('a', 'staged', 'M'), file('a', 'unstaged', 'M')]), ['a'], true);
        expect(next.files.map((entry) => entry.state)).toEqual(['staged']);
    });

    test('unstaging an added file makes it untracked again', () => {
        const next = assumeStaged(status([file('a', 'staged', 'A'), file('b', 'staged', 'M')]), ['a', 'b'], false);
        expect(next.files.map((entry) => `${entry.path} ${entry.state} ${entry.status}`)).toEqual(['a untracked ?', 'b unstaged M']);
    });

    test('a conflict stays where it is', () => {
        const next = assumeStaged(status([file('a', 'conflicted', 'UU')]), ['a'], true);
        expect(next.files[0]?.state).toBe('conflicted');
    });
});
