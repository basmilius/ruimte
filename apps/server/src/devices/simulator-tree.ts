import { existsSync } from 'node:fs';
import { realTimers, type Timers } from '../computer/approvals.ts';
import { SimulatorTreeReplySchema, type SimulatorTreeReply } from './device-tree.ts';
import { DeviceError } from './manager.ts';

/* How long the bridge may take to load its frameworks and find the simulator. */
const READY_MS = 15_000;

/* What the bridge is told a tree may take; the first read after a boot waits seconds for the device. */
export const BRIDGE_TREE_MS = 10_000;

/* The bridge gives up on the device itself, so the daemon only stops waiting once the bridge is late with that. */
export const TREE_REPLY_MS = BRIDGE_TREE_MS + 5_000;

/* How long a closed reader may take to leave after its stdin closed. */
const CLOSE_GRACE_MS = 1_000;

export interface TreeChild {
    write(line: string): void;
    end(): void;
    kill(): void;
}

export interface TreeChildEvents {
    line(text: string): void;
    exit(code: number, stderr: string): void;
}

export type TreeLauncher = (udid: string, events: TreeChildEvents) => TreeChild;

/* Runs the bridge's accessibility mode for one simulator and hands its output over line by line; null without a bridge. */
export const createTreeLauncher = (bridge: string): TreeLauncher | null => {
    if (!existsSync(bridge)) {
        return null;
    }
    return (udid, events) => {
        const child = Bun.spawn([bridge, 'simulator-accessibility', '--udid', udid], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        const stderr = new Response(child.stderr).text().catch(() => '');
        void (async () => {
            const decoder = new TextDecoder();
            let buffered = '';
            for await (const chunk of child.stdout) {
                buffered += decoder.decode(chunk, { stream: true });
                let end = buffered.indexOf('\n');
                while (end !== -1) {
                    events.line(buffered.slice(0, end));
                    buffered = buffered.slice(end + 1);
                    end = buffered.indexOf('\n');
                }
            }
        })()
            .catch(() => undefined)
            .then(async () => events.exit(await child.exited, (await stderr).slice(-4096)));
        return {
            write: (line) => {
                child.stdin.write(line);
                child.stdin.flush();
            },
            end: () => {
                child.stdin.end();
            },
            kill: () => child.kill('SIGKILL')
        };
    };
};

interface Waiter {
    resolve(value: SimulatorTreeReply | null): void;
    reject(error: DeviceError): void;
    cancel(): void;
}

const READY = 'ready';

/* A failure the bridge names, in the words and codes a device failure reaches an agent with. */
export const treeErrorOf = (code: string, message: string): DeviceError => {
    switch (code) {
        case 'unavailable':
            return new DeviceError('device-tree-unavailable', `The simulator's accessibility cannot be read on this machine: ${message}`);
        case 'device-not-booted':
            return new DeviceError('device-not-booted', 'Start the device before reading it');
        case 'device-not-found':
            return new DeviceError('device-not-found', 'The iOS simulator is no longer available');
        default:
            return new DeviceError('device-tree-failed', `The simulator's accessibility tree could not be read: ${message}`);
    }
};

/*
 * One simulator's bridge process, kept running between reads so a tree takes tens of milliseconds
 * instead of a process start. Reads go one at a time, a late answer ends the process, and the next
 * read after any failure starts a fresh one.
 */
export class SimulatorTreeReader {
    private readonly udid: string;
    private readonly launch: TreeLauncher;
    private readonly timers: Timers;
    private readonly waiting = new Map<number | typeof READY, Waiter>();
    private child: TreeChild | null = null;
    private started: Promise<unknown> | null = null;
    private nextId = 1;
    private turn: Promise<unknown> = Promise.resolve();

    constructor(udid: string, launch: TreeLauncher, timers: Timers = realTimers) {
        this.udid = udid;
        this.launch = launch;
        this.timers = timers;
    }

    get running(): boolean {
        return this.child !== null;
    }

    read(): Promise<SimulatorTreeReply> {
        const next = this.turn.then(() => this.readNow());
        this.turn = next.catch(() => undefined);
        return next;
    }

    close(): void {
        const child = this.child;
        this.fail(new DeviceError('device-tree-failed', 'The accessibility reader was closed'));
        if (child === null) {
            return;
        }
        try {
            child.end();
        } catch {
            child.kill();
            return;
        }
        this.timers.set(() => child.kill(), CLOSE_GRACE_MS);
    }

    private async readNow(): Promise<SimulatorTreeReply> {
        const child = await this.start();
        const id = this.nextId++;
        const reply = this.wait(id, TREE_REPLY_MS, `The simulator did not answer within ${TREE_REPLY_MS / 1000} s`);
        try {
            child.write(`${JSON.stringify({ type: 'tree', id, timeoutMs: BRIDGE_TREE_MS })}\n`);
        } catch {
            this.fail(new DeviceError('device-tree-failed', 'The accessibility reader stopped'));
        }
        const tree = await reply;
        if (tree === null) {
            throw new DeviceError('device-tree-failed', 'The accessibility reader answered out of turn');
        }
        return tree;
    }

    private async start(): Promise<TreeChild> {
        if (this.started === null) {
            const ready = this.wait(READY, READY_MS, 'The accessibility reader did not start in time');
            let child: TreeChild;
            try {
                child = this.launch(this.udid, {
                    line: (text) => this.receive(child, text),
                    exit: (code, stderr) => this.exited(child, code, stderr)
                });
            } catch (error) {
                this.fail(new DeviceError('device-tree-unavailable', error instanceof Error ? error.message : 'The accessibility reader could not start'));
                await ready.catch(() => undefined);
                throw new DeviceError('device-tree-unavailable', 'The accessibility reader could not start');
            }
            this.child = child;
            this.started = ready;
        }
        await this.started;
        if (this.child === null) {
            throw new DeviceError('device-tree-failed', 'The accessibility reader stopped');
        }
        return this.child;
    }

    private wait(key: number | typeof READY, ms: number, late: string): Promise<SimulatorTreeReply | null> {
        return new Promise((resolve, reject) => {
            const waiter: Waiter = {
                resolve,
                reject,
                cancel: this.timers.set(() => {
                    if (this.waiting.get(key) === waiter) {
                        this.stop(new DeviceError('device-tree-failed', late));
                    }
                }, ms)
            };
            this.waiting.set(key, waiter);
        });
    }

    private settle(key: number | typeof READY, outcome: { reply: SimulatorTreeReply | null } | { error: DeviceError }): void {
        const waiter = this.waiting.get(key);
        if (!waiter) {
            return;
        }
        this.waiting.delete(key);
        waiter.cancel();
        if ('error' in outcome) {
            waiter.reject(outcome.error);
        } else {
            waiter.resolve(outcome.reply);
        }
    }

    private receive(child: TreeChild, text: string): void {
        if (this.child !== child || text.trim() === '') {
            return;
        }
        let message: {
            type?: unknown;
            id?: unknown;
            code?: unknown;
            message?: unknown;
        };
        try {
            message = JSON.parse(text) as typeof message;
        } catch {
            this.stop(new DeviceError('device-tree-failed', 'The accessibility reader wrote something that is not JSON'));
            return;
        }
        if (message.type === 'ready') {
            this.settle(READY, { reply: null });
            return;
        }
        if (message.type === 'error') {
            const error = treeErrorOf(String(message.code), String(message.message));
            // Without an id the bridge failed before it could read at all, and it exits after saying so.
            if (typeof message.id === 'number') {
                this.settle(message.id, { error });
            } else {
                this.stop(error);
            }
            return;
        }
        const parsed = SimulatorTreeReplySchema.safeParse(message);
        if (!parsed.success) {
            this.stop(new DeviceError('device-tree-failed', 'The accessibility reader answered with a tree Ruimte could not read'));
            return;
        }
        this.settle(parsed.data.id, { reply: parsed.data });
    }

    private exited(child: TreeChild, code: number, stderr: string): void {
        if (this.child !== child) {
            return;
        }
        this.fail(new DeviceError('device-tree-failed', stderr.trim() || `The accessibility reader exited with code ${code}`));
    }

    /* Ends the process as well, for one that broke the protocol or stopped answering. */
    private stop(error: DeviceError): void {
        const child = this.child;
        this.fail(error);
        child?.kill();
    }

    private fail(error: DeviceError): void {
        this.child = null;
        this.started = null;
        for (const key of [...this.waiting.keys()]) {
            this.settle(key, { error });
        }
    }
}
