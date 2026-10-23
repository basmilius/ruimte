import { USAGE_CLIENT_KINDS, type UsageClientKind } from '@ruimte/contracts';
import {
    USAGE_VERB_COUNTERS,
    USAGE_VIEW_COUNTERS,
    usageModeOf,
    usageModelFamilyOf,
    usageProviderOf,
    type UsageReportCounter,
    type UsageReportTiming
} from '@ruimte/pulsar';
import { isOwner } from '../auth/access.ts';
import type { ClientAccess } from '../dispatcher.ts';
import type { UsageCounter } from './usage-counter.ts';

/*
 * Where every site of the daemon counts, with one call each. Nothing counts until the release build
 * installs a counter, and nothing while a person has the switch off; a call is then one integer.
 */

let installed: UsageCounter | null = null;
let enabled: () => boolean = () => false;

export function installUsageCounter(counter: UsageCounter | null, on: () => boolean = () => counter !== null): void {
    installed = counter;
    enabled = on;
}

export function countUsage(counter: UsageReportCounter): void {
    if (installed !== null && enabled()) {
        installed.count(counter);
    }
}

function countUsageOnce(counter: UsageReportCounter, key: string): void {
    if (installed !== null && enabled()) {
        installed.countOnce(counter, key);
    }
}

export function recordStartup(ms: number): void {
    if (installed !== null && enabled()) {
        installed.startup(ms);
    }
}

/* One sample of a timing, in milliseconds; the day sends their median. */
export function recordTiming(timing: UsageReportTiming, ms: number): void {
    if (installed !== null && enabled() && Number.isFinite(ms) && ms >= 0) {
        installed.sample(timing, Math.round(ms));
    }
}

// What a person asks over the wire that counts, beside what agents do through their verbs; only once it was answered.
const REQUEST_COUNTERS: Readonly<Record<string, readonly UsageReportCounter[]>> = {
    'browser.navigate': ['actions.browser'],
    'browser.command': ['actions.browser'],
    'device.boot': ['actions.device', 'devices.started'],
    'device.shutdown': ['actions.device'],
    'device.action': ['actions.device'],
    'device.capture': ['actions.device'],
    'device.record': ['actions.device'],
    'device.clipboard': ['actions.device'],
    'database.request': ['actions.database'],
    'computer.control': ['actions.computer'],
    'fs.write': ['files.saved'],
    'git.resolve': ['git.conflictsResolved'],
    'git.pr-watch': ['prWatches.started'],
    'voice.start': ['voice.sessions'],
    'peer.taskStart': ['peers.tasks']
};

// A git action as what it did; one that only fetches, checks out or branches counts nothing here.
const GIT_ACTION_COUNTERS: Readonly<Record<string, readonly UsageReportCounter[]>> = {
    commit: ['git.commits'],
    'commit-push': ['git.commits', 'git.pushes'],
    push: ['git.pushes'],
    'force-push': ['git.pushes'],
    publish: ['git.pushes'],
    pull: ['git.pulls'],
    sync: ['git.pulls', 'git.pushes']
};

function fieldOf(payload: unknown, name: string): unknown {
    return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[name] : undefined;
}

// The verbs that also count on the day itself: what an agent delegates, and what it does in a feature a person can use too.
const VERB_DAY_COUNTERS: Readonly<Record<string, UsageReportCounter>> = {
    agent: 'agents.delegated',
    team: 'teams.delegated',
    browser: 'actions.browser',
    device: 'actions.device',
    database: 'actions.database',
    computer: 'actions.computer'
};

const VERBS: ReadonlySet<string> = new Set(Object.keys(USAGE_VERB_COUNTERS));
const VIEW_KINDS: ReadonlySet<string> = new Set(Object.keys(USAGE_VIEW_COUNTERS));

/*
 * A request that was answered, with the payload it carried. A file read counts once per file a day, by a key that
 * stays in memory like every other `countOnce` key; a statement a person ran in a database view counts as a query.
 */
export function countRequest(type: string, payload?: unknown): void {
    for (const counter of REQUEST_COUNTERS[type] ?? []) {
        countUsage(counter);
    }
    if (type === 'git.action') {
        const kind = fieldOf(payload, 'kind');
        for (const counter of (typeof kind === 'string' ? GIT_ACTION_COUNTERS[kind] : undefined) ?? []) {
            countUsage(counter);
        }
    } else if (type === 'database.request' && fieldOf(payload, 'method') === 'execute') {
        countUsage('database.queries');
    } else if (type === 'fs.read') {
        const path = fieldOf(payload, 'path');
        if (typeof path === 'string') {
            countUsageOnce('files.opened', path);
        }
    }
}

/* A `ruimte-context` verb that ran. */
export function countVerb(name: string): void {
    if (VERBS.has(name)) {
        countUsage(`verbs.${name}` as UsageReportCounter);
    }
    const day = VERB_DAY_COUNTERS[name];
    if (day !== undefined) {
        countUsage(day);
    }
}

export function countChatStarted(provider: string): void {
    countUsage(`chats.${usageProviderOf(provider)}`);
}

/* A turn a chat started: by provider, by the family of its model when it named one, and by the mode it ran in. */
export function countTurn(provider: string, model?: string | null, mode?: string | null): void {
    countUsage(`turns.${usageProviderOf(provider)}`);
    if (model) {
        countUsage(`turns.model.${usageModelFamilyOf(model)}`);
    }
    const counted = mode ? usageModeOf(mode) : null;
    if (counted !== null) {
        countUsage(`turns.mode.${counted}`);
    }
}

/* A turn that stopped on a usage limit of its provider. */
export function countLimit(provider: string): void {
    countUsage(`limits.${usageProviderOf(provider)}`);
}

/* The time from a turn's start to its first words, per provider. */
export function recordFirstToken(provider: string, ms: number): void {
    recordTiming(`firstTokenMs.${usageProviderOf(provider)}`, ms);
}

function isClientKind(kind: string): kind is UsageClientKind {
    return (USAGE_CLIENT_KINDS as readonly string[]).includes(kind);
}

/*
 * A client that came in from elsewhere, once per UTC day by the session its key proved, so a reconnect
 * does not count again: a machine working here as a peer, or an app that named itself. The app on this
 * machine, on the local secret, is not a remote client.
 */
export function countClient(access: ClientAccess | undefined, kind: string | undefined): void {
    if (access === undefined || isOwner(access)) {
        return;
    }
    if (access.peer !== undefined) {
        countUsageOnce('clients.peer', access.peer.machineId);
        return;
    }
    if (kind !== undefined && isClientKind(kind) && access.sessionId !== null) {
        countUsageOnce(`clients.${kind}`, access.sessionId);
    }
}

/* A project a client opened, once per UTC day, so the open a client repeats after a reconnect does not count again. */
export function countProjectOpened(projectId: string): void {
    countUsageOnce('projects.opened', projectId);
}

/*
 * A view a client put on screen, told by the active view of its local state: each view of a project
 * counts once per UTC day, however often a client comes back to it or saves its camera.
 */
export function countViewShown(projectId: string, viewId: string | null, kindOf: (viewId: string) => string | null): void {
    if (viewId === null) {
        return;
    }
    const kind = kindOf(viewId);
    if (kind !== null && VIEW_KINDS.has(kind)) {
        countUsageOnce(`views.${kind}` as UsageReportCounter, `${projectId}\n${viewId}`);
    }
}
