import { describe, expect, it } from 'bun:test';
import { globMatch } from './glob.ts';
import { watchesFile } from './watched-files.ts';

const root = '/work/app';

describe('globMatch', () => {
    it('reads classes, negated classes and braces, and a comma outside braces as itself', () => {
        expect(globMatch('src/a1.ts', '**/a[0-9].ts')).toBe(true);
        expect(globMatch('src/ab.ts', '**/a[!0-9].ts')).toBe(true);
        expect(globMatch('src/a1.ts', '**/a[!0-9].ts')).toBe(false);
        expect(globMatch('x.tsx', '*.{ts,tsx}')).toBe(true);
        expect(globMatch('a,b.txt', 'a,b.txt')).toBe(true);
        expect(globMatch('b.txt', 'a,b.txt')).toBe(false);
    });
});

describe('watchesFile', () => {
    it('matches a string pattern against the path inside the project, at any depth for **', () => {
        const watchers = [{ globPattern: '**/*.php' }];
        expect(watchesFile(watchers, root, '/work/app/Generated.php', 1)).toBe(true);
        expect(watchesFile(watchers, root, '/work/app/src/deep/Generated.php', 1)).toBe(true);
        expect(watchesFile(watchers, root, '/work/app/main.ts', 1)).toBe(false);
        expect(watchesFile(watchers, root, '/elsewhere/Generated.php', 1)).toBe(false);
    });

    it('honors the kinds a watcher asked for, which are all three when it names none', () => {
        const created = [{ globPattern: '**/*.ts', kind: 1 }];
        expect(watchesFile(created, root, '/work/app/a.ts', 1)).toBe(true);
        expect(watchesFile(created, root, '/work/app/a.ts', 2)).toBe(false);
        expect(watchesFile(created, root, '/work/app/a.ts', 3)).toBe(false);
        const deletedOrChanged = [{ globPattern: '**/*.ts', kind: 6 }];
        expect(watchesFile(deletedOrChanged, root, '/work/app/a.ts', 1)).toBe(false);
        expect(watchesFile(deletedOrChanged, root, '/work/app/a.ts', 2)).toBe(true);
        expect(watchesFile(deletedOrChanged, root, '/work/app/a.ts', 3)).toBe(true);
        expect(watchesFile([{ globPattern: '**/*.ts' }], root, '/work/app/a.ts', 3)).toBe(true);
    });

    it('matches a relative pattern against its own base', () => {
        const watchers = [{ globPattern: { baseUri: 'file:///work/app/packages/ui', pattern: '**/*.css' } }];
        expect(watchesFile(watchers, root, '/work/app/packages/ui/theme/a.css', 2)).toBe(true);
        expect(watchesFile(watchers, root, '/work/app/packages/api/a.css', 2)).toBe(false);
        expect(
            watchesFile([{ globPattern: { baseUri: { uri: 'file:///work/app', name: 'app' }, pattern: 'tsconfig.json' } }], root, '/work/app/tsconfig.json', 2)
        ).toBe(true);
        expect(watchesFile([{ globPattern: { baseUri: 'https://example.com/x', pattern: '**' } }], root, '/work/app/a.ts', 2)).toBe(false);
    });

    it('takes an absolute pattern as it is', () => {
        expect(watchesFile([{ globPattern: '/work/app/**/*.lock' }], root, '/work/app/a/b.lock', 2)).toBe(true);
    });

    it('keeps dependency folders and git internals out unless the pattern names them', () => {
        expect(watchesFile([{ globPattern: '**/*.ts' }], root, '/work/app/node_modules/x/index.ts', 2)).toBe(false);
        expect(watchesFile([{ globPattern: '**/*.php' }], root, '/work/app/vendor/acme/Thing.php', 1)).toBe(false);
        expect(watchesFile([{ globPattern: '**/*' }], root, '/work/app/.git/HEAD', 2)).toBe(false);
        expect(watchesFile([{ globPattern: '**/node_modules/**' }], root, '/work/app/node_modules/x/index.ts', 2)).toBe(true);
        expect(watchesFile([{ globPattern: '**/node_modules/typescript/package.json' }], root, '/work/app/node_modules/typescript/package.json', 2)).toBe(true);
        expect(watchesFile([{ globPattern: 'vendor/composer/*.json' }], root, '/work/app/vendor/composer/installed.json', 2)).toBe(true);
    });
});
