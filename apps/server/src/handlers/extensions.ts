import { homedir } from 'node:os';
import type { ChatProvider } from '@adecore/agents/providers';
import { isCanvasView, sourceOf, type ContextSource, type ExtensionDatabaseValue, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { contextSelection } from '@ruimte/contracts/extension-context';
import { sendEvent, type Dispatcher } from '../dispatcher.ts';
import { errorText } from '../error-text.ts';
import type { ExtensionHost } from '../extensions/extension-host.ts';
import { asExtensionRefusal, ExtensionRefusal } from '../extensions/refusal.ts';
import { oneShotProvider, oneShotRun, runOneShot } from '../git/one-shot.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

const AGENT_RUN_TIMEOUT_MS = 180_000;
const STDERR_TAIL_CHARS = 2_000;

export interface ExtensionHandlerDeps {
    viewsOf(projectId: string): readonly ProjectView[] | null;
    folderOf(projectId: string): string | null;
    readSource(source: ContextSource, projectId: string): Promise<string>;
    providers: ProviderRegistry;
    databaseQuery(projectId: string, connection: string, sql: string): Promise<{ columns: string[]; rows: ExtensionDatabaseValue[][]; hasMore: boolean }>;
}

function nodesIn(views: readonly ProjectView[], of: { nodeIds?: readonly string[] | undefined; viewId?: string | undefined }): ProjectNode[] {
    const selects = contextSelection(of);

    return views.filter(isCanvasView).flatMap((view) => view.nodes.filter((node) => selects(node.id, view.id)));
}

/* An `agentStop` for a run, also one that comes before its CLI started. */
class StreamStop {
    stopped = false;

    private child: { kill(): void } | null = null;

    started(child: { kill(): void }): void {
        this.child = child;
    }

    kill(): void {
        this.stopped = true;
        this.child?.kill();
    }
}

/*
 * The runs under way, each by the client that started it and its run id: a client chooses the id, so another client's
 * stop or a second run under the same id never reaches a run that is not its own.
 */
export class AgentStreams {
    private readonly runs = new Map<string, StreamStop>();

    /* Refused while the client has a run under that id. */
    claim(clientId: string, runId: string): StreamStop {
        const key = AgentStreams.keyOf(clientId, runId);

        if (this.runs.has(key)) {
            throw new ExtensionRefusal('refused', `A run ${runId} is already under way`);
        }

        const stop = new StreamStop();

        this.runs.set(key, stop);

        return stop;
    }

    release(clientId: string, runId: string, stop: StreamStop): void {
        const key = AgentStreams.keyOf(clientId, runId);

        if (this.runs.get(key) === stop) {
            this.runs.delete(key);
        }
    }

    stop(clientId: string, runId: string): void {
        this.runs.get(AgentStreams.keyOf(clientId, runId))?.kill();
    }

    private static keyOf(clientId: string, runId: string): string {
        return JSON.stringify([clientId, runId]);
    }
}

/* The last `limit` characters of a stream, read to its end so the process never waits on a full pipe. */
async function tailOf(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
    const decoder = new TextDecoder();
    let tail = '';

    for await (const piece of stream) {
        tail = `${tail}${decoder.decode(piece, { stream: true })}`.slice(-limit);
    }

    return tail;
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

/*
 * A list and a call are for any client let in. What changes what runs on this machine takes its owner. A request an
 * extension makes fails under an `ExtensionErrorCode`, which its client hands it as a Result.
 */
export function registerExtensionHandlers(dispatcher: Dispatcher, host: ExtensionHost, deps: ExtensionHandlerDeps): void {
    const extensionDispatcher = forExtension(dispatcher);

    registerExtensionCalls(extensionDispatcher, host, deps);
    registerExtensionAdmin(dispatcher, host);
}

/* Registers on `dispatcher` with every failure turned into an `ExtensionRefusal`. */
function forExtension(dispatcher: Dispatcher): Pick<Dispatcher, 'register'> {
    return {
        register(type, handler, options) {
            dispatcher.register(
                type,
                async (payload, client) => {
                    try {
                        return await handler(payload, client);
                    } catch (e) {
                        throw asExtensionRefusal(e);
                    }
                },
                options
            );
        }
    };
}

function registerExtensionCalls(dispatcher: Pick<Dispatcher, 'register'>, host: ExtensionHost, deps: ExtensionHandlerDeps): void {
    dispatcher.register('extension.contextRead', async (payload) => {
        const folder = deps.folderOf(payload.projectId);
        const views = deps.viewsOf(payload.projectId);

        if (views === null) {
            throw new ExtensionRefusal('not-found', `No project ${payload.projectId} on this machine`);
        }

        const nodes = nodesIn(views, payload);
        const sources = nodes
            .flatMap((node) => sourceOf(node, undefined, folder) ?? [])
            .filter((source) => payload.kind === undefined || source.kind === payload.kind);

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

    const streams = new AgentStreams();

    // The same process as above, read as it writes rather than when it is done, its pieces only to the client that asked.
    dispatcher.register('extension.agentStream', async (payload, client) => {
        // Taken before the first await, so an `agentStop` that comes while the provider is looked up still lands.
        const stop = streams.claim(client.id, payload.runId);

        try {
            return await streamAgent(payload, stop, (text) => {
                if (client.closed !== true) {
                    sendEvent(client, 'extension.agentChunk', { runId: payload.runId, text });
                }
            });
        } finally {
            streams.release(client.id, payload.runId, stop);
        }
    });

    const streamAgent = async (
        payload: { runId: string; prompt: string; projectId: string; provider?: string | undefined },
        stop: StreamStop,
        chunk: (text: string) => void
    ): Promise<Record<string, never>> => {
        const options = payload.provider === undefined ? {} : { provider: payload.provider as ChatProvider['kind'] };
        const provider = await oneShotProvider(deps.providers, options, 'answer an extension');
        const run = oneShotRun(provider, payload.prompt);

        if (run === null) {
            throw new ExtensionRefusal('unavailable', `${provider.name} cannot answer a single prompt`);
        }

        if (stop.stopped) {
            return {};
        }

        const child = Bun.spawn([provider.command[0] as string, ...run.args], {
            cwd: deps.folderOf(payload.projectId) ?? homedir(),
            stdin: run.stdin === undefined ? 'ignore' : new TextEncoder().encode(run.stdin),
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const stderr = tailOf(child.stderr, STDERR_TAIL_CHARS).catch(() => '');
        const decoder = new TextDecoder();
        let timedOut = false;
        // This request has no deadline on the client, so the run gets the one `extension.agentRun` has.
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, AGENT_RUN_TIMEOUT_MS);

        stop.started(child);

        try {
            for await (const piece of child.stdout) {
                chunk(decoder.decode(piece, { stream: true }));
            }

            await child.exited;
        } finally {
            clearTimeout(timer);

            // A read that broke off leaves the process running otherwise.
            if (child.exitCode === null && child.signalCode === null) {
                child.kill();
            }
        }

        if (timedOut) {
            throw new ExtensionRefusal('timeout', `${provider.name} did not answer within ${AGENT_RUN_TIMEOUT_MS / 1000} seconds`);
        }

        // A CLI that is not signed in prints nothing and exits with a code. One stopped through `agentStop` has none.
        if (child.exitCode !== null && child.exitCode !== 0) {
            throw new ExtensionRefusal('failed', `${provider.name} did not answer: ${(await stderr).trim()}`);
        }

        return {};
    };

    dispatcher.register('extension.action', async ({ id, projectId, action, input }) => ({ output: await host.runAction(id, projectId, action, input) }));
    dispatcher.register('extension.clientFiles', ({ id }) => host.clientFiles(id));

    dispatcher.register('extension.agentStart', async ({ id, ...start }) => host.startAgent(id, start));

    dispatcher.register('extension.agentStop', async (payload, client) => {
        streams.stop(client.id, payload.runId);

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
}

function registerExtensionAdmin(dispatcher: Dispatcher, host: ExtensionHost): void {
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
