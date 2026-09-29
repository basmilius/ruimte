import type { GitRepo, LaunchConfigEntry, LaunchesDocument, LaunchStatus } from '@ruimte/contracts';

/*
 * What a launch looks like from here. A launch a person stopped, or a service that ended cleanly on
 * its own, is at rest again; only an exit that went wrong stays red until the next start.
 */
export type LaunchPhase = 'idle' | 'held' | 'starting' | 'running' | 'stopping' | 'passed' | 'failed';

export interface LaunchView {
    launch: LaunchConfigEntry;
    phase: LaunchPhase;
    /* A process of it runs, or is being stopped. */
    live: boolean;
    /* Its own status; a group has none and reads its members'. */
    status: LaunchStatus | null;
    exitCode: number | null;
    /* The port it answers on once running. */
    port: number | null;
}

export const EMPTY_DOCUMENT: LaunchesDocument = { rev: 0, launches: [], approved: [] };

const isLive = (status: LaunchStatus | undefined): boolean => status !== undefined && status.state !== 'exited';

const endedPhase = (status: LaunchStatus): LaunchPhase => {
    if (status.stopped) {
        return 'idle';
    }
    if (status.kind === 'task') {
        return status.exitCode === 0 ? 'passed' : 'failed';
    }
    return status.exitCode === 0 ? 'idle' : 'failed';
};

const singleView = (launch: LaunchConfigEntry, status: LaunchStatus | undefined, approved: boolean): LaunchView => {
    if (status !== undefined && isLive(status)) {
        return { launch, phase: status.state as LaunchPhase, live: true, status, exitCode: null, port: status.port };
    }
    if (!approved) {
        return { launch, phase: 'held', live: false, status: status ?? null, exitCode: status?.exitCode ?? null, port: null };
    }
    if (status === undefined) {
        return { launch, phase: 'idle', live: false, status: null, exitCode: null, port: null };
    }
    return { launch, phase: endedPhase(status), live: false, status, exitCode: status.exitCode, port: null };
};

/* A group runs while one of its members does; a failed member makes it red once none runs. */
const groupView = (launch: LaunchConfigEntry, members: readonly LaunchView[], approved: boolean): LaunchView => {
    const live = members.filter((member) => member.live);
    if (live.length > 0) {
        const phase = live.some((member) => member.phase === 'starting')
            ? 'starting'
            : live.some((member) => member.phase === 'stopping')
              ? 'stopping'
              : 'running';
        return { launch, phase, live: true, status: null, exitCode: null, port: null };
    }
    if (!approved) {
        return { launch, phase: 'held', live: false, status: null, exitCode: null, port: null };
    }
    const failed = members.find((member) => member.phase === 'failed');
    if (failed !== undefined) {
        return { launch, phase: 'failed', live: false, status: null, exitCode: failed.exitCode, port: null };
    }
    return { launch, phase: 'idle', live: false, status: null, exitCode: null, port: null };
};

/* Every launch of a project with its state, by id. */
export const launchViews = (document: LaunchesDocument, statuses: Readonly<Record<string, LaunchStatus>>): Map<string, LaunchView> => {
    const approved = new Set(document.approved);
    const views = new Map<string, LaunchView>();
    for (const launch of document.launches) {
        if (launch.kind !== 'group') {
            views.set(launch.id, singleView(launch, statuses[launch.id], approved.has(launch.id)));
        }
    }
    for (const launch of document.launches) {
        if (launch.kind === 'group') {
            const members = (launch.launches ?? []).flatMap((id) => views.get(id) ?? []);
            views.set(launch.id, groupView(launch, members, approved.has(launch.id)));
        }
    }
    return views;
};

/* The members a group starts, as launches this document still has. */
export const membersOf = (launch: LaunchConfigEntry, document: LaunchesDocument): LaunchConfigEntry[] =>
    (launch.launches ?? []).flatMap((id) => document.launches.find((candidate) => candidate.id === id && candidate.kind !== 'group') ?? []);

/* The launch the chip shows: the one this client chose, else the first of the menu. */
export const chosenLaunch = (document: LaunchesDocument, chosenId: string | undefined): LaunchConfigEntry | null =>
    document.launches.find((launch) => launch.id === chosenId) ?? document.launches[0] ?? null;

/*
 * What runs beside the launch on the chip, or ended badly: the `+1`. A group counts through its
 * members, so a launch is never counted twice.
 */
export const othersOf = (views: ReadonlyMap<string, LaunchView>, chosen: LaunchConfigEntry | null): { count: number; failed: boolean } => {
    const away = new Set([chosen?.id, ...(chosen?.launches ?? [])]);
    let count = 0;
    let failed = false;
    for (const view of views.values()) {
        if (view.launch.kind === 'group' || away.has(view.launch.id)) {
            continue;
        }
        if (view.live) {
            count += 1;
        } else if (view.phase === 'failed') {
            count += 1;
            failed = true;
        }
    }
    return { count, failed };
};

export interface LaunchSection {
    /* The checkout the launches run in; null for the ones in the project folder itself, which go first. */
    label: string | null;
    launches: LaunchConfigEntry[];
}

const trimSlashes = (path: string): string => path.replace(/\/+$/, '');

/* Where a launch runs, absolute. A private overlay may name a folder of its own. */
export const launchFolder = (launch: LaunchConfigEntry, folder: string): string => {
    const cwd = (launch.overlay?.cwd ?? launch.cwd ?? '').trim();
    if (cwd.startsWith('/')) {
        return trimSlashes(cwd);
    }
    const relative = cwd.replace(/^\.\/?/, '');
    return relative === '' ? trimSlashes(folder) : `${trimSlashes(folder)}/${trimSlashes(relative)}`;
};

/*
 * The menu's launches, grouped by the checkout they run in, the way the git panel groups a folder of
 * repositories. A group and a launch in the project folder itself come first under no heading; a
 * folder with one checkout has no headings at all.
 */
export const launchSections = (launches: readonly LaunchConfigEntry[], folder: string, repos: readonly GitRepo[]): LaunchSection[] => {
    const root = trimSlashes(folder);
    const inner = repos.filter((repo) => trimSlashes(repo.path) !== root).sort((one, other) => other.path.length - one.path.length);
    const loose: LaunchConfigEntry[] = [];
    const byRepo = new Map<string, LaunchConfigEntry[]>();
    for (const launch of launches) {
        const at = launch.kind === 'group' ? root : launchFolder(launch, root);
        const repo = inner.find((candidate) => at === trimSlashes(candidate.path) || at.startsWith(`${trimSlashes(candidate.path)}/`));
        if (repo === undefined) {
            loose.push(launch);
        } else {
            byRepo.set(repo.path, [...(byRepo.get(repo.path) ?? []), launch]);
        }
    }
    const sections: LaunchSection[] = [];
    if (loose.length > 0) {
        sections.push({ label: null, launches: loose });
    }
    for (const repo of repos) {
        const found = byRepo.get(repo.path);
        if (found !== undefined) {
            sections.push({ label: repo.label, launches: found });
        }
    }
    if (sections.length === 1) {
        return [{ label: null, launches: sections[0]!.launches }];
    }
    return sections;
};

/* An address as a person reads it in a row: the host and port, without the scheme. */
export const shortAddress = (url: string): string => url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');

/*
 * The launch whose terminal the panel shows for the one chosen. A group has no session of its own,
 * so it shows a member: one that runs, else one that failed, else the first that ran at all.
 */
export const outputOf = (views: ReadonlyMap<string, LaunchView>, launch: LaunchConfigEntry): LaunchView | null => {
    if (launch.kind !== 'group') {
        return views.get(launch.id) ?? null;
    }
    const members = (launch.launches ?? []).flatMap((id) => views.get(id) ?? []);
    return (
        members.find((member) => member.live) ??
        members.find((member) => member.phase === 'failed') ??
        members.find((member) => member.status !== null) ??
        members[0] ??
        null
    );
};
