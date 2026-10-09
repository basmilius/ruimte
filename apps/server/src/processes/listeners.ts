import { execFile } from 'node:child_process';
import type { SessionPort } from '@ruimte/contracts';

export interface TcpListener {
    pid: number;
    port: number;
    host: SessionPort['host'];
    bindAddress: string;
}

export interface ListenerProbe {
    read(pids: number[], signal: AbortSignal, port?: number): Promise<TcpListener[]>;
}

// lsof's field output avoids process names, spaces and localized column headings.
export function parseListeners(output: string): TcpListener[] {
    const listeners: TcpListener[] = [];
    let pid = 0;
    let files = 0;
    let file: { type?: string; name?: string; listening?: boolean } | null = null;
    const flush = (): void => {
        if (file === null) {
            return;
        }
        if (!pid || !file.name || !['IPv4', 'IPv6'].includes(file.type ?? '') || !file.listening) {
            throw new Error('Incomplete listener reading');
        }
        files++;
        const address = /^(\*|[\d.]+|\[[\da-fA-F:.]+(?:%[a-zA-Z0-9_.-]+)?\]):(\d+)$/.exec(file.name);
        if (!address || Number(address[2]) < 1 || Number(address[2]) > 65535) {
            throw new Error('Invalid listener address');
        }
        const host = address[1];
        listeners.push({ pid, port: Number(address[2]), host: file.type === 'IPv6' ? '[::1]' : '127.0.0.1', bindAddress: host! });
        file = null;
    };
    for (const line of output.split('\n')) {
        if (line === '') {
            continue;
        }
        const value = line.slice(1);
        switch (line[0]) {
            case 'p':
                flush();
                if (pid !== 0 && files === 0) {
                    throw new Error('Missing listener files');
                }
                files = 0;
                if (!/^\d+$/.test(value) || Number(value) < 1) {
                    throw new Error('Invalid listener process');
                }
                pid = Number(value);
                break;
            case 'f':
                flush();
                file = {};
                break;
            case 't':
                if (file) {
                    file.type = value;
                }
                break;
            case 'n':
                if (file) {
                    file.name = value;
                }
                break;
            case 'T':
                if (file && value === 'ST=LISTEN') {
                    file.listening = true;
                }
                break;
            default:
                throw new Error('Unexpected listener field');
        }
    }
    flush();
    if (output.trim() !== '' && (pid === 0 || files === 0)) {
        throw new Error('Invalid listener reading');
    }
    return listeners;
}

export class DarwinListenerProbe implements ListenerProbe {
    async read(pids: number[], signal: AbortSignal, port?: number): Promise<TcpListener[]> {
        if (pids.length === 0 || pids.length > 2048) {
            throw new Error('Listener scan exceeds its process budget');
        }
        const output = await new Promise<string>((resolve, reject) => {
            execFile(
                '/usr/sbin/lsof',
                // Read every owner of the destination, including processes outside the session tree.
                ['-nP', port === undefined ? '-iTCP' : `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pftnT'],
                { signal, timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } },
                (error, stdout, stderr) => {
                    // Exit 1 with no output is lsof's successful "no matching files" answer.
                    if (stderr.trim() !== '' || (error && !(error.code === 1 && stdout === '' && !error.killed))) {
                        reject(error ?? new Error(stderr));
                    } else {
                        resolve(stdout);
                    }
                }
            );
        });
        return parseListeners(output);
    }
}
