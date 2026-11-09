export interface CloudflaredProcess {
    /* The exit code; resolves once, also after `stop`. */
    readonly exited: Promise<number>;
    /* Asks it to end with SIGTERM, which is the daemon's own restart of its child and never a signal to anything else. */
    stop(): void;
}

/* The one seam to a process: a test hands in a fake, and only the integration suite runs a real `cloudflared`. */
export interface CloudflaredRunner {
    /* `env` is added to the person's own environment; the tunnel token goes there and never on the command line. */
    start(binary: string, args: readonly string[], onLine: (line: string) => void, env?: Readonly<Record<string, string>>): CloudflaredProcess;
}

async function readLines(stream: ReadableStream<Uint8Array> | null, onLine: (line: string) => void): Promise<void> {
    if (stream === null) {
        return;
    }

    const decoder = new TextDecoder();
    let pending = '';

    for await (const chunk of stream) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';

        for (const line of lines) {
            onLine(line);
        }
    }

    if (pending !== '') {
        onLine(pending);
    }
}

export const spawnRunner: CloudflaredRunner = {
    start(binary, args, onLine, env) {
        const child = Bun.spawn([binary, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
        const output = Promise.all([readLines(child.stdout, onLine), readLines(child.stderr, onLine)]);

        return {
            exited: child.exited.then(async (code) => {
                await output.catch(() => undefined);

                return code;
            }),
            stop: () => {
                child.kill('SIGTERM');
            }
        };
    }
};
