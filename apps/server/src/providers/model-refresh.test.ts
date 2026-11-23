import { expect, test } from 'bun:test';
import type { ChatProvider, ModelRefresh } from '@adecore/agents/providers';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { MODEL_REFRESH_MAX_AGE_MS, refreshAgentModels } from './model-refresh.ts';

interface Asked {
    kind: AgentKind;
    command: readonly string[];
    env: Record<string, string | undefined>;
    refresh: ModelRefresh;
}

function agent(kind: AgentKind, asked: Asked[], extra: Partial<ChatProvider> = {}): ChatProvider {
    return {
        kind,
        name: kind,
        command: [`${kind}-server`],
        refreshModels: async (command, env, refresh) => {
            asked.push({ kind, command, env, refresh });

            return true;
        },
        ...extra
    } as ChatProvider;
}

function registry(agents: ChatProvider[], installed: readonly AgentKind[], disabled: readonly AgentKind[] = []) {
    return {
        list: async () => agents.map((provider) => ({ kind: provider.kind, installed: installed.includes(provider.kind) }) as ProviderInfo),
        get: (kind: AgentKind) => agents.find((provider) => provider.kind === kind)!,
        enabled: (kind: AgentKind) => !disabled.includes(kind)
    };
}

const accounts = { envFor: (kind: AgentKind, _id: undefined, base: Record<string, string | undefined>) => ({ ...base, ACCOUNT_OF: kind }) };

test('asks each installed, enabled agent in its default account, with a day as the age it allows', async () => {
    const asked: Asked[] = [];
    const agents = [agent('antigravity', asked), agent('example', asked), agent('off', asked)];

    await refreshAgentModels(registry(agents, ['antigravity', 'off'], ['off']), accounts, { PATH: '/bin' });

    expect(asked).toEqual([
        {
            kind: 'antigravity',
            command: ['antigravity-server'],
            env: { PATH: '/bin', ACCOUNT_OF: 'antigravity' },
            refresh: { maxAgeMs: MODEL_REFRESH_MAX_AGE_MS }
        }
    ]);
});

test('leaves an agent whose account check already opens a session, and one that cannot refresh', async () => {
    const asked: Asked[] = [];
    const checked = agent('copilot', asked, {
        home: { env: 'COPILOT_HOME', fallback: '.copilot', loginCommand: 'copilot login', loginEnv: [] },
        askAccount: async () => ({ signedIn: true, email: null, plan: null, organization: null })
    });
    const fixed = agent('claude', asked, { refreshModels: undefined });

    await refreshAgentModels(registry([checked, fixed], ['copilot', 'claude']), accounts, {});

    expect(asked).toEqual([]);
});

test('one agent that fails leaves the others asked and rejects nothing', async () => {
    const asked: Asked[] = [];
    const failing = agent('broken', asked, {
        refreshModels: async () => {
            throw new Error('no answer');
        }
    });

    await refreshAgentModels(registry([failing, agent('antigravity', asked)], ['broken', 'antigravity']), accounts, {});

    expect(asked.map((entry) => entry.kind)).toEqual(['antigravity']);
});
