/*
 * An `ExtensionHost` whose store, files, language servers and processes each stop at a gate until a test lets them go,
 * so a test can force any order of their steps. Nothing in it reads a clock or starts a process.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ExtensionManifest } from '@ruimte/contracts';
import { ExtensionHost, type ExtensionHostFiles } from './extension-host.ts';
import type { ExtensionStore, StoredExtension } from './store.ts';

// Turns of the event loop without a held step or a settled operation before a wait gives up. No wall clock is read.
const MAX_IDLE_TURNS = 200;
const DRAIN_IDLE_TURNS = 20;

export interface Hold {
    label: string;
    subject: string;
    release(): void;
}

/* Every step that waits for the test, in the order they arrived. */
export class Gates {
    readonly held: Hold[] = [];
    // Labels that pass at once, for the steps a test does not mean to order.
    readonly open = new Set<string>();

    hold<Value>(label: string, subject: string, work: () => Value | Promise<Value>): Promise<Value> {
        if (this.open.has(label)) {
            return Promise.resolve().then(work);
        }

        return new Promise<Value>((resolve, reject) => {
            const hold: Hold = {
                label,
                subject,
                release: () => {
                    this.held.splice(this.held.indexOf(hold), 1);
                    Promise.resolve().then(work).then(resolve, reject);
                }
            };

            this.held.push(hold);
        });
    }

    /* The first held step of this label, and subject when given, once it arrives. */
    async next(label: string, subject?: string): Promise<Hold> {
        for (let turn = 0; turn < MAX_IDLE_TURNS; turn++) {
            const hold = this.held.find((each) => each.label === label && (subject === undefined || each.subject === subject));

            if (hold !== undefined) {
                return hold;
            }

            await turnOver();
        }

        throw new Error(`Nothing reached ${label}${subject === undefined ? '' : ` for ${subject}`}; held: ${this.describe()}`);
    }

    async release(label: string, subject?: string): Promise<void> {
        (await this.next(label, subject)).release();
        await turnOver();
    }

    /* Lets every held step go in the order it arrived, except those `keep` holds back, until no other arrives for a while. */
    async drain(keep: (hold: Hold) => boolean = () => false): Promise<void> {
        for (let idle = 0; idle < DRAIN_IDLE_TURNS; idle++) {
            const hold = this.held.find((each) => !keep(each));

            if (hold !== undefined) {
                hold.release();
                idle = -1;
            }

            await turnOver();
        }
    }

    describe(): string {
        return this.held.map((hold) => `${hold.label}(${hold.subject})`).join(', ') || 'nothing';
    }
}

export function turnOver(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/* A `server/` that does what the host tells it only once the test lets its steps go. */
export class GatedChild extends EventEmitter {
    readonly stdin = new PassThrough();
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly told: { type: string; id?: number; name?: string; method?: string }[] = [];
    // Events written to it after it was killed, which no process would read.
    readonly toldAfterKill: string[] = [];
    readonly id: string;
    killed = false;
    exited = false;

    private readonly gates: Gates;

    constructor(id: string, gates: Gates) {
        super();
        this.id = id;
        this.gates = gates;
        this.stdin.setEncoding('utf8');
        this.stdin.on('data', (chunk: string) => {
            for (const line of chunk.split('\n').filter((each) => each !== '')) {
                const message = JSON.parse(line) as { type: string };

                this.told.push(message);

                if (this.killed && message.type === 'event') {
                    this.toldAfterKill.push(line);
                }
            }
        });
    }

    /* Until it exited, which a process does a while after it was asked to, not as the kill returns. */
    get live(): boolean {
        return !this.exited;
    }

    say(message: object): void {
        this.stdout.write(`${JSON.stringify(message)}\n`);
    }

    kill(): boolean {
        if (this.killed) {
            return true;
        }

        this.killed = true;
        void this.gates.hold('process.exit', this.id, () => {
            this.exited = true;
            this.emit('exit', null);
        });

        return true;
    }
}

export interface Plan {
    manifest: Partial<ExtensionManifest> & { id: string };
    // What the process says before `ready`, the way `server/` does while its module loads.
    onLoad?: (child: GatedChild) => void;
}

/* Files by their `/` path on every platform: the host joins the store's paths with the separator of the one it runs on. */
export class FileMap extends Map<string, string> {
    override get(path: string): string | undefined {
        return super.get(path.replaceAll('\\', '/'));
    }

    override has(path: string): boolean {
        return super.has(path.replaceAll('\\', '/'));
    }

    override set(path: string, text: string): this {
        return super.set(path.replaceAll('\\', '/'), text);
    }

    override delete(path: string): boolean {
        return super.delete(path.replaceAll('\\', '/'));
    }
}

/* The host and everything around it, each in memory and behind a gate. */
export class GatedHost {
    readonly gates = new Gates();
    readonly host: ExtensionHost;
    readonly children: GatedChild[] = [];
    readonly files = new FileMap();
    readonly languageServers = new Map<string, Set<string>>();
    // A spawn while another process of the same extension still ran.
    readonly overlaps: string[] = [];

    private readonly extensions = new Map<string, StoredExtension>();
    private readonly plans = new Map<string, Plan>();

    constructor(plans: Plan[]) {
        for (const plan of plans) {
            this.plans.set(plan.manifest.id, plan);
            this.extensions.set(plan.manifest.id, this.stored(plan));
        }

        const gates = this.gates;
        const store = {
            // A read takes what is stored when it is asked, and the test holds when its answer arrives.
            list: () => {
                const extensions = [...this.extensions.values()].map((extension) => ({ ...extension }));

                return gates.hold('store.list', '*', () => extensions);
            },
            get: (id: string) => {
                const extension = this.extensions.get(id);
                const read = extension === undefined ? null : { ...extension };

                return gates.hold('store.get', id, () => read);
            },
            setEnabled: (id: string, enabled: boolean) =>
                gates.hold('store.setEnabled', id, () => {
                    const extension = this.extensions.get(id);

                    if (extension === undefined) {
                        throw new Error(`No extension ${id} on this machine`);
                    }

                    extension.enabled = enabled;
                }),
            install: (pack: string) =>
                gates.hold('store.install', pack, () => {
                    const plan = this.plans.get(pack) as Plan;
                    const extension = this.stored(plan);

                    this.extensions.set(pack, extension);

                    return { ...extension };
                }),
            remove: (id: string) =>
                gates.hold('store.remove', id, () => {
                    this.extensions.delete(id);
                }),
            link: (id: string) => gates.hold('store.link', id, () => this.stored(this.plans.get(id) as Plan).manifest),
            unlink: (id: string) => gates.hold('store.unlink', id, () => undefined),
            serverEntry: (extension: StoredExtension) => `/extensions/${extension.manifest.id}/server/index.js`,
            dataFolder: (id: string) => `/extensions/${id}/data`,
            logFile: (id: string) => `/extensions/${id}/server.log`
        };
        const files: ExtensionHostFiles = {
            mkdir: (folder) => gates.hold('fs.mkdir', folder, () => undefined),
            readText: (file) => {
                const text = this.files.get(file);

                return gates.hold('fs.read', file, () => {
                    if (text === undefined) {
                        throw new Error(`ENOENT ${file}`);
                    }

                    return text;
                });
            },
            write: (file, text) => gates.hold('fs.write', file, () => void this.files.set(file, text)),
            rename: (from, to) =>
                gates.hold('fs.rename', to, () => {
                    this.files.set(to, this.files.get(from) ?? '');
                    this.files.delete(from);
                }),
            // A log is no step of the lifecycle, so it never waits.
            append: async (file, text) => void this.files.set(file, `${this.files.get(file) ?? ''}${String(text)}`)
        };

        this.host = new ExtensionHost({
            store: store as unknown as ExtensionStore,
            files,
            now: () => 0,
            asks: () => ({ 'chats.list': async () => [] }),
            addLanguageServer: (id, server) =>
                gates.hold('languages.add', id, () => {
                    const servers = this.languageServers.get(id) ?? new Set();

                    servers.add((server as { name: string }).name);
                    this.languageServers.set(id, servers);
                }),
            removeLanguageServers: (id) => gates.hold('languages.remove', id, () => void this.languageServers.delete(id)),
            spawnProcess: ((_command: string, _args: string[], options: { env: Record<string, string> }) =>
                this.spawn(options.env.RUIMTE_EXTENSION_ID as string)) as never
        });
    }

    has(id: string): boolean {
        return this.extensions.has(id);
    }

    enabled(id: string): boolean {
        return this.extensions.get(id)?.enabled === true;
    }

    live(id: string): GatedChild[] {
        return this.children.filter((child) => child.id === id && child.live);
    }

    private stored(plan: Plan): StoredExtension {
        return {
            manifest: { name: plan.manifest.id, version: '0.1.0', api: 1, ...plan.manifest },
            hash: 'hash',
            enabled: true,
            folder: `/extensions/${plan.manifest.id}`
        };
    }

    private spawn(id: string): GatedChild {
        if (this.live(id).length > 0) {
            this.overlaps.push(id);
        }

        const child = new GatedChild(id, this.gates);

        this.children.push(child);
        void this.gates.hold('process.ready', id, () => {
            if (child.killed) {
                return;
            }

            this.plans.get(id)?.onLoad?.(child);
            child.say({ type: 'ready' });
        });
        // A call is answered once the test lets it, with the number of the call.
        child.stdin.on('data', (chunk: string) => {
            for (const line of chunk.split('\n').filter((each) => each !== '')) {
                const message = JSON.parse(line) as { type: string; id: number };

                if (message.type === 'call') {
                    void this.gates.hold('process.answer', id, () => {
                        if (!child.killed) {
                            child.say({ type: 'result', id: message.id, result: message.id });
                        }
                    });
                }
            }
        });

        return child;
    }
}
