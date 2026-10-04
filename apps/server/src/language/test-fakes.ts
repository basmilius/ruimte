import { createMemoryTransportPair, FakeLanguageServer } from '@ruimte/smart-editor-lsp/testing';
import type { ServerCapabilities } from '@ruimte/smart-editor-lsp';
import type { LanguageChild, LanguageExit, LanguageProcessSpec, SpawnLanguageProcess } from './runtime.ts';
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
    /* Which component: `typescript`, `vue` or `php`, read off the script it was started with. */
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
    if (spec.args.some((arg) => arg.includes('vue-language-server'))) {
        return 'vue';
    }
    if (spec.args.some((arg) => arg.includes('intelephense'))) {
        return 'php';
    }
    return 'typescript';
}

/* Starts no process: every `spawn` is a fake language server on the far end of an in-memory transport. */
export function fakeSpawner(capabilities: Partial<Record<string, ServerCapabilities>> = {}): FakeSpawner {
    const processes: FakeProcess[] = [];
    const spawn: SpawnLanguageProcess = (spec) => {
        const name = nameOf(spec);
        const [clientSide, serverSide] = createMemoryTransportPair();
        const server = new FakeLanguageServer(serverSide, { capabilities: capabilities[name] ?? FULL_CAPABILITIES });
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
