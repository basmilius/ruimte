import { describe, expect, test } from 'bun:test';
import type { TextModelChoice } from '@ruimte/contracts';
import { ModelCatalog, type AccountLaunches, type ChatProvider } from '@adecore/agents/providers';
import { ProviderRegistry, providerFor } from '../providers/registry.ts';
import { ShortTextModels } from './model.ts';
import type { OnDeviceModel } from '../ondevice/model.ts';
import type { StreamOptions } from '../git/run.ts';
import { Dispatcher } from '../dispatcher.ts';
import { registerGitHandlers } from '../handlers/git.ts';
import type { ServerFrame } from '@ruimte/contracts';

function harness(initial: TextModelChoice | null = null) {
    let choice = initial;
    let installed = true;
    let enabled = true;
    let available = true;
    const launches: string[] = [];
    const envAccounts: (string | undefined)[] = [];
    const calls: { command: string; args: string[]; cwd: string; options: StreamOptions }[] = [];
    const completions: Parameters<OnDeviceModel['complete']>[0][] = [];
    const catalog = new ModelCatalog({
        defaultModel: 'small',
        profiles: { small: { options: [], contextWindowTokens: {} } },
        models: [{ slug: 'small', name: 'Small', profile: 'small' }]
    });
    const providers = new ProviderRegistry({
        providers: ['claude', 'codex', 'grok', 'copilot', 'antigravity', 'apple'].map((kind) => ({
            ...providerFor(kind),
            catalog,
            enabled: () => enabled
        })) as ChatProvider[],
        detect: async () => ({ installed, version: null })
    });
    const accounts: AccountLaunches = {
        envFor: (_kind, account) => {
            envAccounts.push(account);

            if (account === 'disabled') {
                throw new Error('Account is disabled');
            }

            return { TEXT_ACCOUNT: account, UNSET_VALUE: undefined };
        },
        defaultFor: () => 'first-enabled',
        launched: (kind, account) => launches.push(`${kind}/${account}`),
        transcriptFolder: () => null,
        homeFolder: () => null,
        labelOf: (id) => id,
        canContinue: () => false
    };
    const models = new ShortTextModels({
        choice: () => choice,
        now: () => 1,
        appleEnabled: () => enabled,
        providers,
        accounts,
        cwdFor: async () => '/isolated-input',
        apple: () => ({
            status: async () => ({ available, reason: 'Apple unavailable here' }),
            complete: async (request, signal) => {
                completions.push(request);

                return { state: signal?.aborted ? 'aborted' : 'done', text: '{"title":"Chosen title"}' };
            }
        }),
        run: async (command, args, cwd, _timeout, options = {}) => {
            calls.push({ command, args, cwd, options });
            options.onSpawn?.(() => undefined);

            return { code: 0, stdout: args[0] === 'models' ? 'small\\tSmall\nother\tOther model\n' : '{"subject":"A message","body":""}', stderr: '' };
        }
    });

    return {
        models,
        calls,
        launches,
        envAccounts,
        completions,
        pick: (next: TextModelChoice | null) => {
            choice = next;
        },
        unavailable: () => {
            installed = false;
            available = false;
        },
        disable: () => {
            enabled = false;
        }
    };
}

describe('the machine choice of short-text writer', () => {
    for (const type of ['git.suggestMessage', 'git.resolveAi'] as const) {
        test(`${type} refuses an older client's stale provider before reading its checkout`, async () => {
            const run = harness({ provider: 'apple', model: null });
            const dispatcher = new Dispatcher();
            registerGitHandlers(
                dispatcher,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                run.models
            );
            const frames: ServerFrame[] = [];
            await dispatcher.handle(
                { id: 'phone', send: (frame) => frames.push(frame) },
                JSON.stringify({
                    id: 'request',
                    type,
                    payload: { cwd: '/never-read', actionId: 'action', provider: 'claude', ...(type === 'git.resolveAi' ? { path: 'file.ts' } : {}) }
                })
            );
            expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'git-failed' } });
            const answer = frames.at(-1);
            expect(answer && 'error' in answer && answer.error.message).toContain('setting changed');
            expect(run.calls).toEqual([]);
            expect(run.completions).toEqual([]);
        });
    }

    test('Automatic leaves provider hints and legacy selection to the existing callers', async () => {
        const run = harness();
        expect(await run.models.prepare('codex')).toBeNull();
        expect(run.calls).toEqual([]);
        expect(run.envAccounts).toEqual([]);
    });

    test('a changed provider hint is refused, and a matching older-client hint retains the full Apple choice', async () => {
        const run = harness({ provider: 'apple', model: null });
        await expect(run.models.prepare('claude')).rejects.toThrow('setting changed');
        const writer = await run.models.prepare('apple');
        expect(writer?.provider.kind).toBe('apple');
        expect(await writer!.run('/project', 'Name this conversation', 500)).toMatchObject({ code: 0 });
        expect(run.completions).toHaveLength(1);
        expect(run.calls).toEqual([]);
    });

    for (const provider of ['claude', 'codex', 'grok', 'copilot', 'antigravity'] as const) {
        test(`${provider} receives the chosen model, account environment and isolated folder without a chat`, async () => {
            const run = harness({ provider, model: 'small', account: 'work' });
            const writer = await run.models.prepare(provider);
            expect(run.launches).toEqual([]);
            await writer!.run('/project', 'Private patch', 500);
            const called = run.calls.at(-1)!;
            const modelAt = called.args.indexOf('--model');
            expect(called.args.slice(modelAt, modelAt + 2)).toEqual(['--model', 'small']);
            expect(called.options.env).toEqual({ TEXT_ACCOUNT: 'work' });
            expect(called.cwd).toBe('/isolated-input');
            expect(run.launches).toEqual([`${provider}/work`]);

            if (provider === 'claude' || provider === 'codex' || provider === 'copilot') {
                expect(called.options.stdin).toBe('Private patch');
                expect(called.args).not.toContain('Private patch');
            }

            if (provider === 'codex') {
                expect(called.args.at(-1)).toBe('-');
                expect(called.args).toContain('read-only');
            }
        });
    }

    test('Antigravity validates print-mode ids and caches its free catalog per account', async () => {
        const run = harness({ provider: 'antigravity', model: 'other', account: 'work' });
        expect(await run.models.modelsFor({ provider: 'antigravity', account: 'work' })).toEqual([
            { slug: 'small', name: 'Small' },
            { slug: 'other', name: 'Other model' }
        ]);
        await run.models.prepare();
        expect(run.calls).toHaveLength(1);
        await run.models.modelsFor({ provider: 'antigravity', account: 'personal' });
        expect(run.calls).toHaveLength(2);
        expect(run.envAccounts).toContain('personal');
        expect(run.launches).toEqual([]);
        run.pick({ provider: 'antigravity', model: 'chat-only' });
        await expect(run.models.prepare()).rejects.toThrow('no longer available');
    });

    test('the CLI default omits the model flag and follows the first enabled account', async () => {
        const run = harness({ provider: 'claude', model: null });
        await (await run.models.prepare())!.run('/project', 'A patch', 500);
        expect(run.calls[0]!.args).not.toContain('--model');
        expect(run.envAccounts).toEqual(['first-enabled']);
    });

    test('missing models, disabled accounts and providers refuse before any launch', async () => {
        const run = harness({ provider: 'claude', model: 'removed' });
        await expect(run.models.prepare()).rejects.toThrow('no longer available');
        run.pick({ provider: 'claude', model: null, account: 'disabled' });
        await expect(run.models.prepare()).rejects.toThrow('Account is disabled');
        run.pick({ provider: 'claude', model: null });
        run.disable();
        await expect(run.models.prepare()).rejects.toThrow('not enabled');
        expect(run.calls).toEqual([]);
    });

    test('an absent print executable refuses rather than choosing another provider', async () => {
        const run = harness({ provider: 'claude', model: null });
        run.unavailable();
        await expect(run.models.prepare()).rejects.toThrow('cannot write short texts');
        expect(run.calls).toEqual([]);
    });

    test('Apple refuses oversize input, cancellation stays local and title requests have background priority', async () => {
        const run = harness({ provider: 'apple', model: null });
        const writer = await run.models.prepare(undefined, 'title');
        await expect(writer!.run('/project', 'x'.repeat(6001), 500)).rejects.toThrow('too large for the on-device model');
        expect(run.completions).toEqual([]);
        const result = await writer!.run('/project', 'Name this chat', 500, (cancel) => cancel());
        expect(result.code).toBe(1);
        expect(run.completions[0]).toMatchObject({ background: true, maxTokens: 128, prompt: 'Name this chat' });
        expect(run.calls).toEqual([]);
        run.unavailable();
        await expect(run.models.prepare()).rejects.toThrow('Apple unavailable here');
    });
});
