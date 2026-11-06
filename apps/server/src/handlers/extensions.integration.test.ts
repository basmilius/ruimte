import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { closeSync, constants, mkdtempSync, openSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatProvider } from '@adecore/agents/providers';
import type { ServerFrame } from '@ruimte/contracts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ExtensionHost } from '../extensions/extension-host.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ClientConnection } from '../wire.ts';
import { extensionsArea, type ExtensionHandlerDeps } from './extensions.ts';

type Handler = (payload: unknown, client: unknown) => Promise<unknown>;

interface Client extends ClientConnection {
    chunks: string[];
}

function clientOf(id: string): Client {
    const chunks: string[] = [];

    return {
        id,
        chunks,
        send: (frame: ServerFrame) => {
            const event = frame as { type: string; event?: string; payload?: { text?: string } };

            if (event.type === 'event' && event.event === 'extension.agentChunk') {
                chunks.push(event.payload?.text ?? '');
            }
        }
    };
}

/* `extension.agentStream` and `extension.agentStop` on a CLI that runs `script` in a real shell. */
function handlersFor(script: string): { stream(client: Client, runId?: string): Promise<unknown>; stop(client: Client, runId?: string): Promise<unknown> } {
    const handlers = new Map<string, Handler>();
    const provider = { kind: 'claude', name: 'Probe', command: ['sh'], oneShotArgs: () => ['-c', script] } as unknown as ChatProvider;
    const dispatcher = { register: (type: string, handler: Handler) => void handlers.set(type, handler) } as unknown as Dispatcher;
    const deps = {
        providers: { oneShotProvider: async () => provider } as unknown as ProviderRegistry,
        folderOf: () => null
    } as unknown as ExtensionHandlerDeps;

    extensionsArea({ host: {} as ExtensionHost, ...deps, readChat: async () => '' }).handlers?.(dispatcher);

    return {
        stream: (client, runId = 'run-1') => (handlers.get('extension.agentStream') as Handler)({ runId, prompt: 'Hi', projectId: 'project-1' }, client),
        stop: (client, runId = 'run-1') => (handlers.get('extension.agentStop') as Handler)({ runId }, client)
    };
}

async function until(condition: () => boolean): Promise<void> {
    while (!condition()) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

describe('extension.agentStream', () => {
    test('fails with what the CLI said when it exits with a code', async () => {
        const run = handlersFor('printf partial; echo "Not signed in" >&2; exit 1');
        const client = clientOf('client-a');

        await expect(run.stream(client)).rejects.toMatchObject({ code: 'failed', message: 'Probe did not answer: Not signed in' });
        expect(client.chunks.join('')).toBe('partial');
    });

    test('answers once the CLI exits cleanly', async () => {
        const run = handlersFor('printf answered');
        const client = clientOf('client-a');

        expect(await run.stream(client)).toEqual({});
        expect(client.chunks.join('')).toBe('answered');
    });

    test('streams only to the client that started it, which alone stops it, and refuses a second run under its id', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'ruimte-agent-stream-'));
        const gate = join(folder, 'gate');

        // The CLI prints its second piece only once the test opens the gate, after the other client's stop.
        spawnSync('mkfifo', [gate]);

        try {
            const run = handlersFor(`printf started; read go < '${gate}'; printf " more"; read never < '${gate}'`);
            const owner = clientOf('client-a');
            const other = clientOf('client-b');
            const running = run.stream(owner);
            let settled = false;

            void running.then(
                () => (settled = true),
                () => (settled = true)
            );
            await until(() => owner.chunks.length > 0);

            await expect(run.stream(owner)).rejects.toMatchObject({ code: 'refused' });
            await run.stop(other);
            // Opening the gate waits for the CLI to read it, which one the other client's stop ended never does.
            await Promise.race([writeFile(gate, 'go\n'), running.catch(() => undefined)]);
            await until(() => owner.chunks.join('').includes('more') || settled);

            expect(settled).toBe(false);
            expect(other.chunks).toEqual([]);

            await run.stop(owner);

            expect(await running).toEqual({});
            expect(owner.chunks.join('')).toBe('started more');
        } finally {
            // A reader of our own lets a gate write go that no CLI is left to read, so a failing run never hangs the suite.
            closeSync(openSync(gate, constants.O_RDONLY | constants.O_NONBLOCK));
            rmSync(folder, { recursive: true, force: true });
        }
    });
});
