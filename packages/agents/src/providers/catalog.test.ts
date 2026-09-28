import { describe, expect, test } from 'bun:test';
import { ModelCatalogDataSchema, type ModelCatalogData } from '@ruimte/agent-contracts';
import { ModelCatalog } from './catalog.ts';
import { claudeArgs, claudeEnv, promptPrefix } from './claude.ts';
import claudeManifest from './claude-models.json' with { type: 'json' };
import codexManifest from './codex-models.json' with { type: 'json' };

const catalog = new ModelCatalog();

describe('ModelCatalog', () => {
    test('lists models with their options and one default', () => {
        const models = catalog.list();
        expect(models.filter((model) => model.isDefault).map((model) => model.slug)).toEqual(['claude-sonnet-5-5']);
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
        expect(catalog.normalize({ model: 'nope' }).model).toBe('claude-sonnet-5-5');
        expect(catalog.normalize(undefined)).toEqual({ model: 'claude-sonnet-5-5', options: { effort: 'high', contextWindow: '200k' } });
        expect(catalog.normalize({ model: 'sonnet', options: { effort: 'wrong' } }).options.effort).toBe('high');
    });

    test('context window follows the option or the fixed size', () => {
        expect(catalog.contextWindowFor(catalog.normalize({ model: 'sonnet' }))).toBe(200000);
        expect(catalog.contextWindowFor(catalog.normalize({ model: 'sonnet', options: { contextWindow: '1m' } }))).toBe(1000000);
        expect(catalog.contextWindowFor(catalog.normalize({ model: 'haiku' }))).toBe(200000);
    });
});

describe('a catalog swapped in while the host runs', () => {
    const shipped = ModelCatalogDataSchema.parse(claudeManifest);
    const withModel = (updatedAt: string): ModelCatalogData => ({
        ...shipped,
        updatedAt,
        models: [...shipped.models, { slug: 'claude-next', name: 'Claude Next', profile: 'sonnet' }]
    });

    test('both shipped manifests are catalogs a service may hand out', () => {
        expect(ModelCatalogDataSchema.safeParse(claudeManifest).success).toBe(true);
        expect(ModelCatalogDataSchema.safeParse(codexManifest).success).toBe(true);
    });

    test('takes a newer copy and says the models changed', () => {
        const live = new ModelCatalog();
        expect(live.replace(withModel('2099-01-01T00:00:00Z'))).toBe(true);
        expect(live.resolveModel('claude-next')).toBe('claude-next');
        expect(live.replace(withModel('2099-01-01T00:00:00Z'))).toBe(false);
    });

    test('never goes back behind the copy it shipped with', () => {
        const live = new ModelCatalog();
        expect(live.replace(withModel('2000-01-01T00:00:00Z'))).toBe(false);
        expect(live.resolveModel('claude-next')).toBeNull();
    });

    test('refuses a slug that would read as a flag on the command line', () => {
        const bad = { ...shipped, models: [...shipped.models, { slug: '--dangerously-skip-permissions', name: 'x', profile: 'sonnet' }] };
        expect(ModelCatalogDataSchema.safeParse(bad).success).toBe(false);
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

    test('a 200k pick turns auto-compact on, in the one settings blob it shares with fast mode', () => {
        const settingsOf = (options: Record<string, string | boolean>): string | undefined => {
            const args = claudeArgs({ selection: { model: 'claude-opus-5-5', options }, runtimeMode: 'auto', resume: null });
            expect(args.filter((arg) => arg === '--settings').length).toBeLessThanOrEqual(1);
            return args.includes('--settings') ? args[args.indexOf('--settings') + 1] : undefined;
        };
        expect(settingsOf({ contextWindow: '200k' })).toBe('{"autoCompactEnabled":true}');
        expect(settingsOf({ contextWindow: '200k', fastMode: true })).toBe('{"fastMode":true,"autoCompactEnabled":true}');
        expect(settingsOf({ contextWindow: '1m' })).toBeUndefined();
    });

    test('every mode lets the allowed tools through without a prompt, each in the form that swallows no argument', () => {
        const selection = { model: 'claude-sonnet-5', options: {} };
        for (const runtimeMode of ['supervised', 'auto-accept-edits', 'auto', 'full-access'] as const) {
            expect(claudeArgs({ selection, runtimeMode, resume: null, allowedTools: ['Bash(tool *)'] })).toContain('--allowedTools=Bash(tool *)');
        }
        expect(claudeArgs({ selection, runtimeMode: 'auto', resume: null }).some((arg) => arg.startsWith('--allowedTools'))).toBe(false);
    });

    test('adds each folder in the form that swallows no argument', () => {
        const selection = { model: 'claude-sonnet-5', options: {} };
        const args = claudeArgs({ selection, runtimeMode: 'auto', resume: null, folders: ['/brand/kit', '/shared/assets'] });
        expect(args.filter((arg) => arg.startsWith('--add-dir'))).toEqual(['--add-dir=/brand/kit', '--add-dir=/shared/assets']);
        expect(claudeArgs({ selection, runtimeMode: 'auto', resume: null }).some((arg) => arg.startsWith('--add-dir'))).toBe(false);
    });
});
