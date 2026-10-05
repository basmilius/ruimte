import { describe, expect, test } from 'bun:test';
import type { CustomLanguageServer } from '@ruimte/contracts';
import { draftOf, emptyDraft, inputOf, parseArgs, parseEnv, parseLanguages, problemOf } from './custom-draft';

const server: CustomLanguageServer = {
    id: 'custom:a',
    name: 'Zig',
    command: 'zls',
    args: ['--stdio', '--log level'],
    env: { ZLS_LOG: '1', EMPTY: '' },
    languages: ['zig'],
    patterns: ['*.zon', 'src/*.{zig,zon}'],
    initializationOptions: { snippets: true },
    projects: ['/work/a']
};

describe('the draft of a server of a person', () => {
    test('reads back what the server was saved with', () => {
        const draft = draftOf(server);
        expect(problemOf(draft)).toBeNull();
        expect(inputOf(draft)).toEqual({
            id: 'custom:a',
            name: 'Zig',
            command: 'zls',
            args: ['--stdio', '--log level'],
            env: { ZLS_LOG: '1', EMPTY: '' },
            languages: ['zig'],
            patterns: ['*.zon', 'src/*.{zig,zon}'],
            initializationOptions: { snippets: true },
            projects: ['/work/a']
        });
    });

    test('leaves out what was not filled in, and the id of a server that is new', () => {
        const input = inputOf({ ...emptyDraft(), name: ' Zig ', command: ' zls ', languages: 'zig' });
        expect(input).toEqual({ name: 'Zig', command: 'zls', args: [], env: {}, languages: ['zig'], patterns: [] });
    });

    test('names the first problem in the order the dialog reads', () => {
        const ok = { ...emptyDraft(), name: 'Zig', command: 'zls', languages: 'zig' };
        expect(problemOf(emptyDraft())).toBe('name');
        expect(problemOf({ ...ok, name: ' ' })).toBe('name');
        expect(problemOf({ ...ok, command: '' })).toBe('command');
        expect(problemOf({ ...ok, languages: '' })).toBe('serves');
        expect(problemOf({ ...ok, patterns: '*.{a,b' })).toBe('pattern');
        expect(problemOf({ ...ok, env: 'NOEQUALS' })).toBe('env');
        expect(problemOf({ ...ok, options: '{ nope' })).toBe('options');
        expect(problemOf({ ...ok, scope: 'some' })).toBe('projects');
        expect(problemOf({ ...ok, scope: 'some', projects: ['/work/a'] })).toBeNull();
        expect(problemOf(ok)).toBeNull();
    });

    test('splits arguments by line and keeps their spaces, languages by anything that separates words, and an environment by its first equals sign', () => {
        expect(parseArgs('--a\n\n--b c\r\n')).toEqual(['--a', '--b c']);
        expect(parseLanguages('zig, toml  go\nlua')).toEqual(['zig', 'toml', 'go', 'lua']);
        expect(parseEnv('A=b=c\n\nB=')).toEqual({ A: 'b=c', B: '' });
        expect(parseEnv('=x')).toBeNull();
        expect(parseEnv('A B=c')).toBeNull();
    });
});
