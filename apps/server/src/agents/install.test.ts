import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_EVENTS } from './hooks.ts';
import {
    ANTIGRAVITY_RULES,
    CODEX_RULES,
    HOOK_MARKER,
    HookFileRefused,
    defaultCodexRulesPath,
    hookCommand,
    installCodexRules,
    installHooks,
    installInFolder,
    mergeHooks
} from './install.ts';

const other = { type: 'command', command: 'echo other' };

describe('hookCommand', () => {
    test('posts to the kind, prints the daemon reply and nothing else, and never fails the CLI', () => {
        const command = hookCommand('claude');
        expect(command).toContain('"$RUIMTE_HOOK_URL/claude"');
        expect(command).toContain('Bearer $RUIMTE_HOOK_TOKEN');
        // The reply body is the hook's stdout, so a 200 with additionalContext reaches Claude Code; -f keeps error pages out of it.
        expect(command).toContain('curl -sf ');
        expect(command).not.toContain('-o /dev/null');
        expect(command.endsWith('; exit 0')).toBe(true);
        expect(hookCommand('codex')).toContain('"$RUIMTE_HOOK_URL/codex"');
    });

    test('gives up quickly, so a daemon that is gone never holds the CLI', () => {
        expect(hookCommand('claude')).toContain('curl -sf -m 2 ');
    });
});

describe('mergeHooks', () => {
    test('adds one hook per event to an empty config', () => {
        const { config, changed } = mergeHooks({}, 'claude');
        expect(changed).toBe(true);
        const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
        expect(Object.keys(hooks).sort()).toEqual([...(HOOK_EVENTS.claude ?? [])].sort());
        expect(hooks.Stop).toHaveLength(1);
        expect(hooks.Stop[0]?.hooks[0]?.command).toBe(hookCommand('claude'));
    });

    test('keeps other tools and other keys, and is a no-op the second time', () => {
        const existing = {
            permissions: { allow: ['Bash(ls:*)'] },
            hooks: { Stop: [{ matcher: '', hooks: [other] }], FileChanged: [{ matcher: '.env', hooks: [other] }] }
        };
        const first = mergeHooks(existing, 'claude');
        expect(first.changed).toBe(true);
        expect(first.config.permissions).toEqual(existing.permissions);
        const hooks = first.config.hooks as Record<string, Array<{ hooks: unknown[] }>>;
        expect(hooks.Stop).toHaveLength(2);
        expect(hooks.Stop[0]?.hooks).toEqual([other]);
        expect(hooks.FileChanged).toEqual(existing.hooks.FileChanged);

        const second = mergeHooks(first.config, 'claude');
        expect(second.changed).toBe(false);
        expect(second.config).toEqual(first.config);
    });

    test('replaces an older Ruimte hook in place and drops a duplicate', () => {
        const old = { type: 'command', command: `curl "$${HOOK_MARKER}"`, timeout: 1 };
        const existing = { hooks: { Stop: [{ hooks: [other, old] }, { hooks: [old] }] } };
        const { config, changed } = mergeHooks(existing, 'claude');
        expect(changed).toBe(true);
        const stop = (config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).Stop;
        expect(stop).toHaveLength(1);
        expect(stop[0]?.hooks.map((h) => h.command)).toEqual(['echo other', hookCommand('claude')]);
    });

    test('rewrites a permission hook that still waits for a person to the quick one', () => {
        const held = { type: 'command', command: hookCommand('claude').replace('-m 2 ', '-m 120 '), timeout: 125 };
        const { config, changed } = mergeHooks({ hooks: { PermissionRequest: [{ matcher: '', hooks: [held] }] } }, 'claude');
        const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ type: string; command: string; timeout: number }> }>>;
        expect(changed).toBe(true);
        expect(hooks.PermissionRequest[0]?.hooks).toEqual([{ type: 'command', command: hookCommand('claude'), timeout: 3 }]);
    });

    test('removes our hook from an event the daemon no longer listens for', () => {
        const ours = { type: 'command', command: hookCommand('claude'), timeout: 3 };
        const { config } = mergeHooks({ hooks: { PreModelSwitch: [{ hooks: [ours] }] } }, 'claude');
        expect((config.hooks as Record<string, unknown>).PreModelSwitch).toBeUndefined();
    });
});

describe('installHooks', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ruimte-hooks-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('creates the file, then leaves it untouched', async () => {
        const path = join(dir, 'nested', 'hooks.json');
        expect(await installHooks(path, 'codex')).toEqual({ result: 'written', createdFile: true, createdHooksKey: true });
        const written = await readFile(path, 'utf8');
        expect(written.endsWith('\n')).toBe(true);
        expect(await installHooks(path, 'codex')).toEqual({ result: 'unchanged', createdFile: false, createdHooksKey: false });
        expect(await readFile(path, 'utf8')).toBe(written);
    });

    test('refuses to overwrite a file that is not JSON', async () => {
        const path = join(dir, 'settings.json');
        await writeFile(path, '{ not json');
        await expect(installHooks(path, 'claude')).rejects.toThrow('Cannot read');
        expect(await readFile(path, 'utf8')).toBe('{ not json');
    });

    test.each([['[]'], ['null'], ['"x"'], ['{ "hooks": [] }'], ['{ "hooks": { "Stop": {} } }']])('leaves %s alone, byte for byte', async (content) => {
        const path = join(dir, 'settings.json');
        await writeFile(path, content);
        const before = await readFile(path);

        await expect(installHooks(path, 'claude')).rejects.toBeInstanceOf(HookFileRefused);

        expect((await readFile(path)).equals(before)).toBe(true);
    });

    test('says a file that already had a hooks key did not get it from us', async () => {
        const path = join(dir, 'settings.json');
        await writeFile(path, '{ "hooks": {} }');

        expect(await installHooks(path, 'claude')).toEqual({ result: 'written', createdFile: false, createdHooksKey: false });
    });

    test('two installs at once leave one valid file with one hook per event', async () => {
        const path = join(dir, 'settings.json');
        await writeFile(path, '{ "model": "opus" }');

        await Promise.all([installHooks(path, 'claude'), installHooks(path, 'claude')]);

        const written = JSON.parse(await readFile(path, 'utf8'));
        expect(written.model).toBe('opus');
        expect(Object.values(written.hooks).every((groups) => (groups as unknown[]).length === 1)).toBe(true);
    });

    test('writes through a symlink and keeps the link and the mode', async () => {
        await mkdir(join(dir, 'dotfiles'));
        const target = join(dir, 'dotfiles', 'settings.json');
        await writeFile(target, '{ "model": "opus" }\n');
        await chmod(target, 0o600);
        const link = join(dir, 'settings.json');
        await symlink(join('dotfiles', 'settings.json'), link);

        expect(await installHooks(link, 'claude')).toEqual({ result: 'written', createdFile: false, createdHooksKey: true });
        expect((await lstat(link)).isSymbolicLink()).toBe(true);
        if (process.platform !== 'win32') {
            expect((await stat(target)).mode & 0o777).toBe(0o600);
        }
        const written = JSON.parse(await readFile(target, 'utf8'));
        expect(written.model).toBe('opus');
        expect(JSON.stringify(written.hooks)).toContain(HOOK_MARKER);
    });
});

describe('installCodexRules', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ruimte-rules-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('writes a file of its own beside the rules of a person, then leaves it untouched', async () => {
        const rules = join(dir, 'rules');
        const theirs = join(rules, 'default.rules');
        await installCodexRules(join(rules, 'ruimte.rules'));
        await writeFile(theirs, 'prefix_rule(pattern=["git", "add"], decision="allow")\n');
        expect(await installCodexRules(join(rules, 'ruimte.rules'))).toBe('unchanged');
        expect(await readFile(join(rules, 'ruimte.rules'), 'utf8')).toBe(CODEX_RULES);
        expect(await readFile(theirs, 'utf8')).toContain('"git", "add"');
    });

    test('rewrites a file that drifted', async () => {
        const path = join(dir, 'ruimte.rules');
        await writeFile(path, 'prefix_rule(pattern=["rm"], decision="allow")\n');
        expect(await installCodexRules(path)).toBe('written');
        expect(await readFile(path, 'utf8')).toBe(CODEX_RULES);
    });

    test('lands in the rules folder of CODEX_HOME', () => {
        expect(defaultCodexRulesPath({ CODEX_HOME: '/x/codex', HOME: '/home/a' })).toBe(join('/x/codex', 'rules', 'ruimte.rules'));
        expect(defaultCodexRulesPath({ HOME: '/home/a', USERPROFILE: '/home/a' })).toBe(join('/home/a', '.codex', 'rules', 'ruimte.rules'));
    });
});

describe('installInFolder', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ruimte-folder-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('puts the hooks of Claude Code in the settings of that folder', async () => {
        expect(await installInFolder('claude', dir)).toEqual([
            { path: join(dir, 'settings.json'), kind: 'hooks', result: 'written', createdFile: true, createdHooksKey: true }
        ]);
        expect(await readFile(join(dir, 'settings.json'), 'utf8')).toContain(HOOK_MARKER);
        expect(await installInFolder('claude', dir)).toEqual([
            { path: join(dir, 'settings.json'), kind: 'hooks', result: 'unchanged', createdFile: false, createdHooksKey: false }
        ]);
    });

    test('gives a Codex folder its hooks and the rule', async () => {
        expect(await installInFolder('codex', dir)).toEqual([
            { path: join(dir, 'hooks.json'), kind: 'hooks', result: 'written', createdFile: true, createdHooksKey: true },
            { path: join(dir, 'rules', 'ruimte.rules'), kind: 'rules', result: 'written', createdFile: true, createdHooksKey: false }
        ]);
        expect(await readFile(join(dir, 'rules', 'ruimte.rules'), 'utf8')).toBe(CODEX_RULES);
    });

    test('gives an Antigravity folder only the rule, in the settings of agy', async () => {
        const settings = join(dir, 'antigravity-cli', 'settings.json');
        expect(await installInFolder('antigravity', dir)).toEqual([
            { path: settings, kind: 'rules', result: 'written', createdFile: true, createdHooksKey: true }
        ]);
        expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ permissions: { allow: [...ANTIGRAVITY_RULES] } });
    });

    test('writes nothing for a CLI whose settings the daemon cannot wire', async () => {
        expect(await installInFolder('grok', dir)).toEqual([]);
    });
});
