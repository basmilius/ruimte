import { readLocalSecret } from '../auth/local-secret.ts';
import { portFlag } from '../config.ts';

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/* What a command that asks the daemon of its home takes; the functions stand in for the real ones in a test. */
export interface LocalDaemonOptions {
    port: number;
    home: string;
    fetch?: Fetch;
    readSecret?: (home: string) => Promise<string>;
    out?: (line: string) => void;
    err?: (line: string) => void;
}

export function commandIo(options: LocalDaemonOptions): { fetcher: Fetch; out: (line: string) => void; err: (line: string) => void } {
    return {
        fetcher: options.fetch ?? fetch,
        out: options.out ?? ((line) => console.log(line)),
        err: options.err ?? ((line) => console.error(line))
    };
}

/* The local secret of the command's home; null when it cannot be read. */
export function homeSecret(options: LocalDaemonOptions): Promise<string | null> {
    return (options.readSecret ?? readLocalSecret)(options.home).catch(() => null);
}

/* One ask of the daemon on this computer under the local secret, with a JSON body when there is one; null when nothing answers. */
export function askLocalDaemon(
    options: Pick<LocalDaemonOptions, 'port' | 'fetch'>,
    secret: string,
    path: string,
    request: { method?: 'GET' | 'POST'; body?: unknown } = {}
): Promise<Response | null> {
    const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
    if (request.body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    return (options.fetch ?? fetch)(`http://127.0.0.1:${options.port}${path}`, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body)
    }).catch(() => null);
}

/* What a command tells a person whose daemon is not running. */
export function startFirst(port: number): string {
    const flag = portFlag(port);
    return `Start it with \`ruimte service install${flag}\`, or with \`ruimte${flag}\` in another terminal.`;
}

export function otherHome(options: LocalDaemonOptions): string {
    return `The daemon on port ${options.port} does not use ${options.home}; set RUIMTE_HOME to the home it was started with.`;
}

export function tooOld(port: number, command: string): string {
    return `The daemon on port ${port} is older than \`ruimte ${command}\`; update it first.`;
}
