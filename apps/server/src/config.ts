import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export interface ServerConfig {
    host: string;
    port: number;
    home: string;
    // Whether to put the status hooks into the CLIs' settings files at startup.
    installHooks: boolean;
    // A built client to serve next to the socket, so one origin covers both.
    serve: string | null;
    // What this daemon calls itself towards clients.
    label: string;
    // Browser origins allowed on top of our own and loopback.
    allowedOrigins: string[];
    // Refuse even loopback clients without a token.
    requireToken: boolean;
    // `pair` asks the running daemon for a pairing URL; `context` is the agent-side CLI (`ruimte-context`).
    command: 'serve' | 'pair' | 'context';
    // What follows the command, for `context`.
    args: string[];
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4210;

export const parseServerArgs = (argv: string[], env: Record<string, string | undefined> = process.env): ServerConfig => {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            host: { type: 'string', default: DEFAULT_HOST },
            port: { type: 'string', default: String(DEFAULT_PORT) },
            'no-hooks': { type: 'boolean', default: false },
            serve: { type: 'string' },
            label: { type: 'string' },
            'allow-origin': { type: 'string', multiple: true, default: [] },
            'require-token': { type: 'boolean', default: false }
        },
        strict: true,
        allowPositionals: true
    });
    const command = positionals[0] ?? 'serve';
    if (command !== 'serve' && command !== 'pair' && command !== 'context') {
        throw new Error(`Unknown command: ${command}`);
    }

    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port: ${values.port}`);
    }

    return {
        host: values.host,
        port,
        home: env.RUIMTE_HOME ?? join(homedir(), '.ruimte'),
        installHooks: !values['no-hooks'],
        serve: values.serve ?? null,
        label: values.label ?? env.RUIMTE_LABEL ?? hostname(),
        allowedOrigins: values['allow-origin'],
        requireToken: values['require-token'],
        command,
        args: positionals.slice(1)
    };
};
