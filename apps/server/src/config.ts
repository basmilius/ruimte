import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export interface ServerConfig {
    host: string;
    port: number;
    home: string;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4210;

export const parseServerArgs = (argv: string[], env: Record<string, string | undefined> = process.env): ServerConfig => {
    const { values } = parseArgs({
        args: argv,
        options: {
            host: { type: 'string', default: DEFAULT_HOST },
            port: { type: 'string', default: String(DEFAULT_PORT) }
        },
        strict: true
    });

    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port: ${values.port}`);
    }

    return {
        host: values.host,
        port,
        home: env.RUIMTE_HOME ?? join(homedir(), '.ruimte')
    };
};
