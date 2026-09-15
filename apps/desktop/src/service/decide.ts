/* What `/health` says about the daemon behind the port, and what the app expects to find there. */
export interface BuildIdentity {
    version: string;
    /* The id `apps/server/scripts/compile.ts` stamps into the binary; null in a checkout or an older daemon. */
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

/* The answer of `/health`, or null for anything that is not one. */
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

export const decideStart = (health: BuildIdentity | null, expected: BuildIdentity, serviceOn: boolean): StartDecision => {
    if (health === null) {
        return serviceOn ? 'start-service' : 'spawn';
    }
    if (!serviceOn) {
        return 'attach-external';
    }
    return sameBuild(health, expected) ? 'attach' : 'restart-service';
};
