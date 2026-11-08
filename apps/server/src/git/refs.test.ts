import { expect, test } from 'bun:test';
import { parseRefs } from './refs.ts';
import { FIELD } from './run.ts';

test('a ref keeps its full name, which tells a remote branch from a local branch with a slash in its name', () => {
    const local = ['origin/main', '1700000000', ' ', 'abc', 'refs/heads/origin/main'].join(FIELD);
    const remote = ['origin/main', '1700000001', ' ', 'def', 'refs/remotes/origin/main'].join(FIELD);

    expect(parseRefs(local, 'local', new Map(), null)[0]?.fullName).toBe('refs/heads/origin/main');
    expect(parseRefs(remote, 'remote', new Map(), null)[0]?.fullName).toBe('refs/remotes/origin/main');
});

test("a remote's default-branch pointer is left out, also where git shortens it to the remote's name", () => {
    const lines = [
        ['origin', '1700000000', ' ', 'abc', 'refs/remotes/origin/HEAD'].join(FIELD),
        ['origin/main', '1700000000', ' ', 'abc', 'refs/remotes/origin/main'].join(FIELD)
    ].join('\n');

    expect(parseRefs(lines, 'remote', new Map(), null).map((ref) => ref.name)).toEqual(['origin/main']);
});

test('a line from before the full name has none', () => {
    const line = ['main', '1700000000', '*', 'abc'].join(FIELD);

    expect(parseRefs(line, 'local', new Map(), 'main')[0]).not.toHaveProperty('fullName');
});
