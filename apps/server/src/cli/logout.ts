import { EndpointLeaveAccountResultSchema } from '@ruimte/contracts';
import { readLocalSecret } from '../auth/local-secret.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface LogoutOptions {
    port: number;
    home: string;
    fetch?: Fetch;
    readSecret?: (home: string) => Promise<string>;
    out?: (line: string) => void;
    err?: (line: string) => void;
}

/*
 * `ruimte logout`: takes this machine off its account, the way Settings, Machines does in the app on it,
 * for a machine without the app. Only the local secret may, so it runs where the daemon's home is.
 */
export async function runLogout(options: LogoutOptions): Promise<number> {
    const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
    const out = options.out ?? ((line: string) => console.log(line));
    const err = options.err ?? ((line: string) => console.error(line));
    const secret = await (options.readSecret ?? readLocalSecret)(options.home).catch(() => null);
    if (secret === null) {
        err(`No daemon has started with ${options.home} as its home; start one first.`);
        return 1;
    }
    const response = await fetcher(`http://127.0.0.1:${options.port}/machine/leave-account`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` }
    }).catch(() => null);
    if (!response) {
        err(`No daemon answers on port ${options.port}; start one first.`);
        return 1;
    }
    if (response.status === 404) {
        err(`The daemon on port ${options.port} is older than \`ruimte logout\`; update it first.`);
        return 1;
    }
    const parsed = response.ok ? EndpointLeaveAccountResultSchema.safeParse(await response.json().catch(() => null)) : null;
    if (!parsed) {
        err(`The daemon on port ${options.port} does not use ${options.home}; set RUIMTE_HOME to the home it was started with.`);
        return 1;
    }
    if (!parsed.success) {
        err(`The daemon on port ${options.port} answered with something this command cannot read.`);
        return 1;
    }
    const { revoked } = parsed.data;
    out(
        revoked === 0
            ? 'This machine is on no account now. `ruimte login` puts it on one.'
            : `This machine is on no account now, and ${revoked === 1 ? '1 client' : `${revoked} clients`} that came in through it lost access. \`ruimte login\` puts it on one.`
    );
    return 0;
}
