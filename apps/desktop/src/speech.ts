import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { SpeechEvent } from '@ruimte/desktop-bridge';

export const speechHelperPath = (packaged: boolean, daemonExecutable: string, sourceRoot: string): string =>
    packaged
        ? join(dirname(daemonExecutable), 'native', process.platform === 'win32' ? 'speech-bridge.exe' : 'speech-bridge')
        : join(sourceRoot, 'apps', 'speech-bridge', 'target', 'release', process.platform === 'win32' ? 'speech-bridge.exe' : 'speech-bridge');

interface Run {
    id: string;
    ready: boolean;
    stopping: boolean;
    resolve(): void;
    reject(error: Error): void;
    deadline: ReturnType<typeof setTimeout>;
}

export class SpeechService {
    readonly #helper: string;
    readonly #model: string;
    readonly #cache: string;
    readonly #emit: (event: SpeechEvent) => void;
    readonly #createProcess: typeof spawn;
    readonly #setTimeout: typeof setTimeout;
    readonly #clearTimeout: typeof clearTimeout;
    #child: ChildProcessWithoutNullStreams | null = null;
    #run: Run | null = null;
    #idle: ReturnType<typeof setTimeout> | null = null;

    constructor(
        helper: string,
        model: string,
        cache: string,
        emit: (event: SpeechEvent) => void,
        createProcess: typeof spawn = spawn,
        timers = { setTimeout, clearTimeout }
    ) {
        this.#helper = helper;
        this.#model = model;
        this.#cache = cache;
        this.#emit = emit;
        this.#createProcess = createProcess;
        this.#setTimeout = timers.setTimeout;
        this.#clearTimeout = timers.clearTimeout;
    }

    #spawn(): ChildProcessWithoutNullStreams {
        const child = this.#createProcess(this.#helper, ['serve', '--model', this.#model, '--cache', this.#cache], { stdio: ['pipe', 'pipe', 'pipe'] });
        this.#child = child;
        let buffer = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (text: string) => {
            stderr = (stderr + text).slice(-4000);
        });
        child.stdout.on('data', (text: string) => {
            if (this.#child !== child) {
                return;
            }
            buffer += text;
            if (buffer.length > 1_000_000) {
                this.#fail('Speech helper sent an oversized message');
                return;
            }
            let newline: number;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                try {
                    this.#event(JSON.parse(line));
                } catch {
                    this.#fail('Speech helper sent an invalid message');
                    return;
                }
            }
        });
        const failed = (message: string): void => {
            if (this.#child !== child) {
                return;
            }
            this.#fail(message);
        };
        child.on('error', (error) => failed(error.message));
        child.stdin.on('error', (error) => failed(error.message));
        child.on('close', (code, signal) => {
            const reason = signal ? `signal ${signal}` : `exit code ${code}`;
            failed(stderr.trim().split('\n').at(-1) || `Speech helper stopped unexpectedly (${reason})`);
        });
        return child;
    }

    #event(value: unknown): void {
        if (!value || typeof value !== 'object') {
            throw new Error('Invalid speech event');
        }
        const event = value as Record<string, unknown>;
        const run = this.#run;
        if (!run || event.sessionId !== run.id) {
            return;
        }
        if (event.type === 'ready') {
            this.#clearTimeout(run.deadline);
            run.ready = true;
            // Ten minutes also bounds silence and a renderer that disappears without cleaning up.
            run.deadline = this.#setTimeout(() => this.#fail('Dictation exceeded ten minutes'), 600_000);
            run.resolve();
            this.#emit({ type: 'ready', sessionId: run.id });
        } else if (event.type === 'transcript' && typeof event.text === 'string' && typeof event.final === 'boolean') {
            this.#emit({ type: 'transcript', sessionId: run.id, text: event.text, final: event.final });
        } else if (event.type === 'ended') {
            this.#complete();
            this.#emit({ type: 'ended', sessionId: run.id });
        } else if (event.type === 'failed' && typeof event.message === 'string') {
            this.#fail(event.message);
        } else {
            throw new Error('Invalid speech event');
        }
    }

    #complete(): void {
        if (this.#run) {
            this.#clearTimeout(this.#run.deadline);
        }
        this.#run = null;
        if (this.#idle) {
            this.#clearTimeout(this.#idle);
        }
        this.#idle = this.#setTimeout(() => this.dispose(), 60_000);
    }

    #fail(message: string): void {
        const run = this.#run;
        if (run) {
            run.reject(new Error(message));
            this.#emit({ type: 'failed', sessionId: run.id, message });
        }
        this.dispose();
    }

    #write(value: object): Promise<void> {
        const child = this.#child;
        if (!child || !child.stdin.writable) {
            return Promise.reject(new Error('Speech helper is unavailable'));
        }
        if (child.stdin.writableLength > 1_000_000) {
            this.#fail('Speech recognition cannot keep up with the microphone');
            return Promise.reject(new Error('Speech recognition cannot keep up with the microphone'));
        }
        return new Promise((resolve, reject) => child.stdin.write(`${JSON.stringify(value)}\n`, (error) => (error ? reject(error) : resolve())));
    }

    async start(id: string, language: string): Promise<void> {
        if (!/^[\w-]{1,100}$/.test(id) || !/^[\w-]{1,30}$/.test(language)) {
            throw new Error('Invalid dictation request');
        }
        if (this.#run) {
            throw new Error('Another dictation is running');
        }
        if (this.#idle) {
            this.#clearTimeout(this.#idle);
            this.#idle = null;
        }
        const ready = new Promise<void>((resolve, reject) => {
            this.#run = {
                id,
                ready: false,
                stopping: false,
                resolve,
                reject,
                deadline: this.#setTimeout(() => this.#fail('Speech model took too long to load'), 120_000)
            };
        });
        if (!this.#child) {
            this.#spawn();
        }
        const run = this.#run;
        void this.#write({ type: 'start', sessionId: id, language }).catch((error: Error) => {
            if (this.#run === run) {
                this.#fail(error.message);
            }
        });
        return ready;
    }

    async samples(id: string, samples: unknown): Promise<void> {
        if (!this.#run || this.#run.id !== id || !this.#run.ready || this.#run.stopping) {
            return;
        }
        if (!(samples instanceof Float32Array) || samples.length > 16000 || samples.some((sample) => !Number.isFinite(sample))) {
            throw new Error('Invalid microphone samples');
        }
        const audio = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
        await this.#write({ type: 'samples', sessionId: id, audio });
    }

    async stop(id: string): Promise<void> {
        const run = this.#run;
        if (!run || run.id !== id || run.stopping) {
            return;
        }
        if (!run.ready) {
            this.cancel(id);
            return;
        }
        run.stopping = true;
        this.#clearTimeout(run.deadline);
        run.deadline = this.#setTimeout(() => this.#fail('Speech recognition did not finish'), 30_000);
        await this.#write({ type: 'stop', sessionId: id });
    }

    cancel(id: string): void {
        if (this.#run?.id !== id) {
            return;
        }
        this.dispose();
    }

    dispose(): void {
        const run = this.#run;
        this.#run = null;
        if (run) {
            this.#clearTimeout(run.deadline);
            run.reject(new Error('Dictation cancelled'));
        }
        if (this.#idle) {
            this.#clearTimeout(this.#idle);
            this.#idle = null;
        }
        const child = this.#child;
        this.#child = null;
        child?.kill();
        if (run) {
            this.#emit({ type: 'ended', sessionId: run.id });
        }
    }
}
