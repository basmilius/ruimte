import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';
import { readLocalSecret } from '../auth/local-secret.ts';
import { CodedError } from '../coded-error.ts';
import { HelperReplySchema, type HelperRequest } from './helper-protocol.ts';

export type HelperFailureCode = 'unavailable' | 'helper-unreachable' | 'helper-busy' | 'helper-error' | 'helper-invalid';

export class HelperFailure extends CodedError<HelperFailureCode> {
    /* The helper's own code for a refusal, when it gave one. */
    readonly helperCode: string | null;

    constructor(code: HelperFailureCode, message: string, helperCode: string | null = null) {
        super(code, message);
        this.helperCode = helperCode;
    }
}

/* Nothing listens on the socket: the helper is not running, or went away between two requests. */
export class HelperUnreachable extends Error {}

export interface HelperTransport {
    /* One request over one connection, answered with the helper's reply as it came. */
    send(request: HelperRequest): Promise<unknown>;
}

/* An action waits up to 5 s for a window and 3 s for the UI to settle, so past this the helper is stuck, not slow. */
const REQUEST_TIMEOUT_MS = 20_000;

/* `cu` gives a fresh helper the same time to open its socket. */
const START_WAIT_MS = 10_000;
const START_POLL_MS = 100;

export const helperDirectory = (home: string): string => join(home, 'computer-use');

export const helperSocketPath = (home: string): string => join(helperDirectory(home), 'agent.sock');

/*
 * Where the helper app is: in Ruimte.app two levels up from the daemon (`Contents/Resources/bin`), in
 * a checkout where `apps/computer-use` builds it. Null on any other platform and for a daemon from npm.
 */
export const locateHelperApp = (options: { platform: string; compiled: boolean; execPath: string; sourceDir: string }): string | null => {
    if (options.platform !== 'darwin') {
        return null;
    }
    const path = options.compiled
        ? join(dirname(options.execPath), '..', '..', 'Helpers', 'Ruimte Computer Use.app')
        : resolve(options.sourceDir, '..', '..', 'computer-use', 'dist', 'Ruimte Computer Use Dev.app');
    return existsSync(path) ? path : null;
};

/* One request per connection: write the JSON, half-close, read until the helper closes. */
export const socketTransport = (socketPath: string, timeoutMs: number = REQUEST_TIMEOUT_MS): HelperTransport => ({
    send: (request) =>
        new Promise<unknown>((settle, fail) => {
            const socket = connect(socketPath);
            const chunks: Buffer[] = [];
            let connected = false;
            socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`the computer use helper did not answer within ${timeoutMs / 1000} s`)));
            socket.on('connect', () => {
                connected = true;
                socket.end(JSON.stringify(request));
            });
            socket.on('data', (chunk: Buffer) => chunks.push(chunk));
            socket.on('error', (error: NodeJS.ErrnoException) => {
                if (!connected && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) {
                    fail(new HelperUnreachable(error.message));
                    return;
                }
                fail(error);
            });
            socket.on('close', () => {
                if (!connected) {
                    return;
                }
                const text = Buffer.concat(chunks).toString('utf8');
                try {
                    settle(JSON.parse(text));
                } catch {
                    fail(
                        new Error(
                            text === ''
                                ? 'the computer use helper closed the connection without an answer'
                                : 'the computer use helper answered with something that is not JSON'
                        )
                    );
                }
            });
        })
});

/* `open` hands the app to launchd, so it runs as the person's app and not as a child of the daemon. */
const openApp = async (appPath: string, home: string): Promise<void> => {
    const child = Bun.spawn(['open', '-g', appPath, '--args', '--home', home], { stdout: 'ignore', stderr: 'pipe' });
    const code = await child.exited;
    if (code !== 0) {
        const stderr = (await new Response(child.stderr).text()).trim();
        throw new Error(`open exited with ${code}${stderr === '' ? '' : `: ${stderr}`}`);
    }
};

export interface ComputerHelperOptions {
    home: string;
    /* The helper app; null on a machine that has none. */
    appPath: string | null;
    transport?: HelperTransport;
    launch?: (appPath: string, home: string) => Promise<void>;
    secret?: () => Promise<string | null>;
    sleep?: (ms: number) => Promise<void>;
    startWaitMs?: number;
}

/*
 * The daemon's side of the helper app: starts it on demand, puts the local secret on every request
 * and hands back what it answered, checked against a schema. It never keeps a connection open.
 */
export class ComputerHelper {
    readonly appPath: string | null;
    private readonly home: string;
    private readonly transport: HelperTransport;
    private readonly launch: (appPath: string, home: string) => Promise<void>;
    private readonly secret: () => Promise<string | null>;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly startWaitMs: number;
    private starting: Promise<void> | null = null;

    constructor(options: ComputerHelperOptions) {
        this.home = options.home;
        this.appPath = options.appPath;
        this.transport = options.transport ?? socketTransport(helperSocketPath(options.home));
        this.launch = options.launch ?? openApp;
        this.secret = options.secret ?? (() => readLocalSecret(options.home));
        this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
        this.startWaitMs = options.startWaitMs ?? START_WAIT_MS;
    }

    get present(): boolean {
        return this.appPath !== null;
    }

    /* Sends a request, starting the helper first when it is not running, and checks the result against `schema`. */
    async request<Schema extends z.ZodType>(request: HelperRequest, schema: Schema): Promise<z.infer<Schema>> {
        const reply = await this.deliver(request, true);
        return this.resultOf(reply, schema);
    }

    /* The same, but only to a helper that already runs; null when none does. */
    async ask<Schema extends z.ZodType>(request: HelperRequest, schema: Schema): Promise<z.infer<Schema> | null> {
        const reply = await this.deliver(request, false);
        return reply === null ? null : this.resultOf(reply, schema);
    }

    /* Stops a running helper; one that is not running stays that way. */
    async quit(): Promise<void> {
        await this.deliver({ command: 'quit' }, false).catch(() => null);
    }

    private resultOf<Schema extends z.ZodType>(reply: unknown, schema: Schema): z.infer<Schema> {
        const parsed = HelperReplySchema.safeParse(reply);
        if (!parsed.success) {
            throw new HelperFailure('helper-invalid', 'The computer use helper answered in a shape this machine does not know');
        }
        if (!parsed.data.ok) {
            const message = parsed.data.error;
            // The helper serves one home at a time and checks the secret of its own before anything else.
            if (message.startsWith('refused:')) {
                throw new HelperFailure(
                    'helper-busy',
                    'Ruimte Computer Use is running for another Ruimte on this Mac; it has to quit before this machine can use it'
                );
            }
            throw new HelperFailure('helper-error', message, parsed.data.code ?? null);
        }
        const result = schema.safeParse(parsed.data.result);
        if (!result.success) {
            throw new HelperFailure('helper-invalid', 'The computer use helper answered in a shape this machine does not know');
        }
        return result.data;
    }

    private async deliver(request: HelperRequest, start: boolean): Promise<unknown> {
        if (this.appPath === null) {
            throw new HelperFailure('unavailable', 'This machine has no Ruimte Computer Use: it comes with Ruimte for macOS');
        }
        const secret = await this.secret();
        if (secret === null) {
            throw new HelperFailure('helper-unreachable', `There is no local secret in ${this.home} yet`);
        }
        const signed = { ...request, secret };
        try {
            return await this.transport.send(signed);
        } catch (error) {
            if (!(error instanceof HelperUnreachable)) {
                throw new HelperFailure('helper-unreachable', error instanceof Error ? error.message : String(error));
            }
            if (!start) {
                return null;
            }
        }
        await this.start(this.appPath);
        return this.transport.send(signed).catch((error: unknown) => {
            throw new HelperFailure('helper-unreachable', error instanceof Error ? error.message : String(error));
        });
    }

    /* One launch for every request that finds the socket closed at the same moment. */
    private start(appPath: string): Promise<void> {
        this.starting ??= this.launchAndWait(appPath).finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    private async launchAndWait(appPath: string): Promise<void> {
        try {
            await this.launch(appPath, this.home);
        } catch (error) {
            throw new HelperFailure('helper-unreachable', `Ruimte Computer Use did not start: ${error instanceof Error ? error.message : String(error)}`);
        }
        const secret = await this.secret();
        for (let waited = 0; waited < this.startWaitMs; waited += START_POLL_MS) {
            try {
                await this.transport.send({ command: 'doctor', prompt: false, ...(secret === null ? {} : { secret }) });
                return;
            } catch (error) {
                if (!(error instanceof HelperUnreachable)) {
                    throw new HelperFailure('helper-unreachable', error instanceof Error ? error.message : String(error));
                }
            }
            await this.sleep(START_POLL_MS);
        }
        throw new HelperFailure(
            'helper-unreachable',
            `Ruimte Computer Use started but did not open its socket within ${this.startWaitMs / 1000} s; a copy running for another Ruimte keeps this one from starting`
        );
    }
}
