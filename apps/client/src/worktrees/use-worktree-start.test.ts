import { describe, expect, test } from 'bun:test';
import { reusableBranches } from './use-worktree-start';

describe('reusableBranches', () => {
    test('leaves out the main checkout, detached and missing worktrees', () => {
        const branches = reusableBranches([{ branch: 'main' }, { branch: 'issue-12-fix' }, { branch: '(detached)' }, { branch: 'gone', missing: true }]);
        expect([...branches]).toEqual(['issue-12-fix']);
    });
});
