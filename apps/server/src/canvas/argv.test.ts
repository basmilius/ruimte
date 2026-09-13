import { describe, expect, test } from 'bun:test';
import { parseArgv } from './argv.ts';

const KNOWN = ['title', 'text', 'view'];

describe('parseArgv', () => {
    test('splits positionals from flag pairs in any order', () => {
        expect(parseArgv(['--title', 'Plan', 'note', '--text', 'hello world'], KNOWN)).toEqual({
            ok: true,
            positionals: ['note'],
            flags: { title: 'Plan', text: 'hello world' }
        });
    });

    test('takes --flag=value, also for a value that starts with dashes', () => {
        expect(parseArgv(['note', '--text=--not a flag', '--view=main'], KNOWN)).toEqual({
            ok: true,
            positionals: ['note'],
            flags: { text: '--not a flag', view: 'main' }
        });
    });

    test('a single dash is a positional, not a flag', () => {
        expect(parseArgv(['-x'], KNOWN)).toEqual({ ok: true, positionals: ['-x'], flags: {} });
    });

    test('refuses an unknown flag', () => {
        expect(parseArgv(['note', '--cmd', 'rm -rf'], KNOWN)).toMatchObject({ ok: false, code: 'unknown-flag' });
        expect(parseArgv(['--view', 'main'], [])).toMatchObject({ ok: false, code: 'unknown-flag' });
    });

    test('refuses a flag without a value', () => {
        expect(parseArgv(['note', '--title'], KNOWN)).toMatchObject({ ok: false, code: 'missing-value' });
        expect(parseArgv(['note', '--title', '--text', 'x'], KNOWN)).toMatchObject({ ok: false, code: 'missing-value' });
    });

    test('refuses a flag given twice', () => {
        expect(parseArgv(['--view', 'a', '--view=b'], KNOWN)).toMatchObject({ ok: false, code: 'duplicate-flag' });
    });
});
