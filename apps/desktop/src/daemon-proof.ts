import { isLocalProof, MACHINE_PROOF_PATH, MACHINE_WORK_PATH, machineWorkOf, type MachineWork } from '@ruimte/contracts';

/* The port the app's daemon is on, and what the shell needs to ask it. */
export interface DaemonPort {
    port: number;
    /* The local secret of the home the daemon runs with; null before the daemon wrote it. */
    readSecret(): Promise<string | null>;
    fetch(url: string, init: RequestInit): Promise<Response>;
    nonce(): string;
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
        const response = await daemon.fetch(`http://127.0.0.1:${daemon.port}${MACHINE_PROOF_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ nonce }),
            signal: AbortSignal.timeout(2000)
        });
        return response.ok && (await isLocalProof(await response.json(), secret, daemon.port, nonce)) ? secret : null;
    } catch {
        return null;
    }
}

export async function proveDaemon(daemon: DaemonPort): Promise<boolean> {
    return (await provenSecret(daemon)) !== null;
}

/* What a restart would end; null for a daemon that cannot prove the secret, one from before the route, or one that does not answer. */
export async function askDaemonWork(daemon: DaemonPort): Promise<MachineWork | null> {
    const secret = await provenSecret(daemon);
    if (secret === null) {
        return null;
    }
    try {
        const response = await daemon.fetch(`http://127.0.0.1:${daemon.port}${MACHINE_WORK_PATH}`, {
            headers: { authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(2000)
        });
        return response.ok ? machineWorkOf(await response.json()) : null;
    } catch {
        return null;
    }
}
