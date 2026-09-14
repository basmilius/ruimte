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
    // Whether the daemon may ask LiteLLM for the price table; off leaves it on the bundled snapshot.
    priceFetch: boolean;
    // Whether a terminal agent's permission request may be answered from a client; off leaves every one to the CLI's own prompt.
    approvals: boolean;
    // `pair` asks the running daemon for a pairing URL; `context` is the agent-side CLI (`ruimte-context`).
    command: 'serve' | 'pair' | 'context';
    // What follows the command, for `context`.
    args: string[];
}

/*
 * What a session hands its shell. A daemon started from inside another daemon's terminal inherits
 * them, and its own sessions and usage probes would then report into that other daemon's node.
 */
export const SESSION_VARIABLES = ['RUIMTE_HOOK_URL', 'RUIMTE_HOOK_TOKEN', 'RUIMTE_CONTEXT_URL', 'RUIMTE_CONTEXT_TOKEN', 'RUIMTE_SESSION_ID'] as const;

/** Removes the variables of a session this process was started from; a daemon never belongs to one. */
export const forgetInheritedSession = (env: Record<string, string | undefined>): void => {
    for (const name of SESSION_VARIABLES) {
        delete env[name];
    }
};

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4210;

export const parseServerArgs = (argv: string[], env: Record<string, string | undefined> = process.env): ServerConfig => {
    // Everything after `context` belongs to the agent's CLI (`node note --text ...`), whose flags the daemon parses, not this.
    const cli = argv[0] === 'context';
    const { values, positionals } = parseArgs({
        args: cli ? argv.slice(0, 1) : argv,
        options: {
            host: { type: 'string', default: DEFAULT_HOST },
            port: { type: 'string', default: String(DEFAULT_PORT) },
            'no-hooks': { type: 'boolean', default: false },
            serve: { type: 'string' },
            label: { type: 'string' },
            'allow-origin': { type: 'string', multiple: true, default: [] },
            'no-price-fetch': { type: 'boolean', default: false },
            'no-approvals': { type: 'boolean', default: false }
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
        priceFetch: !values['no-price-fetch'],
        approvals: !values['no-approvals'],
        command,
        args: cli ? argv.slice(1) : positionals.slice(1)
    };
};
