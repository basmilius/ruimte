import type { AppleFoundationEvent, AppleFoundationRequest, OnDeviceGenerateResult, OnDevicePurpose, OnDeviceStatusResult } from '@ruimte/contracts';
import { AppleFoundationEventSchema } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import { ChatChild, type SpawnChatProcess } from '@ruimte/agents/chat/chat-process';
import { appleSiliconMac, helperCommand, probeAppleHelper } from '../providers/apple-helper.ts';
import { PURPOSES } from './instructions.ts';

export interface OnDeviceModelOptions {
    command?: () => string;
    supported?: () => boolean;
    probe?: typeof probeAppleHelper;
    spawn?: SpawnChatProcess;
    env?: Record<string, string | undefined>;
}

export interface OnDeviceRequest {
    readonly purpose: OnDevicePurpose;
    readonly prompt: string;
    /* The text so far, each time it grows. */
    readonly onText?: (text: string) => void;
}

interface Pending {
    readonly request: OnDeviceRequest;
    readonly settle: (result: OnDeviceGenerateResult) => void;
    readonly fail: (error: Error) => void;
}

/* How many generations may be out at once: the model answers them one after the other, so more only queue. */
const MAX_PENDING = 4;
const READY_TIMEOUT_MS = 15_000;
const UNSUPPORTED = 'On-device models need a Mac with Apple silicon.';

/*
 * The machine's own language model for one-shot requests, behind a helper process that is started with the
 * first request and kept until the daemon stops. The helper has no tools and opens no connection, so a
 * prompt reaches the model on this machine and nowhere else.
 */
export class OnDeviceModel {
    private readonly options: OnDeviceModelOptions;
    private child: ChatChild | null = null;
    private ready: Promise<void> | null = null;
    private readonly pending = new Map<string, Pending>();
    private sequence = 0;
    private disposed = false;
    private onReady: ((error: Error | null) => void) | null = null;

    constructor(options: OnDeviceModelOptions = {}) {
        this.options = options;
    }

    /* Probed on every call, since Apple Intelligence can be switched on or off while the daemon runs. */
    async status(): Promise<OnDeviceStatusResult> {
        if (!this.supported()) {
            return { available: false, reason: UNSUPPORTED };
        }
        try {
            const { result, exited } = await (this.options.probe ?? probeAppleHelper)((this.options.command ?? helperCommand)(), this.environment());
            if (result.type === 'availability' && exited === 0) {
                return result.available ? { available: true } : { available: false, reason: describeReason(result.reason) };
            }
            return { available: false, reason: result.type === 'startup.error' ? result.text : 'The on-device helper could not start.' };
        } catch {
            return { available: false, reason: 'The on-device helper is missing or could not start.' };
        }
    }

    /* The whole text once the model is done; `abort` ends it early, which answers `aborted`. */
    async generate(request: OnDeviceRequest, signal?: AbortSignal): Promise<OnDeviceGenerateResult> {
        if (signal?.aborted) {
            return { state: 'aborted', text: '' };
        }
        if (this.pending.size >= MAX_PENDING) {
            throw new CodedError('busy', 'The on-device model is busy with other requests.');
        }
        await this.start();
        if (signal?.aborted) {
            return { state: 'aborted', text: '' };
        }
        const id = `g${++this.sequence}`;
        const spec = PURPOSES[request.purpose];
        const outcome = new Promise<OnDeviceGenerateResult>((settle, fail) => {
            this.pending.set(id, { request, settle, fail });
        });
        signal?.addEventListener('abort', () => this.write({ type: 'cancel', id }), { once: true });
        this.write({ type: 'generate', id, instructions: spec.instructions, prompt: request.prompt, maxTokens: spec.maxTokens, temperature: spec.temperature });
        return outcome;
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.failAll(new CodedError('unavailable', 'The daemon is stopping.'));
        await this.child?.end();
    }

    private supported(): boolean {
        return (this.options.supported ?? appleSiliconMac)();
    }

    private environment(): Record<string, string | undefined> {
        return this.options.env ?? process.env;
    }

    private start(): Promise<void> {
        if (this.disposed) {
            return Promise.reject(new CodedError('unavailable', 'The daemon is stopping.'));
        }
        if (!this.supported()) {
            return Promise.reject(new CodedError('unavailable', UNSUPPORTED));
        }
        if (this.ready !== null) {
            return this.ready;
        }
        const ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => this.lose(new CodedError('unavailable', 'The on-device helper did not become ready.')), READY_TIMEOUT_MS);
            this.onReady = (error) => {
                clearTimeout(timer);
                this.onReady = null;
                if (error === null) {
                    resolve();
                } else {
                    reject(error);
                }
            };
            try {
                const child = new ChatChild({
                    command: [(this.options.command ?? helperCommand)(), '--oneshot'],
                    cwd: '/',
                    env: Object.fromEntries(Object.entries(this.environment()).filter((entry): entry is [string, string] => entry[1] !== undefined)),
                    ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
                    onExit: () => {
                        if (this.child === child) {
                            this.lose(new CodedError('failed', 'The on-device helper stopped.'));
                        }
                    }
                });
                this.child = child;
                void this.read(child.process.stdout);
            } catch {
                this.lose(new CodedError('unavailable', 'The on-device helper could not start.'));
            }
        });
        this.ready = ready;
        ready.catch(() => undefined);
        return ready;
    }

    /* The helper is gone or useless: whoever waits is told, and the next request starts a new one. */
    private lose(error: Error): void {
        const child = this.child;
        this.child = null;
        this.ready = null;
        this.onReady?.(error);
        this.failAll(error);
        void child?.end();
    }

    private failAll(error: Error): void {
        for (const entry of [...this.pending.values()]) {
            entry.fail(error);
        }
        this.pending.clear();
    }

    private write(request: AppleFoundationRequest): void {
        try {
            this.child?.process.stdin.write(`${JSON.stringify(request)}\n`);
            this.child?.process.stdin.flush();
        } catch {
            this.lose(new CodedError('failed', 'The on-device helper could not receive the request.'));
        }
    }

    private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for await (const chunk of stream) {
                buffer += decoder.decode(chunk, { stream: true });
                let end: number;
                while ((end = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, end);
                    buffer = buffer.slice(end + 1);
                    this.receive(AppleFoundationEventSchema.parse(JSON.parse(line)));
                }
            }
        } catch {
            this.lose(new CodedError('failed', 'The on-device helper sent something unreadable.'));
        }
    }

    private receive(event: AppleFoundationEvent): void {
        if (event.type === 'availability') {
            if (event.available) {
                this.onReady?.(null);
            } else {
                this.lose(new CodedError('unavailable', describeReason(event.reason)));
            }
            return;
        }
        if (event.type === 'startup.error') {
            this.lose(new CodedError('unavailable', event.text));
            return;
        }
        if (event.type === 'text.snapshot') {
            this.pending.get(event.id)?.request.onText?.(event.text);
            return;
        }
        if (event.type !== 'done') {
            return;
        }
        const entry = this.pending.get(event.id);
        if (entry === undefined) {
            return;
        }
        this.pending.delete(event.id);
        if (event.state === 'done') {
            entry.settle({ state: 'done', text: event.text ?? '' });
        } else if (event.state === 'aborted') {
            entry.settle({ state: 'aborted', text: '' });
        } else {
            entry.fail(new CodedError('failed', event.text ?? 'The on-device model could not answer.'));
        }
    }
}

/* The helper's reasons are the platform's own names; these say what a person can do about each. */
export function describeReason(reason: string | undefined): string {
    switch (reason) {
        case 'deviceNotEligible':
            return 'This Mac does not support Apple Intelligence.';
        case 'appleIntelligenceNotEnabled':
            return 'Apple Intelligence is turned off. Turn it on in System Settings.';
        case 'modelNotReady':
            return 'The on-device model is still downloading.';
        default:
            return reason === undefined || reason === '' ? 'The on-device model is unavailable.' : `The on-device model is unavailable: ${reason}.`;
    }
}
