import { hostname } from 'node:os';

export const pairingUrl = (host: string, port: number, token: string): string => {
    // A daemon bound to every interface is reached by the machine's name; the token rides in the fragment, which never hits a log.
    const reachableHost = host === '0.0.0.0' || host === '::' ? hostname() : host;
    return `http://${reachableHost}:${port}/pair#${token}`;
};

/* `ruimte pair`: asks the daemon already running on this machine for a fresh pairing URL; tokens never travel as arguments. */
export const runPair = async (port: number): Promise<number> => {
    const response = await fetch(`http://127.0.0.1:${port}/auth/pairing-token`, { method: 'POST' }).catch(() => null);
    if (!response || !response.ok) {
        console.error(`No daemon answers on port ${port}; start one first.`);
        return 1;
    }
    const { url } = (await response.json()) as { url: string };
    console.log(`Open this in the Ruimte app on the other machine within ten minutes:\n${url}`);
    return 0;
};
