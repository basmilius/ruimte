import { isCanvasView, sourceOf, type ContextSource, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import type { ChatProvider } from '@adecore/agents/providers';
import type { Dispatcher } from '../dispatcher.ts';
import { errorText } from '../error-text.ts';
import type { ExtensionHost } from '../extensions/extension-host.ts';
import { oneShotProvider, oneShotRun, runOneShot } from '../git/one-shot.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { homedir } from 'node:os';

const AGENT_RUN_TIMEOUT_MS = 180_000;

export interface ExtensionHandlerDeps {
    viewsOf(projectId: string): readonly ProjectView[] | null;
    folderOf(projectId: string): string | null;
    readSource(source: ContextSource, projectId: string): Promise<string>;
    providers: ProviderRegistry;
    databaseQuery(projectId: string, connection: string, sql: string): Promise<{ columns: string[]; rows: unknown[][]; hasMore: boolean }>;
}

function nodesIn(views: readonly ProjectView[], nodeIds: readonly string[] | undefined, viewId: string | undefined): ProjectNode[] {
    const canvases = views.filter(isCanvasView);

    if (viewId !== undefined) {
        return canvases.find((view) => view.id === viewId)?.nodes ?? [];
    }

    const wanted = new Set(nodeIds ?? []);

    return canvases.flatMap((view) => view.nodes.filter((node) => wanted.has(node.id)));
}

/* One process that reads a prompt and prints an answer, for `agents.run` in `server/`, with no project behind it. */
export async function runExtensionPrompt(
    providers: ProviderRegistry,
    options: { prompt: string; context?: string[]; provider?: string }
): Promise<{ text: string }> {
    const provider = await oneShotProvider(
        providers,
        options.provider === undefined ? {} : { provider: options.provider as ChatProvider['kind'] },
        'answer an extension'
    );
    const result = await runOneShot(provider, homedir(), [options.prompt, ...(options.context ?? [])].join('\n\n'), AGENT_RUN_TIMEOUT_MS, {});

    if (result.code !== 0) {
        throw new Error(`${provider.name} did not answer: ${result.stderr.trim()}`);
    }

    return { text: result.stdout };
}

/* A list and a call are for any client let in. What changes what runs on this machine takes its owner. */
export function registerExtensionHandlers(dispatcher: Dispatcher, host: ExtensionHost, deps: ExtensionHandlerDeps): void {
    dispatcher.register('extension.contextRead', async (payload) => {
        const folder = deps.folderOf(payload.projectId);
        const nodes = nodesIn(deps.viewsOf(payload.projectId) ?? [], payload.nodeIds, payload.viewId);
        const sources = nodes.flatMap((node) => sourceOf(node, undefined, folder) ?? []);

        return {
            sources: await Promise.all(
                sources.map(async (source) => ({
                    id: source.id,
                    kind: source.kind,
                    title: source.title,
                    text: await deps.readSource(source, payload.projectId).catch((e: unknown) => `(${errorText(e)})`)
                }))
            )
        };
    });

    // One process that reads a prompt and prints an answer, on the person's own CLI and plan.
    dispatcher.register('extension.agentRun', async (payload) => {
        const options = payload.provider === undefined ? {} : { provider: payload.provider as ChatProvider['kind'] };
        const provider = await oneShotProvider(deps.providers, options, 'answer an extension');

        const result = await runOneShot(provider, deps.folderOf(payload.projectId) ?? homedir(), payload.prompt, AGENT_RUN_TIMEOUT_MS, options);

        if (result.code !== 0) {
            throw new Error(`${provider.name} did not answer: ${result.stderr.trim()}`);
        }

        return { text: result.stdout };
    });

    const streams = new Map<string, { kill(): void }>();

    // The same process as above, read as it writes rather than when it is done.
    dispatcher.register('extension.agentStream', async (payload) => {
        const options = payload.provider === undefined ? {} : { provider: payload.provider as ChatProvider['kind'] };
        const provider = await oneShotProvider(deps.providers, options, 'answer an extension');
        const run = oneShotRun(provider, payload.prompt);

        if (run === null) {
            throw new Error(`${provider.name} cannot answer a single prompt`);
        }

        const child = Bun.spawn([provider.command[0] as string, ...run.args], {
            cwd: deps.folderOf(payload.projectId) ?? homedir(),
            stdin: run.stdin === undefined ? 'ignore' : new TextEncoder().encode(run.stdin),
            stdout: 'pipe',
            stderr: 'ignore'
        });
        const decoder = new TextDecoder();

        streams.set(payload.runId, child);

        for await (const piece of child.stdout) {
            host.emitChunk(payload.runId, decoder.decode(piece, { stream: true }));
        }

        await child.exited;
        streams.delete(payload.runId);

        return {};
    });

    dispatcher.register('extension.agentStart', async ({ id, ...start }) => host.startAgent(id, start));

    dispatcher.register('extension.agentStop', async (payload) => {
        streams.get(payload.runId)?.kill();

        return {};
    });

    dispatcher.register('extension.databaseQuery', async (payload) => deps.databaseQuery(payload.projectId, payload.connection, payload.sql));

    dispatcher.register('extension.list', async () => ({ extensions: await host.list() }));

    dispatcher.register('extension.call', async (payload) => ({ result: await host.call(payload.id, payload.method, payload.args) }));

    dispatcher.register('extension.storageGet', async (payload) => ({ value: await host.storageGet(payload.id, payload.key) }));
    dispatcher.register('extension.storageSet', async (payload) => {
        await host.storageSet(payload.id, payload.key, payload.value);

        return {};
    });

    dispatcher.register(
        'extension.log',
        async (payload) => {
            await host.appendDevLog(payload.id, payload.text);

            return {};
        },
        { owner: true }
    );

    dispatcher.register('extension.install', (payload) => host.install(payload.pack), { owner: true });

    dispatcher.register(
        'extension.remove',
        async (payload) => {
            await host.remove(payload.id);

            return {};
        },
        { owner: true }
    );

    dispatcher.register(
        'extension.setEnabled',
        async (payload) => {
            await host.setEnabled(payload.id, payload.enabled);

            return {};
        },
        { owner: true }
    );
}
