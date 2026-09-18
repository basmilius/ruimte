/* What `/health` says about the daemon behind the port, and what the app expects to find there. */
export interface BuildIdentity {
    version: string;
    /* The native compile script stamps this id into the binary; null in a checkout or an older daemon. */
    build: string | null;
}

/* What the app does on start, once it asked the port. */
export type StartDecision =
    /* The service runs the binary in this bundle. */
    | 'attach'
    /* Something answers that is not the service's to manage (the service is off): used as it is, as before. */
    | 'attach-external'
    /* The service runs an older binary, after an update: restarted onto the new one. */
    | 'restart-service'
    | 'start-service'
    /* No service: the app starts its own daemon, as it always did. */
    | 'spawn';

export const healthFrom = (body: unknown): BuildIdentity | null => {
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const { ok, version, build } = body as Record<string, unknown>;
    if (ok !== true || typeof version !== 'string') {
        return null;
    }
    return { version, build: typeof build === 'string' && build !== '' ? build : null };
};

/*
 * Two builds are the same when their ids match. Only when either side has none does the version
 * decide: a local compile of 0.0.0 is not the previous local compile of 0.0.0, and the id says so.
 */
export const sameBuild = (running: BuildIdentity, expected: BuildIdentity): boolean => {
    if (running.build !== null && expected.build !== null) {
        return running.build === expected.build;
    }
    if (expected.build !== null) {
        return false;
    }
    return running.version === expected.version;
};

/* What a restart would end, from the daemon's `/machine/work`. */
export interface MachineWork {
    terminals: number;
    agents: number;
}

// Older daemons return 404 because they do not have this route.
export const workFrom = (body: unknown): MachineWork | null => {
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const { terminals, agents } = body as Record<string, unknown>;
    const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
    return count(terminals) && count(agents) ? { terminals, agents } : null;
};

/*
 * An older build under the service: restarted at once when nothing runs, asked about otherwise. A
 * daemon that cannot say what runs is asked about too, since a silent restart is the thing to avoid.
 */
export const decideRestart = (work: MachineWork | null): 'restart' | 'ask' => (work !== null && work.terminals === 0 && work.agents === 0 ? 'restart' : 'ask');

export const decideStart = (health: BuildIdentity | null, expected: BuildIdentity, serviceOn: boolean): StartDecision => {
    if (health === null) {
        return serviceOn ? 'start-service' : 'spawn';
    }
    if (!serviceOn) {
        return 'attach-external';
    }
    return sameBuild(health, expected) ? 'attach' : 'restart-service';
};
