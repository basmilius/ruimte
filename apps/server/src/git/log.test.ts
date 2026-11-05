import { describe, expect, test } from 'bun:test';
import { parseLog } from './log.ts';
import { nativePath } from './native-path.ts';
import { parseRefs, parseWorktreeBranches } from './refs.ts';
import { FIELD } from './run.ts';

describe('the log', () => {
    test('a subject with the field separator in it stays one subject', () => {
        const record = [
            'abc',
            'abc123',
            'Ada',
            '1700000000',
            '1700000500',
            'ada@example.com',
            'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/heads/fix/a, tag: refs/tags/v1',
            `fix: a${FIELD}b`
        ].join(FIELD);
        const [commit] = parseLog(`${record}\0`);
        expect(commit?.subject).toBe(`fix: a${FIELD}b`);
        expect(commit?.refs).toEqual(['main', 'origin/main', 'fix/a', 'v1']);
        expect(commit?.remoteRefs).toEqual(['origin/main']);
        expect(commit?.at).toBe(1700000000);
        expect(commit?.committedAt).toBe(1700000500);
        expect(commit?.authorEmail).toBe('ada@example.com');
    });
});

describe('refs', () => {
    test('a worktree paragraph names the branch it has out', () => {
        const output = 'worktree /a/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /a/side\nHEAD def\nbranch refs/heads/side\n';
        expect(parseWorktreeBranches(output)).toEqual(
            new Map([
                ['main', nativePath('/a/main')],
                ['side', nativePath('/a/side')]
            ])
        );
    });

    test('the symbolic pointer at the remote head is not a branch to check out', () => {
        const lines = [`origin/HEAD${FIELD}1700000000`, `origin/main${FIELD}1700000000`].join('\n');
        const refs = parseRefs(lines, 'remote', new Map(), 'origin/main');
        expect(refs.map((ref) => ref.name)).toEqual(['origin/main']);
        expect(refs[0]?.isDefault).toBe(true);
    });
});
