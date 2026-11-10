export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

interface PipedChild {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
}

export async function collect(child: PipedChild): Promise<CommandResult> {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
}

export async function runCommand(command: string[], signal?: AbortSignal): Promise<CommandResult> {
    const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const abort = (): void => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
        abort();
    }
    try {
        return await collect(child);
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}
