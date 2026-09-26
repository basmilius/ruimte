import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexRulesPathIn, codexRulesText, defaultCodexHome, installCodexRules } from './codex-rules.ts';

const rules = { app: 'AfterMotion', commands: ['aftermotion-context'] };

describe('codexRulesText', () => {
    test('allows each command by its first word', () => {
        expect(codexRulesText(rules)).toBe(
            '# Written by AfterMotion; it is rewritten when it changes.\nprefix_rule(pattern=["aftermotion-context"], decision="allow")\n'
        );
    });

    test('writes what Ruimte always wrote', () => {
        expect(codexRulesText({ app: 'Ruimte', commands: ['ruimte-context'] })).toBe(
            '# Written by Ruimte; it is rewritten when it changes.\nprefix_rule(pattern=["ruimte-context"], decision="allow")\n'
        );
    });
});

describe('codexRulesPathIn', () => {
    test('names the file after the app, in the rules folder of a Codex home', () => {
        expect(codexRulesPathIn('/home/a/.codex', rules)).toBe('/home/a/.codex/rules/aftermotion.rules');
        expect(codexRulesPathIn('/home/a/.codex', { app: 'My App', commands: [] })).toBe('/home/a/.codex/rules/my-app.rules');
    });

    test('finds the home in CODEX_HOME before HOME', () => {
        expect(defaultCodexHome({ CODEX_HOME: '/x/codex', HOME: '/home/a' })).toBe('/x/codex');
        expect(defaultCodexHome({ HOME: '/home/a' })).toBe('/home/a/.codex');
    });
});

describe('installCodexRules', () => {
    let dir = '';

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'codex-rules-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('writes once and then leaves the file alone', async () => {
        const path = codexRulesPathIn(dir, rules);
        expect(await installCodexRules(path, rules)).toBe('written');
        expect(await installCodexRules(path, rules)).toBe('unchanged');
        expect(await readFile(path, 'utf8')).toBe(codexRulesText(rules));
    });

    test('rewrites a file that drifted', async () => {
        const path = codexRulesPathIn(dir, rules);
        await installCodexRules(path, rules);
        await writeFile(path, 'prefix_rule(pattern=["rm"], decision="allow")\n');
        expect(await installCodexRules(path, rules)).toBe('written');
        expect(await readFile(path, 'utf8')).toBe(codexRulesText(rules));
    });
});
