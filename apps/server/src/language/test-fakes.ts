import { createMemoryTransportPair, FakeLanguageServer } from '@adecore/lsp/testing';
import type { RequestHandler, ServerCapabilities } from '@adecore/lsp';
import type { LanguageChild, LanguageExit, LanguageProcessSpec, SpawnLanguageProcess } from './runtime.ts';
import { KIND_PROFILES } from './profiles.ts';
import type { LanguageClock } from './server.ts';

export const FULL_CAPABILITIES: ServerCapabilities = {
    textDocumentSync: 2,
    hoverProvider: true,
    completionProvider: { resolveProvider: true, triggerCharacters: ['.'] },
    renameProvider: { prepareProvider: true },
    inlayHintProvider: true,
    executeCommandProvider: { commands: ['fix.all'] }
};

export interface FakeProcess {
    readonly spec: LanguageProcessSpec;
    /* Which component (`typescript`, `vue`, `css`, ...), read off the script it was started with. */
    readonly name: string;
    readonly server: FakeLanguageServer;
    readonly kills: string[];
    /* Ignores a SIGTERM, so only a SIGKILL ends it. */
    stubborn: boolean;
    say(text: string): void;
    /* The process dies on its own. */
    crash(code?: number): Promise<void>;
}

export interface FakeSpawner {
    spawn: SpawnLanguageProcess;
    processes: FakeProcess[];
    /* The processes of a component, in the order they were started. */
    of(name: string): FakeProcess[];
}

function nameOf(spec: LanguageProcessSpec): string {
    // The install directory (`<kind>/versions/<id>`) names the kind, which tells apart processes that run the same script, like the sidecar of TypeScript and the TypeScript server of Vue.
    const kind = spec.args.map((arg) => /\/([^/]+)\/(?:versions\/[^/]+\/)?node_modules\//.exec(arg)?.[1]).find((name) => name !== undefined);
    const profiles = kind !== undefined && kind in KIND_PROFILES ? [KIND_PROFILES[kind as keyof typeof KIND_PROFILES]] : Object.values(KIND_PROFILES);
    // A native server is its own command, and a server of a person's own is named by it.
    return (
        profiles
            .flatMap((profile) => profile.components)
            .find((component) => spec.command.endsWith(component.entry) || spec.args.some((arg) => arg.endsWith(component.entry)))?.name ?? spec.command
    );
}

/*
 * Starts no process: every `spawn` is a fake language server on the far end of an in-memory transport.
 * The components in `silent` never answer their handshake, and `handlers` answer requests from the first one on.
 */
export function fakeSpawner(
    capabilities: Partial<Record<string, ServerCapabilities>> = {},
    silent: readonly string[] = [],
    handlers: Partial<Record<string, Record<string, RequestHandler>>> = {}
): FakeSpawner {
    const processes: FakeProcess[] = [];
    const spawn: SpawnLanguageProcess = (spec) => {
        const name = nameOf(spec);
        const [clientSide, serverSide] = createMemoryTransportPair();
        const server = new FakeLanguageServer(serverSide, {
            capabilities: capabilities[name] ?? FULL_CAPABILITIES,
            silent: silent.includes(name),
            handlers: handlers[name]
        });
        const stderrListeners: ((text: string) => void)[] = [];
        let resolveExit: (exit: LanguageExit) => void = () => undefined;
        const exited = new Promise<LanguageExit>((resolve) => {
            resolveExit = resolve;
        });
        const kills: string[] = [];
        const child: LanguageChild = {
            transport: clientSide,
            onStderr: (listener) => {
                stderrListeners.push(listener);
            },
            exited,
            kill: (signal) => {
                kills.push(signal);
                if (!fake.stubborn || signal === 'SIGKILL') {
                    resolveExit({ code: null, signal });
                    void clientSide.close();
                }
            }
        };
        const fake: FakeProcess = {
            spec,
            name,
            server,
            kills,
            stubborn: false,
            say: (text) => stderrListeners.forEach((listener) => listener(text)),
            crash: async (code = 1) => {
                resolveExit({ code, signal: null });
                await clientSide.close();
            }
        };
        processes.push(fake);
        return child;
    };
    return { spawn, processes, of: (name) => processes.filter((process) => process.name === name) };
}

/* A clock that fires only when a test says so. */
export class ManualClock implements LanguageClock {
    private readonly timers = new Set<() => void>();

    set(run: () => void): () => void {
        this.timers.add(run);
        return () => this.timers.delete(run);
    }

    get pending(): number {
        return this.timers.size;
    }

    fire(): void {
        for (const run of [...this.timers]) {
            this.timers.delete(run);
            run();
        }
    }
}

/* Lets what is queued on promises and microtasks run, which is all the fakes need. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
        await Promise.resolve();
    }
}
