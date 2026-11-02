import { describe, expect, test } from 'bun:test';
import type { ChatProvider } from '@adecore/agents/providers';
import type { Dispatcher } from '../dispatcher.ts';
import type { ExtensionHost } from '../extensions/extension-host.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { registerExtensionHandlers, type ExtensionHandlerDeps } from './extensions.ts';

type Handler = (payload: unknown, client: unknown) => Promise<unknown>;

/* `extension.agentStream` on a CLI that runs `script` in a real shell, with what it streamed. */
function streamOf(script: string): { stream(): Promise<unknown>; chunks: string[] } {
    const handlers = new Map<string, Handler>();
    const chunks: string[] = [];
    const provider = { kind: 'claude', name: 'Probe', command: ['sh'], oneShotArgs: () => ['-c', script] } as unknown as ChatProvider;
    const dispatcher = { register: (type: string, handler: Handler) => void handlers.set(type, handler) } as unknown as Dispatcher;
    const host = { emitChunk: (_runId: string, text: string) => void chunks.push(text) } as unknown as ExtensionHost;
    const deps = {
        providers: { oneShotProvider: async () => provider } as unknown as ProviderRegistry,
        folderOf: () => null
    } as unknown as ExtensionHandlerDeps;

    registerExtensionHandlers(dispatcher, host, deps);

    return {
        stream: () => (handlers.get('extension.agentStream') as Handler)({ runId: 'run-1', prompt: 'Hi', projectId: 'project-1' }, {}),
        chunks
    };
}

describe('extension.agentStream', () => {
    test('fails with what the CLI said when it exits with a code', async () => {
        const run = streamOf('printf partial; echo "Not signed in" >&2; exit 1');

        await expect(run.stream()).rejects.toMatchObject({ code: 'failed', message: 'Probe did not answer: Not signed in' });
        expect(run.chunks.join('')).toBe('partial');
    });

    test('answers once the CLI exits cleanly', async () => {
        const run = streamOf('printf answered');

        expect(await run.stream()).toEqual({});
        expect(run.chunks.join('')).toBe('answered');
    });
});
