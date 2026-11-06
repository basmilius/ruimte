import { HealthResultSchema, MACHINE_HEALTH_PATH, type BuildIdentity } from '@ruimte/contracts';

/* What a daemon says about itself on `/health`. */
export interface MachineHealth extends BuildIdentity {
    /* Whether launchd, systemd or the Task Scheduler started it; null for a daemon from before `/health` said so. */
    service: boolean | null;
}

export interface HealthProbeOptions {
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    /* How long one ask may take, so a daemon that hangs is no answer rather than a wait that never ends. */
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;

/* Long enough for a daemon that is snapshotting its sessions on the way out of a restart. */
const DEFAULT_WAIT_MS = 20_000;

const POLL_MS = 25;

/* Whether a Ruimte daemon answers on the port of this computer, and which; null for no answer or for another program. */
export async function probeHealth(port: number, options: HealthProbeOptions = {}): Promise<MachineHealth | null> {
    const ask = options.fetch ?? fetch;
    try {
        const response = await ask(`http://127.0.0.1:${port}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
        const parsed = HealthResultSchema.safeParse(await response.json());
        if (!parsed.success) {
            return null;
        }
        return { version: parsed.data.version, build: parsed.data.build ?? null, service: parsed.data.service ?? null };
    } catch {
        return null;
    }
}

export interface HealthWaitOptions extends HealthProbeOptions {
    within?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/* Resolves once the port answers with a health `accept` takes; rejects when it does not within the time. */
export async function waitForHealth(port: number, accept: (health: MachineHealth) => boolean, options: HealthWaitOptions = {}): Promise<void> {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = now() + (options.within ?? DEFAULT_WAIT_MS);
    while (now() < deadline) {
        const health = await probeHealth(port, options);
        if (health !== null && accept(health)) {
            return;
        }
        await sleep(POLL_MS);
    }
    throw new Error('The background service did not come up');
}
