import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_EVENTS } from './hooks.ts';
import { HOOK_MARKER, hookCommand, installHooks, mergeHooks } from './install.ts';

const other = { type: 'command', command: 'echo other' };

describe('mergeHooks', () => {
    test('adds one hook per event to an empty config', () => {
        const { config, changed } = mergeHooks({}, 'claude');
        expect(changed).toBe(true);
        const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
        expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS.claude].sort());
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

    test('removes our hook from an event the daemon no longer listens for', () => {
        const ours = { type: 'command', command: hookCommand('claude'), timeout: 5 };
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
        expect(await installHooks(path, 'codex')).toBe('written');
        const written = await readFile(path, 'utf8');
        expect(written.endsWith('\n')).toBe(true);
        expect(await installHooks(path, 'codex')).toBe('unchanged');
        expect(await readFile(path, 'utf8')).toBe(written);
    });

    test('refuses to overwrite a file that is not JSON', async () => {
        const path = join(dir, 'settings.json');
        await writeFile(path, '{ not json');
        await expect(installHooks(path, 'claude')).rejects.toThrow('Cannot read');
        expect(await readFile(path, 'utf8')).toBe('{ not json');
    });
});
