import { describe, expect, test } from 'bun:test';
import { hookEntry, mergeHooks } from './install.ts';
import { removeHooks } from './revoke.ts';

const theirs = { type: 'command', command: 'echo theirs' };

function installed(base: Record<string, unknown> = {}) {
    return mergeHooks(base, 'claude').config;
}

describe('removeHooks', () => {
    test('takes back what the merge added and leaves a key Ruimte created out', () => {
        const removal = removeHooks(installed(), 'claude', { createdHooksKey: true });

        expect(removal.config).toEqual({});
        expect(removal.removed).toBeGreaterThan(0);
        expect(removal.keptEdited).toBe(0);
    });

    test('keeps the hooks key when it was there before, however empty it ends up', () => {
        const removal = removeHooks(installed({ hooks: {} }), 'claude', { createdHooksKey: false });

        expect(removal.config).toEqual({ hooks: {} });
    });

    test("leaves another tool's hook, its group keys and other settings in place", () => {
        const base = { model: 'opus', hooks: { Stop: [{ matcher: 'x', hooks: [theirs] }] } };
        const removal = removeHooks(installed(base), 'claude', { createdHooksKey: false });

        expect(removal.config).toEqual(base);
    });

    test('drops the group Ruimte made but not a group with keys of its own that went empty', () => {
        const wanted = hookEntry('claude');
        const config = {
            hooks: {
                Stop: [{ hooks: [wanted] }, { matcher: 'x', hooks: [wanted] }]
            }
        };

        const removal = removeHooks(config, 'claude', { createdHooksKey: false });

        expect(removal.config).toEqual({ hooks: { Stop: [{ matcher: 'x', hooks: [] }] } });
    });

    test('a Ruimte hook with an edited timeout counts as kept and stays', () => {
        const edited = { ...hookEntry('claude'), timeout: 30 };
        const removal = removeHooks({ hooks: { Stop: [{ hooks: [edited] }] } }, 'claude', { createdHooksKey: true });

        expect(removal.removed).toBe(0);
        expect(removal.keptEdited).toBe(1);
        expect(removal.config).toEqual({ hooks: { Stop: [{ hooks: [edited] }] } });
    });

    test('refuses a root that is not an object and a hooks value that is not one', () => {
        expect(removeHooks([], 'claude', { createdHooksKey: false }).refused).toBe(true);
        expect(removeHooks({ hooks: [] }, 'claude', { createdHooksKey: false }).refused).toBe(true);
    });
});

describe('removeHooks in the files of Copilot and Antigravity', () => {
    test("takes Copilot's entries and the version it added, and keeps a person's entry with the version", () => {
        expect(removeHooks(mergeHooks({}, 'copilot').config, 'copilot', { createdHooksKey: true }).config).toEqual({});
        const person = { type: 'command', bash: 'echo theirs' };
        const removal = removeHooks(mergeHooks({ version: 1, hooks: { Stop: [person] } }, 'copilot').config, 'copilot', { createdHooksKey: false });
        expect(removal.config).toEqual({ version: 1, hooks: { Stop: [person] } });
    });

    test('an edited Copilot entry stays and is counted', () => {
        const config = mergeHooks({}, 'copilot').config as { hooks: Record<string, Array<Record<string, unknown>>> };
        config.hooks.Stop![0]!.timeoutSec = 30;
        const removal = removeHooks(config, 'copilot', { createdHooksKey: true });
        expect(removal.keptEdited).toBe(1);
        expect((removal.config.hooks as Record<string, unknown[]>).Stop).toHaveLength(1);
    });

    test("takes Antigravity's named hook and nothing beside it", () => {
        const removal = removeHooks(mergeHooks({ lint: { Stop: [theirs] } }, 'antigravity').config, 'antigravity', { createdHooksKey: true });
        expect(removal).toEqual({ config: { lint: { Stop: [theirs] } }, removed: 1, keptEdited: 0, refused: false });
        expect(hookEntry('antigravity')).toMatchObject({ type: 'command', timeout: 3 });
    });
});
