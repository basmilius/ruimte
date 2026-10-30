import {
    isLocalProof,
    MACHINE_HEALTH_PATH,
    MACHINE_PROOF_PATH,
    MACHINE_SHUTDOWN_PATH,
    MACHINE_VOICE_KEY_PATH,
    MACHINE_WORK_PATH,
    machineWorkOf,
    type MachineWork
} from '@ruimte/contracts';

/* The port the app's daemon is on, and what the shell needs to ask it. */
export interface DaemonPort {
    port: number;
    /* The local secret of the home the daemon runs with; null before the daemon wrote it. */
    readSecret(): Promise<string | null>;
    fetch(url: string, init: RequestInit): Promise<Response>;
    nonce(): string;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

// A health request that times out costs this many tries, so a hung daemon ends a stop within seconds.
const HUNG_TRY_COST = 10;

function ask(daemon: DaemonPort, path: string, init: RequestInit = {}): Promise<Response> {
    return daemon.fetch(`http://127.0.0.1:${daemon.port}${path}`, { ...init, signal: AbortSignal.timeout(2000) });
}

/*
 * The local secret, once whatever answers the port proved it holds it. Another account or a
 * container can take the port first and answer `/health` as a daemon does, so the shell sends the
 * secret, or loads a page that asks the bridge for it, only after this.
 */
async function provenSecret(daemon: DaemonPort): Promise<string | null> {
    try {
        const secret = await daemon.readSecret();
        if (secret === null) {
            return null;
        }
        const nonce = daemon.nonce();
        const response = await ask(daemon, MACHINE_PROOF_PATH, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ nonce }) });
        return response.ok && (await isLocalProof(await response.json(), secret, daemon.port, nonce)) ? secret : null;
    } catch {
        return null;
    }
}

/* The answer to a request that carries the secret, once the daemon proved it holds it; null when it did not, or did not answer. */
async function askWithSecret<T>(daemon: DaemonPort, path: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T | null> {
    const secret = await provenSecret(daemon);
    if (secret === null) {
        return null;
    }
    try {
        return await read(await ask(daemon, path, { ...init, headers: { authorization: `Bearer ${secret}`, ...init.headers } }));
    } catch {
        return null;
    }
}

export async function proveDaemon(daemon: DaemonPort): Promise<boolean> {
    return (await provenSecret(daemon)) !== null;
}

/* What a restart would end; null for a daemon that cannot prove the secret, one from before the route, or one that does not answer. */
export function askDaemonWork(daemon: DaemonPort): Promise<MachineWork | null> {
    return askWithSecret(daemon, MACHINE_WORK_PATH, {}, async (response) => (response.ok ? machineWorkOf(await response.json()) : null));
}

/*
 * Asks the daemon to stop and waits until the port stops answering, so it wrote what it holds before anything
 * ends it the hard way. A daemon that does not know the request, or is still busy past the tries, is left to that.
 */
export async function stopDaemonGently(daemon: DaemonPort, wait: () => Promise<void>, tries = 50): Promise<boolean> {
    const asked = await askWithSecret(daemon, MACHINE_SHUTDOWN_PATH, { method: 'POST' }, async (response) => response.ok);
    if (asked !== true) {
        return false;
    }
    let left = tries;
    while (left > 0) {
        try {
            await ask(daemon, MACHINE_HEALTH_PATH);
            left -= 1;
        } catch (e) {
            if (!(e instanceof DOMException && e.name === 'TimeoutError')) {
                return true;
            }
            left -= HUNG_TRY_COST;
        }
        await wait();
    }
    return false;
}

/* False when the daemon proved nothing or refused the key; the key then stays the shell's alone. */
export async function handVoiceKey(daemon: DaemonPort, key: string): Promise<boolean> {
    const handed = await askWithSecret(
        daemon,
        MACHINE_VOICE_KEY_PATH,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ key }) },
        async (response) => response.ok
    );
    return handed === true;
}
