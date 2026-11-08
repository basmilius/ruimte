/* A `cloudflared` the daemon started: its output line by line, and how it ended. */
export interface CloudflaredProcess {
    /* The exit code; resolves once, also after `stop`. */
    readonly exited: Promise<number>;
    /* Asks it to end with SIGTERM, which is the daemon's own restart of its child and never a signal to anything else. */
    stop(): void;
}

/* The one seam to a process: a test hands in a fake, and only the integration suite runs a real `cloudflared`. */
export interface CloudflaredRunner {
    start(binary: string, args: readonly string[], onLine: (line: string) => void): CloudflaredProcess;
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

/* Runs the real binary with the person's own environment, so `cloudflared` finds its login where it left it. */
export const spawnRunner: CloudflaredRunner = {
    start(binary, args, onLine) {
        const child = Bun.spawn([binary, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
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
