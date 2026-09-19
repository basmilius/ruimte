/*
 * Where a background service can run. The dev app never gets one: it runs its own daemon on 4211
 * with ~/.ruimte-dev beside an installed Ruimte, and a service of its own would be a second daemon
 * that outlives every `bun dev`. An AppImage runs from a mount that is gone once the app quits, so a
 * service pointing into it would start nothing. Windows has no service yet.
 */
export type ServiceSupport = 'supported' | 'dev' | 'windows' | 'appimage';

/* Who runs the daemon the window talks to. `external` is one the app found answering and does not manage. */
export type DaemonOwner = 'service' | 'app' | 'external';

/*
 * The service runs an older build and work was running on it, so the app attached instead of
 * restarting. `work` is what a restart ends (null when the daemon cannot say), `answered` whether
 * the person already picked "When idle".
 */
export interface PendingRestart {
    work: number | null;
    answered: boolean;
}

/* The background service of this machine, as the client draws it in the machine dialog. */
export interface BackgroundServiceState {
    support: ServiceSupport;
    /* "Keep this machine running when Ruimte quits". Always false where the service is not supported. */
    keepRunning: boolean;
    /* Null while the start has not settled. */
    owner: DaemonOwner | null;
    /* Why the service did not take the daemon this time, when the app fell back to its own. */
    failure: string | null;
    /* Linux only: whether the person's services outlive their session. Null elsewhere. */
    linger: boolean | null;
    /* Null once the new build runs. Absent from a shell older than the field, which is why the page has to read it as optional. */
    pendingRestart?: PendingRestart | null;
}

/*
 * The same state as the shell builds it. Every field this release knows is there, so a missing
 * `pendingRestart` inside the shell is a mistake rather than an older preload.
 */
export type ShellServiceState = Required<BackgroundServiceState>;
