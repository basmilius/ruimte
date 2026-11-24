import { describe, expect, test } from 'bun:test';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import type { ChatProvider } from '@adecore/agents/providers';
import { fakeAcpWith, inProcess } from '@adecore/agents/testing';
import { ExtensionAgentProviders, type ListedAgentProvider } from './agent-providers.ts';

const INSPECTOR = {
    name: 'Beacon Inspector',
    protocol: 'acp' as const,
    spawn: { command: 'beacon-agent', args: ['acp'], env: { BEACON_MODE: 'inspect' } },
    models: [
        { id: 'inspector-fast', name: 'Fast' },
        { id: 'inspector-deep', name: 'Deep' }
    ]
};
const HELLO = { promptId: 'p1', text: 'hello', preamble: null, attachments: [], mentions: [], skills: [] };

function world(listed: ListedAgentProvider[], installed: string[] = ['beacon-agent']) {
    const offered = new Map<string, ChatProvider>();
    const log: string[] = [];
    const asked: boolean[] = [];
    const agents = new ExtensionAgentProviders({
        list: async (start) => {
            asked.push(start);

            return listed;
        },
        providers: {
            add: (provider) => {
                offered.set(provider.kind, provider);
                log.push(`add ${provider.kind}`);
            },
            remove: (kind) => {
                offered.delete(kind);
                log.push(`remove ${kind}`);
            },
            invalidate: (kind) => void log.push(`invalidate ${kind}`)
        },
        which: (command) => (installed.includes(command) ? `/usr/local/bin/${command}` : null)
    });

    return { agents, offered, log, asked, listed };
}

describe('the agents extensions describe', () => {
    test('join the providers of the machine under a kind of their own, with the name, the program and the models the extension said', async () => {
        const { agents, offered, log } = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: INSPECTOR }]);

        await agents.refresh(true);

        const provider = offered.get('x-dev-beacon-inspector');

        expect(log).toEqual(['add x-dev-beacon-inspector', 'invalidate x-dev-beacon-inspector']);
        expect([provider?.name, provider?.command]).toEqual(['Beacon Inspector', ['beacon-agent', 'acp']]);
        expect(provider?.catalog.list().map((model) => [model.slug, model.name])).toEqual([
            ['inspector-fast', 'Fast'],
            ['inspector-deep', 'Deep']
        ]);
        expect(provider?.catalog.defaultModel).toBe('inspector-fast');
    });

    test('are found on the disk and never started to ask: no account and no model is asked of the program', async () => {
        const there = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: INSPECTOR }]);
        const gone = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: INSPECTOR }], []);

        await there.agents.refresh(true);
        await gone.agents.refresh(true);

        const provider = there.offered.get('x-dev-beacon-inspector');

        expect(await provider?.detect('beacon-agent', {})).toEqual({ installed: true, version: '0.1.0' });
        expect(await gone.offered.get('x-dev-beacon-inspector')?.detect('beacon-agent', {})).toEqual({ installed: false, version: '0.1.0' });
        expect([provider?.askAccount, provider?.refreshModels]).toEqual([undefined, undefined]);
    });

    test('offer one entry, Default, for an agent that names no models', async () => {
        const { agents, offered } = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: { ...INSPECTOR, models: [] } }]);

        await agents.refresh(true);

        expect(offered.get('x-dev-beacon-inspector')?.catalog.list()).toHaveLength(1);
    });

    test('stay as they are while the description stands, and are offered again once it changes', async () => {
        const { agents, log, listed } = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: INSPECTOR }]);

        await agents.refresh(true);
        await agents.refresh(false);

        expect(log).toHaveLength(2);

        listed[0] = { extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: { ...INSPECTOR, name: 'Inspector' } };
        await agents.refresh(false);

        expect(log.slice(2)).toEqual(['add x-dev-beacon-inspector', 'invalidate x-dev-beacon-inspector']);
    });

    test('stay offered once the process that described them ended, and leave with their extension', async () => {
        const { agents, offered, log, listed } = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: INSPECTOR }]);

        await agents.refresh(true);

        // The extension is still on, and its process is not there to say what the agent is.
        listed[0] = { extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: null };
        await agents.refresh(false);

        expect(agents.kinds()).toEqual(['x-dev-beacon-inspector']);
        expect(offered.size).toBe(1);

        // Turned off or removed: its manifest lists nothing here any more.
        listed.length = 0;
        await agents.refresh(false);

        expect(log.at(-1)).toBe('remove x-dev-beacon-inspector');
        expect(offered.size).toBe(0);
    });

    test('leave out one whose extension and id are too long for a kind, and keep what is offered when the list fails', async () => {
        const long = world([{ extension: 'com.example.a-rather-long-extension', id: 'agent', version: '1.0.0', described: INSPECTOR }]);
        const failing = new ExtensionAgentProviders({
            list: async () => {
                throw new Error('The extension stopped');
            },
            providers: { add: () => undefined, remove: () => undefined, invalidate: () => undefined }
        });

        await long.agents.refresh(true);
        await failing.refresh(true);

        expect(long.log).toEqual([]);
        expect(failing.kinds()).toEqual([]);
    });

    test('run a chat through the ACP backend with the program and the variables the extension described', async () => {
        const { agents, offered } = world([{ extension: 'dev.beacon', id: 'inspector', version: '0.1.0', described: INSPECTOR }]);

        await agents.refresh(true);

        const provider = offered.get('x-dev-beacon-inspector') as ChatProvider;
        const events: BackendEvent[] = [];
        const started: { command: readonly string[]; env: Record<string, string | undefined> }[] = [];
        const done = Promise.withResolvers<void>();
        const fake = inProcess(fakeAcpWith({}));
        const launch: BackendLaunch = {
            command: provider.command,
            cwd: '/tmp',
            env: {},
            selection: provider.catalog.normalize(undefined),
            modelName: provider.catalog.nameOf(provider.catalog.defaultModel),
            runtimeMode: 'supervised',
            resume: null,
            generation: 1,
            instructions: null,
            resumeNote: null,
            spawn: (options) => {
                started.push({ command: options.command, env: options.env });

                return fake.spawn(options);
            }
        };
        const backend = provider.createBackend(provider.launch?.(launch) ?? launch, {
            onEvent: (event) => {
                events.push(event);

                if (event.type === 'turn.done') {
                    done.resolve();
                }
            }
        });

        await backend.start();
        backend.sendTurn(HELLO);
        await done.promise;
        await backend.dispose();

        expect(started[0]?.command).toEqual(['beacon-agent', 'acp']);
        expect(started[0]?.env.BEACON_MODE).toBe('inspect');
        expect(events.some((event) => event.type === 'turn.done')).toBe(true);
    });
});
