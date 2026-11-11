import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    EXTENSION_CALLS_WITHOUT_PERMISSION,
    EXTENSION_CLIENT_PERMISSIONS,
    extensionCallPermission,
    extensionProjectPath,
    extensionWord,
    wordsOver
} from './extension-client.ts';

describe('a path an extension names', () => {
    test.each([
        ['/work/app', 'notes.md', '/work/app/notes.md'],
        ['/work/app', '/work/app/src/a.ts', '/work/app/src/a.ts'],
        ['/work/app', '.', '/work/app'],
        ['/work/app', 'src\\a.ts', '/work/app/src/a.ts'],
        ['C:\\work\\app', 'notes.md', 'C:\\work\\app\\notes.md'],
        ['C:\\work\\app', 'C:\\work\\app\\notes.md', 'C:\\work\\app\\notes.md'],
        ['C:\\work\\app', 'c:/work/app/src/a.ts', 'c:\\work\\app\\src\\a.ts'],
        ['C:\\work\\app\\', 'src/a.ts', 'C:\\work\\app\\src\\a.ts'],
        ['\\\\server\\share\\app', '\\\\server\\share\\app\\notes.md', '\\\\server\\share\\app\\notes.md'],
        ['\\\\server\\share\\app', 'notes.md', '\\\\server\\share\\app\\notes.md'],
        ['/', '.', '/'],
        ['/', 'notes.md', '/notes.md'],
        ['/', '/src/a.ts', '/src/a.ts'],
        ['C:\\', '.', 'C:\\'],
        ['C:\\', 'notes.md', 'C:\\notes.md'],
        ['C:/', 'src/a.ts', 'C:\\src\\a.ts'],
        ['\\\\server\\share', '.', '\\\\server\\share'],
        ['\\\\server\\share\\', 'notes.md', '\\\\server\\share\\notes.md'],
        ['/work/app', './src/./a.ts', '/work/app/src/a.ts']
    ])('in %p, %p is %p', (folder, path, full) => {
        expect(extensionProjectPath(folder, path)).toBe(full);
    });

    test.each([
        ['/work/app', '/work/other/notes.md'],
        ['/work/app', '/work/app-two/notes.md'],
        ['/work/app', 'sub/../../x'],
        ['C:\\work\\app', 'D:\\work\\app\\notes.md'],
        ['C:\\work\\app', 'C:\\work\\other\\notes.md'],
        ['C:\\work\\app', 'sub\\..\\..\\x'],
        ['C:\\work\\app', '/work/app/notes.md'],
        ['\\\\server\\share\\app', '\\\\other\\share\\app\\notes.md'],
        ['C:\\', 'D:\\notes.md'],
        ['C:\\', '\\\\server\\share\\notes.md'],
        ['/work/app', '//work/app/notes.md']
    ])('in %p, %p is outside', (folder, path) => {
        expect(extensionProjectPath(folder, path)).toBeNull();
    });
});

interface DeclaredCall {
    readonly call: string;
    /* The permission its doc comment says it needs, if it names one. */
    readonly documented: string | null;
}

/*
 * The calls an `.d.ts` of `@ruimte/extension` declares: the members of its `export const area: {` objects and, when asked,
 * its `export function`s, each with the permission its doc comment names. A doc on the object covers its members.
 */
function declaredCalls(module: 'client' | 'server', options: { functions: boolean }): DeclaredCall[] {
    const calls: DeclaredCall[] = [];
    let area: { name: string; documented: string | null } | null = null;
    let doc = '';
    let inDoc = false;

    for (const line of readFileSync(join(import.meta.dir, '../../extension', `${module}.d.ts`), 'utf8').split('\n')) {
        const trimmed = line.trim();

        if (inDoc || trimmed.startsWith('/**')) {
            doc = inDoc ? `${doc} ${trimmed}` : trimmed;
            inDoc = !trimmed.endsWith('*/');
            continue;
        }

        const documented = /Needs (?:the permission )?`([\w.]+)`/.exec(doc)?.[1] ?? null;
        const objectDocumented = /Needs the permission `([\w.]+)`/.exec(doc)?.[1] ?? null;
        const open = /^export const (\w+): \{$/.exec(line);
        doc = '';

        if (open !== null) {
            area = { name: open[1] as string, documented: objectDocumented };
        } else if (line === '};') {
            area = null;
        } else if (area !== null) {
            const member = /^ {4}(\w+)[(<]/.exec(line)?.[1];

            if (member !== undefined) {
                calls.push({ call: `${area.name}.${member}`, documented: documented ?? area.documented });
            }
        } else if (options.functions) {
            const name = /^export function (\w+)/.exec(line)?.[1];

            if (name !== undefined) {
                calls.push({ call: name, documented });
            }
        }
    }

    return calls;
}

describe('the permission of each call', () => {
    const client = declaredCalls('client', { functions: true });
    const server = declaredCalls('server', { functions: true });
    const members = (calls: DeclaredCall[]) => calls.filter((entry) => entry.call.includes('.')).map((entry) => entry.call);
    const guarded = Object.keys(EXTENSION_CLIENT_PERMISSIONS);

    test('is in the table or in the list of calls that need none, for every call of an area the API declares', () => {
        const accounted = new Set([...guarded, ...EXTENSION_CALLS_WITHOUT_PERMISSION]);

        expect(client.length).toBeGreaterThan(30);
        expect(server.length).toBeGreaterThan(5);
        expect([...members(client), ...members(server)].filter((call) => !accounted.has(call))).toEqual([]);
    });

    test('is asked for only calls the API declares, and no call is in both lists', () => {
        const declared = new Set([...client, ...server].map((entry) => entry.call));

        expect([...guarded, ...EXTENSION_CALLS_WITHOUT_PERMISSION].filter((call) => !declared.has(call))).toEqual([]);
        expect(guarded.filter((call) => EXTENSION_CALLS_WITHOUT_PERMISSION.includes(call))).toEqual([]);
    });

    test('is the one the docs of a call name', () => {
        const documented = [...client, ...server].filter((entry) => entry.documented !== null && entry.call in EXTENSION_CLIENT_PERMISSIONS);

        expect(documented.length).toBeGreaterThan(5);
        expect(documented.filter((entry) => extensionCallPermission(entry.call) !== entry.documented)).toEqual([]);
    });
});

describe('the words of an extension', () => {
    const english = { pets: { title: 'Pets', frames_one: '{{count}} frame', frames_other: '{{count}} frames', use: 'Use {{name}}' }, flat: 'Flat' };
    const dutch = wordsOver(english, { pets: { title: 'Huisdieren' } });

    test('read a key with dots into nested objects, and a flat key as it is', () => {
        expect(extensionWord(english, 'en', 'pets.title')).toBe('Pets');
        expect(extensionWord(english, 'en', 'flat')).toBe('Flat');
    });

    test('count in the forms of the language, with each value in its place', () => {
        expect(extensionWord(english, 'en', 'pets.frames', { count: 1 })).toBe('1 frame');
        expect(extensionWord(english, 'en', 'pets.frames', { count: 4 })).toBe('4 frames');
        expect(extensionWord(english, 'en', 'pets.use', { name: 'Nox' })).toBe('Use Nox');
    });

    test('keep the English of a word another language lacks, and read an unknown key as itself', () => {
        expect(extensionWord(dutch, 'nl', 'pets.title')).toBe('Huisdieren');
        expect(extensionWord(dutch, 'nl', 'pets.use', { name: 'Nox' })).toBe('Use Nox');
        expect(extensionWord(dutch, 'nl', 'pets.missing')).toBe('pets.missing');
    });
});
