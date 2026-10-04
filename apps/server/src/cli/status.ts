import { readLocalSecret } from '../auth/local-secret.ts';
import { readMachineStatus, startFirst, statusLines } from './machine-status.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface StatusOptions {
    port: number;
    home: string;
    fetch?: Fetch;
    readSecret?: (home: string) => Promise<string>;
    out?: (line: string) => void;
    err?: (line: string) => void;
}

/*
 * `ruimte status`: how clients reach the daemon running on this machine, asked on the local secret of
 * its home. Exits 0 when it answers and 1 when it does not, so a script can wait on it.
 */
export async function runStatus(options: StatusOptions): Promise<number> {
    const out = options.out ?? ((line: string) => console.log(line));
    const err = options.err ?? ((line: string) => console.error(line));
    const secret = await (options.readSecret ?? readLocalSecret)(options.home).catch(() => null);
    if (secret === null) {
        err(`No daemon has started with ${options.home} as its home. ${startFirst(options.port)}`);
        return 1;
    }
    const answer = await readMachineStatus(options.port, secret, options.fetch ?? ((input, init) => fetch(input, init)));
    if ('problem' in answer) {
        switch (answer.problem) {
            case 'not-running':
                err(`No daemon answers on port ${options.port}. ${startFirst(options.port)}`);
                break;
            case 'other-home':
                err(`The daemon on port ${options.port} does not use ${options.home}; set RUIMTE_HOME to the home it was started with.`);
                break;
            case 'too-old':
                err(`The daemon on port ${options.port} is older than \`ruimte status\`; update it first.`);
                break;
        }
        return 1;
    }
    statusLines(answer.status, options.port).forEach(out);
    return 0;
}
