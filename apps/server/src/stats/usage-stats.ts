import { USAGE_CLIENT_KINDS, type AgentKind, type UsageClientKind } from '@ruimte/contracts';
import { USAGE_CHAT_COUNTERS, USAGE_VERB_COUNTERS, USAGE_VIEW_COUNTERS, type UsageCounter as UsageCounterName } from '@ruimte/pulsar';
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

export function countUsage(counter: UsageCounterName): void {
    if (installed !== null && enabled()) {
        installed.count(counter);
    }
}

function countUsageOnce(counter: UsageCounterName, key: string): void {
    if (installed !== null && enabled()) {
        installed.countOnce(counter, key);
    }
}

export function recordStartup(ms: number): void {
    if (installed !== null && enabled()) {
        installed.startup(ms);
    }
}

// What a person asks over the wire that counts as an action, beside what agents do through their verbs.
const REQUEST_COUNTERS: Readonly<Record<string, UsageCounterName>> = {
    'browser.navigate': 'browserActions',
    'browser.command': 'browserActions',
    'device.boot': 'deviceActions',
    'device.shutdown': 'deviceActions',
    'device.action': 'deviceActions',
    'device.capture': 'deviceActions',
    'device.record': 'deviceActions',
    'device.clipboard': 'deviceActions',
    'database.request': 'databaseActions',
    'computer.control': 'computerActions'
};

// The verbs that also count on the day itself: what an agent delegates, and what it does in a feature a person can use too.
const VERB_DAY_COUNTERS: Readonly<Record<string, UsageCounterName>> = {
    agent: 'agentsDelegated',
    team: 'teamsDelegated',
    browser: 'browserActions',
    device: 'deviceActions',
    database: 'databaseActions',
    computer: 'computerActions'
};

const CLIENT_COUNTERS: Readonly<Record<UsageClientKind, UsageCounterName>> = {
    desktop: 'clientsDesktop',
    ios: 'clientsIos',
    station: 'clientsStation'
};

/* A request that was answered. */
export function countRequest(type: string): void {
    const counter = REQUEST_COUNTERS[type];
    if (counter !== undefined) {
        countUsage(counter);
    }
}

/* A `ruimte-context` verb that ran. */
export function countVerb(name: string): void {
    const group = (USAGE_VERB_COUNTERS as Readonly<Record<string, UsageCounterName>>)[name];
    if (group !== undefined) {
        countUsage(group);
    }
    const day = VERB_DAY_COUNTERS[name];
    if (day !== undefined) {
        countUsage(day);
    }
}

function chatCountersOf(provider: AgentKind): { chats: UsageCounterName; turns: UsageCounterName } | undefined {
    return (USAGE_CHAT_COUNTERS as Partial<Record<AgentKind, { chats: UsageCounterName; turns: UsageCounterName }>>)[provider];
}

export function countChatStarted(provider: AgentKind): void {
    const counters = chatCountersOf(provider);
    if (counters !== undefined) {
        countUsage(counters.chats);
    }
}

export function countTurn(provider: AgentKind): void {
    const counters = chatCountersOf(provider);
    if (counters !== undefined) {
        countUsage(counters.turns);
    }
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
        countUsageOnce('clientsPeer', access.peer.machineId);
        return;
    }
    if (kind !== undefined && isClientKind(kind) && access.sessionId !== null) {
        countUsageOnce(CLIENT_COUNTERS[kind], access.sessionId);
    }
}

/* A project a client opened, once per UTC day, so the open a client repeats after a reconnect does not count again. */
export function countProjectOpened(projectId: string): void {
    countUsageOnce('projectsOpened', projectId);
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
    const counter = kind === null ? undefined : (USAGE_VIEW_COUNTERS as Readonly<Record<string, UsageCounterName>>)[kind];
    if (counter !== undefined) {
        countUsageOnce(counter, `${projectId}\n${viewId}`);
    }
}
