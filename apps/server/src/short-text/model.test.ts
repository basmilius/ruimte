import { describe, expect, test } from 'bun:test';
import type { TextModelChoice } from '@ruimte/contracts';
import { GitError, type GitResult, type streamWithTimeout } from '../git/run.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { ShortTextModels } from './model.ts';

type Run = Parameters<typeof streamWithTimeout>;

interface Rig {
    models: ShortTextModels;
    runs: { command: string; args: string[]; cwd: string; options: Run[4] }[];
    launched: string[];
    choose(choice: TextModelChoice | null): void;
    answer(result: Partial<GitResult>): void;
}

function rig(installed: string[], accounts: Record<string, { kind: string; enabled?: boolean }> = {}): Rig {
    const registry = new ProviderRegistry({ detect: async (command) => ({ installed: installed.includes(command), version: null }) });
    const runs: Rig['runs'] = [];
    const launched: string[] = [];
    let choice: TextModelChoice | null = null;
    let result: GitResult = { code: 0, stdout: '', stderr: '' };
    const kinds = ['claude', 'codex', 'grok', 'antigravity'];
    const known = { ...Object.fromEntries(kinds.map((kind) => [kind, { kind }])), ...accounts };

    const models = new ShortTextModels({
        choice: () => choice,
        registry,
        accounts: {
            snapshot: () => ({ accounts: known, statuses: [], secretsAvailable: false, loginCommands: {} }) as never,
            envFor: (kind, account, env) => {
                if (account !== kind && known[account ?? kind] === undefined) {
                    throw new Error(`No account ${account}`);
                }

                return { ...env, RUIMTE_SECRET: 'x', CLAUDECODE: '1', ACCOUNT_OF: `${kind}/${account}` };
            },
            launched: (kind, account) => void launched.push(`${kind}/${account}`)
        },
        cwdFor: async (folder) => `${folder}/isolated`,
        run: async (command, args, cwd, _timeout, options) => {
            runs.push({ command, args, cwd, options });
            options?.onSpawn?.(() => undefined);

            return result;
        }
    });

    return {
        models,
        runs,
        launched,
        choose: (next) => {
            choice = next;
        },
        answer: (next) => {
            result = { code: 0, stdout: '', stderr: '', ...next };
        }
    };
}

describe('Automatic', () => {
    test('prepares no writer, leaves titles to the native policy and takes the automatic title', async () => {
        const { models } = rig(['claude']);

        expect(await models.prepare()).toBeNull();
        expect(await models.prepare('codex')).toBeNull();
        expect(models.titlePolicy()).toBe('native');
        expect(await models.title({ cwd: '/work', prompt: 'p', answer: 'a' }, async () => 'Automatic title')).toBe('Automatic title');
    });
});

describe('an explicit pick', () => {
    test('runs its CLI with the chosen model, the prompt on stdin, the account environment and an isolated folder', async () => {
        const test = rig(['claude', 'codex']);
        test.choose({ provider: 'codex', model: 'gpt-6.1-sol' });

        const writer = await test.models.prepare();
        const killers: unknown[] = [];

        expect(test.models.titlePolicy()).toBe('generated');
        expect(writer?.provider.kind).toBe('codex');

        await writer?.run('/work/repo', 'the prompt', 1000, (kill) => killers.push(kill));

        const [run] = test.runs;

        expect(run?.args).toContain('--model');
        expect(run?.args[run.args.indexOf('--model') + 1]).toBe('gpt-6.1-sol');
        expect(run?.args.at(-1)).toBe('-');
        expect(run?.options?.stdin).toBe('the prompt');
        expect(run?.cwd).toBe('/work/repo/isolated');
        expect(run?.options?.env).toMatchObject({ ACCOUNT_OF: 'codex/codex' });
        expect(run?.options?.env).not.toHaveProperty('RUIMTE_SECRET');
        expect(run?.options?.env).not.toHaveProperty('CLAUDECODE');
        expect(test.launched).toEqual(['codex/codex']);
        expect(killers).toHaveLength(1);
    });

    test('takes the cheapest model of the provider when none is chosen', async () => {
        const test = rig(['claude']);
        test.choose({ provider: 'claude', model: null });

        await (await test.models.prepare())?.run('/work', 'p', 1000);

        expect(test.runs[0]?.args).toContain('claude-haiku-5-5');
    });

    test('runs under the chosen account of the same CLI', async () => {
        const test = rig(['codex'], { work: { kind: 'codex' } });
        test.choose({ provider: 'codex', model: null, account: 'work' });

        await (await test.models.prepare())?.run('/work', 'p', 1000);

        expect(test.runs[0]?.options?.env).toMatchObject({ ACCOUNT_OF: 'codex/work' });
        expect(test.launched).toEqual(['codex/work']);
    });

    test('never falls back to another provider, whether the CLI or the account is gone', async () => {
        const missingCli = rig(['claude']);
        missingCli.choose({ provider: 'codex', model: null });

        await expect(missingCli.models.prepare()).rejects.toBeInstanceOf(GitError);
        await expect(missingCli.models.prepare()).rejects.toThrow('text model of this machine is unavailable');

        const off = rig(['claude', 'codex'], { codex: { kind: 'codex', enabled: false } });
        off.choose({ provider: 'codex', model: null });

        await expect(off.models.prepare()).rejects.toBeInstanceOf(GitError);

        const unknownAccount = rig(['codex']);
        unknownAccount.choose({ provider: 'codex', model: null, account: 'gone' });

        await expect(unknownAccount.models.prepare()).rejects.toBeInstanceOf(GitError);
        expect(missingCli.runs).toEqual([]);
    });

    test('refuses a model the provider does not list and a provider that cannot write short texts', async () => {
        const test = rig(['claude']);
        test.choose({ provider: 'claude', model: 'no-such-model' });

        await expect(test.models.prepare()).rejects.toBeInstanceOf(GitError);

        test.choose({ provider: 'copilot', model: null });

        await expect(test.models.prepare()).rejects.toBeInstanceOf(GitError);
    });

    test('wins over a provider hint: a conflicting hint is refused and a matching one is the same pick', async () => {
        const test = rig(['claude', 'codex']);
        test.choose({ provider: 'codex', model: 'gpt-6.1-sol' });

        await expect(test.models.prepare('claude')).rejects.toThrow('writes short texts with');

        const writer = await test.models.prepare('codex');
        await writer?.run('/work', 'p', 1000);

        expect(test.runs[0]?.args).toContain('gpt-6.1-sol');
    });

    test('validate refuses an unusable pick with a coded error and accepts a usable one', async () => {
        const test = rig(['codex']);

        await expect(test.models.validate({ provider: 'claude', model: null })).rejects.toMatchObject({ code: 'unavailable' });
        await expect(test.models.validate({ provider: 'codex', model: null })).resolves.toBeUndefined();
    });
});

describe('a chat title', () => {
    const input = { cwd: '/work', prompt: 'Fix the login', answer: 'Done' };

    test('is written by the pick and ignores the automatic writer', async () => {
        const test = rig(['codex']);
        test.choose({ provider: 'codex', model: null });
        test.answer({ stdout: '{"title": "Fix the login"}' });

        expect(await test.models.title(input, async () => 'Automatic title')).toBe('Fix the login');
        expect(test.runs[0]?.options?.stdin).toContain('Fix the login');
    });

    test('is null, not the automatic one, when the pick cannot write or fails', async () => {
        const gone = rig(['claude']);
        gone.choose({ provider: 'codex', model: null });

        expect(await gone.models.title(input, async () => 'Automatic title')).toBeNull();

        const failing = rig(['codex']);
        failing.choose({ provider: 'codex', model: null });
        failing.answer({ code: 1, stdout: '{"title": "Never used"}' });

        expect(await failing.models.title(input, async () => 'Automatic title')).toBeNull();

        const noTitle = rig(['codex']);
        noTitle.choose({ provider: 'codex', model: null });
        noTitle.answer({ stdout: 'Sure, here you go.' });

        expect(await noTitle.models.title(input, async () => 'Automatic title')).toBeNull();
    });
});
