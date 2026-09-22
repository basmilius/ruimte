import { describe, expect, test } from 'bun:test';
import { ModelCatalog } from './catalog.ts';
import { CLAUDE_ALLOW_CONTEXT, claudeArgs, claudeEnv, promptPrefix } from './claude.ts';

const catalog = new ModelCatalog();

describe('ModelCatalog', () => {
    test('lists models with their options and one default', () => {
        const models = catalog.list();
        expect(models.filter((model) => model.isDefault).map((model) => model.slug)).toEqual(['claude-sonnet-5']);
        expect(models.find((model) => model.slug === 'claude-fable-5-1')?.options.map((option) => option.id)).toEqual(['effort', 'contextWindow']);
        expect(models.find((model) => model.slug === 'claude-haiku-4-5')?.options[0]).toMatchObject({ type: 'boolean', defaultValue: true });
    });

    test('fast mode is an option of the models that offer it, off by default', () => {
        const options = (slug: string) => catalog.list().find((model) => model.slug === slug)?.options ?? [];
        expect(options('claude-opus-5').find((option) => option.id === 'fastMode')).toMatchObject({ type: 'boolean', defaultValue: false });
        expect(options('claude-sonnet-5').some((option) => option.id === 'fastMode')).toBe(false);
        expect(catalog.normalize({ model: 'opus' }).options.fastMode).toBe(false);
        expect(catalog.normalize({ model: 'sonnet', options: { fastMode: true } }).options.fastMode).toBeUndefined();
    });

    test('normalize resolves aliases, fills defaults and drops unknown options', () => {
        expect(catalog.normalize({ model: 'opus', options: { effort: 'max', bogus: 'x' } })).toEqual({
            model: 'claude-opus-5-5',
            options: { effort: 'max', contextWindow: '1m', fastMode: false }
        });
        expect(catalog.normalize({ model: 'nope' }).model).toBe('claude-sonnet-5');
        expect(catalog.normalize(undefined)).toEqual({ model: 'claude-sonnet-5', options: { effort: 'high', contextWindow: '200k' } });
        expect(catalog.normalize({ model: 'sonnet', options: { effort: 'wrong' } }).options.effort).toBe('high');
    });

    test('context window follows the option or the fixed size', () => {
        expect(catalog.contextWindowFor(catalog.normalize({ model: 'sonnet' }))).toBe(200000);
        expect(catalog.contextWindowFor(catalog.normalize({ model: 'sonnet', options: { contextWindow: '1m' } }))).toBe(1000000);
        expect(catalog.contextWindowFor(catalog.normalize({ model: 'haiku' }))).toBe(200000);
    });
});

describe('claudeArgs', () => {
    test('maps the selection and the modes to flags', () => {
        const args = claudeArgs({
            selection: { model: 'claude-opus-5', options: { effort: 'xhigh', contextWindow: '1m' } },
            runtimeMode: 'full-access',
            resume: 'abc'
        });
        expect(args.slice(args.indexOf('--model'))).toEqual([
            '--model',
            'claude-opus-5[1m]',
            '--effort',
            'xhigh',
            '--permission-mode',
            'bypassPermissions',
            '--allow-dangerously-skip-permissions',
            '--resume',
            'abc'
        ]);
    });

    test('fast mode travels as the settings blob the CLI opts in with', () => {
        const selection = { model: 'claude-opus-5', options: { effort: 'high', contextWindow: '1m', fastMode: true } };
        const args = claudeArgs({ selection, runtimeMode: 'auto', resume: null });
        expect(args.slice(args.indexOf('--settings'), args.indexOf('--settings') + 2)).toEqual(['--settings', '{"fastMode":true}']);
        expect(
            claudeArgs({ selection: { ...selection, options: { ...selection.options, fastMode: false } }, runtimeMode: 'auto', resume: null })
        ).not.toContain('--settings');
    });

    test('supervised has no permission flag and ultrathink goes into the prompt', () => {
        const selection = { model: 'claude-sonnet-5', options: { effort: 'ultrathink', contextWindow: '200k' } };
        const supervised = claudeArgs({ selection, runtimeMode: 'supervised', resume: null });
        expect(supervised).not.toContain('--permission-mode');
        expect(supervised).not.toContain('--effort');
        expect(promptPrefix(selection)).toBe('ultrathink\n\n');
        expect(promptPrefix({ model: 'x', options: { effort: 'high' } })).toBe('');
    });

    test('a 200k pick caps the compact window, since leaving out [1m] does not on a native 1M model', () => {
        expect(claudeEnv({ model: 'claude-fable-5-1', options: { contextWindow: '200k' } })).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000' });
        expect(claudeEnv({ model: 'claude-fable-5-1', options: { contextWindow: '1m' } })).toEqual({});
        expect(claudeEnv({ model: 'claude-haiku-4-5', options: { thinking: true } })).toEqual({});
    });

    test('every mode lets ruimte-context through without a prompt', () => {
        const selection = { model: 'claude-sonnet-5', options: {} };
        for (const runtimeMode of ['supervised', 'auto-accept-edits', 'auto', 'full-access'] as const) {
            expect(claudeArgs({ selection, runtimeMode, resume: null })).toContain(CLAUDE_ALLOW_CONTEXT);
        }
    });
});
