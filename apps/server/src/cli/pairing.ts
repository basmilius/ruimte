import { hostname } from 'node:os';
import { readLocalSecret } from '../auth/local-secret.ts';

export const pairingUrl = (host: string, port: number, token: string): string => {
    // A daemon bound to every interface is reached by the machine's name; the token rides in the fragment, which never hits a log.
    const reachableHost = host === '0.0.0.0' || host === '::' ? hostname() : host;
    return `http://${reachableHost}:${port}/pair#${token}`;
};

/*
 * `ruimte pair`: asks the daemon already running on this machine for a fresh pairing URL; tokens
 * never travel as arguments. Reading the home's local secret is what proves this runs on that
 * machine under that account, since the address the request comes from proves nothing.
 */
export const runPair = async (port: number, home: string): Promise<number> => {
    const secret = await readLocalSecret(home).catch(() => null);
    if (secret === null) {
        console.error(`No daemon has started with ${home} as its home; start one first.`);
        return 1;
    }
    const response = await fetch(`http://127.0.0.1:${port}/auth/pairing-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` }
    }).catch(() => null);
    if (!response) {
        console.error(`No daemon answers on port ${port}; start one first.`);
        return 1;
    }
    if (!response.ok) {
        console.error(`The daemon on port ${port} does not use ${home}; set RUIMTE_HOME to the home it was started with.`);
        return 1;
    }
    const { url } = (await response.json()) as { url: string };
    console.log(`Open this in the Ruimte app on the other machine within ten minutes:\n${url}`);
    return 0;
};
