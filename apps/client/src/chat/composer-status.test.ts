import { describe, expect, test } from 'bun:test';
import type { GitStatus } from '@ruimte/contracts';
import i18next from 'i18next';
import { whereItems } from './composer-status';

const t = i18next.getFixedT('en', 'chat');

const CHECKOUT: GitStatus = {
    repo: true,
    root: '/work/ruimte',
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    base: 'origin/main',
    mergeBase: null,
    files: [],
    truncated: false,
    live: true
};

const summary = (items: ReturnType<typeof whereItems>) =>
    items.map((item) => ({
        id: item.id,
        label: item.label,
        side: item.side,
        details: item.details?.map((detail) => [detail.label, detail.detail ?? detail.hint])
    }));

describe('whereItems', () => {
    test('the main checkout on the default branch, on this machine, draws no line', () => {
        expect(whereItems({ others: [], status: CHECKOUT, machine: null, onCanvas: false, t })).toEqual([]);
        expect(whereItems({ others: [], status: { ...CHECKOUT, base: 'main' }, machine: null, onCanvas: false, t })).toEqual([]);
    });

    test('a branch of its own in the main checkout is named, with the checkout in its popover', () => {
        expect(summary(whereItems({ others: [], status: { ...CHECKOUT, branch: 'fix/limits' }, machine: null, onCanvas: true, t }))).toEqual([
            {
                id: 'branch',
                label: 'fix/limits',
                side: undefined,
                details: [
                    ['fix/limits', undefined],
                    ['Main checkout', undefined]
                ]
            }
        ]);
    });

    test('a worktree on another machine names both, and the machine stands apart at the end', () => {
        const status = { ...CHECKOUT, root: '/home/bas/.ruimte/worktrees/ruimte/composer', branch: 'feat/composer', worktree: true };
        const items = whereItems({ others: [], status, machine: 'Mac mini', onCanvas: false, t });

        expect(summary(items)).toEqual([
            {
                id: 'branch',
                label: 'feat/composer',
                side: undefined,
                details: [
                    ['feat/composer', undefined],
                    ['Worktree composer', '/home/bas/.ruimte/worktrees/ruimte/composer'],
                    ['Mac mini', 'Other machine']
                ]
            },
            { id: 'machine', label: 'Mac mini', side: 'end', details: undefined }
        ]);
    });

    test('on the canvas the node names its machine, so the line carries only the branch', () => {
        const items = whereItems({ others: [], status: { ...CHECKOUT, worktree: true }, machine: 'Mac mini', onCanvas: true, t });
        expect(items.map((item) => item.id)).toEqual(['branch']);
    });

    test('the main checkout on the default branch on another machine names only the machine', () => {
        expect(whereItems({ others: [], status: CHECKOUT, machine: 'Mac mini', onCanvas: false, t }).map((item) => item.id)).toEqual(['machine']);
        expect(whereItems({ others: [], status: CHECKOUT, machine: 'Mac mini', onCanvas: true, t })).toEqual([]);
    });

    test('outside a repository there is no branch, only the machine', () => {
        const items = whereItems({ others: [], status: { ...CHECKOUT, repo: false, branch: null }, machine: 'Mac mini', onCanvas: false, t });
        expect(items.map((item) => item.id)).toEqual(['machine']);
    });
});

describe('whereItems in a folder with several repositories', () => {
    const outer = { ...CHECKOUT, root: '/work/docksal', branch: 'chore/vhost' };
    const backend = { ...CHECKOUT, root: '/work/docksal/backend', branch: 'feat/matcher', base: 'origin/develop' };
    const frontend = { ...CHECKOUT, root: '/work/docksal/frontend', branch: 'feat/matcher' };

    test('names the branch the CLI works in and counts the others off their own default branch', () => {
        const others = [
            { label: 'backend', status: backend },
            { label: 'frontend', status: frontend }
        ];

        expect(summary(whereItems({ status: outer, others, machine: null, onCanvas: false, t }))).toEqual([
            {
                id: 'branch',
                label: 'chore/vhost +2',
                side: undefined,
                details: [
                    ['chore/vhost', 'docksal'],
                    ['feat/matcher', 'backend'],
                    ['feat/matcher', 'frontend']
                ]
            }
        ]);
    });

    test('a repository on its default branch is listed faint and not counted', () => {
        const others = [
            { label: 'backend', status: { ...backend, branch: 'develop' } },
            { label: 'frontend', status: frontend }
        ];

        const [item] = whereItems({ status: { ...outer, branch: 'main' }, others, machine: null, onCanvas: false, t });
        expect(item?.label).toBe('main +1');
        expect(item?.details?.map((detail) => detail.muted === true)).toEqual([true, true, false]);
    });

    test('every repository on its default branch draws no line', () => {
        const others = [
            { label: 'backend', status: { ...backend, branch: 'develop' } },
            { label: 'frontend', status: { ...frontend, branch: 'main' } }
        ];

        expect(whereItems({ status: { ...outer, branch: 'main' }, others, machine: null, onCanvas: false, t })).toEqual([]);
    });

    test('a folder of loose checkouts leads with the first one that stands out', () => {
        const others = [
            { label: 'backend', status: { ...backend, branch: 'develop' } },
            { label: 'frontend', status: frontend }
        ];

        const items = whereItems({ status: { ...CHECKOUT, repo: false, branch: null }, others, machine: null, onCanvas: false, t });
        expect(items.map((item) => item.label)).toEqual(['feat/matcher']);
    });
});
