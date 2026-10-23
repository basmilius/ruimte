import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { USAGE_VERB_COUNTERS } from '@ruimte/pulsar';
import { VERBS } from '../canvas/verbs.ts';
import { UsageCounter } from './usage-counter.ts';
import {
    countClient,
    countLimit,
    countProjectOpened,
    countRequest,
    countTurn,
    countUsage,
    countVerb,
    countViewShown,
    installUsageCounter
} from './usage-stats.ts';

let counter: UsageCounter;
let on: boolean;
let clock: number;

function counts(): Record<string, number> {
    clock += 86_400_000;
    return counter.finished()[0]?.counts ?? {};
}

beforeEach(() => {
    clock = Date.parse('2026-10-14T10:00:00Z');
    on = true;
    counter = new UsageCounter({
        store: { read: async () => null, write: async () => undefined },
        describe: () => ({ version: '1.2.3', launcher: 'desktop' }),
        now: () => clock,
        schedule: () => () => undefined
    });
    installUsageCounter(counter, () => on);
});

afterEach(() => {
    installUsageCounter(null);
});

describe('counting at the sites', () => {
    test('counts nothing while the switch is off or no counter is installed', () => {
        on = false;
        countUsage('projects.opened');
        installUsageCounter(null);
        countUsage('projects.opened');
        expect(counts()).toEqual({});
    });

    test('every verb of ruimte-context counts in its group', () => {
        for (const verb of VERBS) {
            expect(Object.keys(USAGE_VERB_COUNTERS)).toContain(verb.name);
        }
    });

    test('a verb counts under its own name, and delegating and feature verbs on the day as well', () => {
        countVerb('agent');
        countVerb('team');
        countVerb('browser');
        countVerb('read');
        countVerb('no-such-verb');
        expect(counts()).toEqual({
            'verbs.agent': 1,
            'verbs.team': 1,
            'agents.delegated': 1,
            'teams.delegated': 1,
            'verbs.browser': 1,
            'actions.browser': 1,
            'verbs.read': 1
        });
    });

    test('a turn counts by provider, model family and mode, with anything unknown as other or left out', () => {
        countTurn('claude', 'claude-sonnet-5-5', 'full-access');
        countTurn('my-own-agent', 'my-finetune', 'yolo');
        countLimit('grok');
        expect(counts()).toEqual({
            'turns.claude': 1,
            'turns.model.sonnet': 1,
            'turns.mode.fullAccess': 1,
            'turns.other': 1,
            'turns.model.other': 1,
            'limits.grok': 1
        });
    });

    test('a request counts only when it is an action a person takes', () => {
        countRequest('device.action');
        countRequest('project.list');
        expect(counts()).toEqual({ 'actions.device': 1 });
    });

    test('a request counts what it did, from its payload where the type alone does not say', () => {
        countRequest('git.action', { kind: 'commit-push' });
        countRequest('git.action', { kind: 'sync' });
        countRequest('git.action', { kind: 'checkout' });
        countRequest('git.resolve', {});
        countRequest('git.pr-watch', {});
        countRequest('database.request', { id: 'd1', method: 'execute' });
        countRequest('database.request', { id: 'd2', method: 'tables' });
        countRequest('fs.write', { path: 'a.ts' });
        countRequest('device.boot', {});
        countRequest('voice.start', {});
        countRequest('peer.taskStart', {});
        expect(counts()).toEqual({
            'git.commits': 1,
            'git.pushes': 2,
            'git.pulls': 1,
            'git.conflictsResolved': 1,
            'prWatches.started': 1,
            'actions.database': 2,
            'database.queries': 1,
            'files.saved': 1,
            'actions.device': 1,
            'devices.started': 1,
            'voice.sessions': 1,
            'peers.tasks': 1
        });
    });

    test('a file read counts once per file a day, however often a client reads it again', () => {
        countRequest('fs.read', { path: '/work/a.ts' });
        countRequest('fs.read', { path: '/work/a.ts' });
        countRequest('fs.read', { path: '/work/b.ts' });
        expect(counts()).toEqual({ 'files.opened': 2 });
    });

    test('a project counts once a day, however often clients open it again', () => {
        countProjectOpened('p1');
        countProjectOpened('p1');
        countProjectOpened('p2');
        expect(counts()).toEqual({ 'projects.opened': 2 });
        countProjectOpened('p1');
        expect(counts()).toEqual({ 'projects.opened': 1 });
    });

    test('a client from elsewhere counts once a day by the session its key proved, by the kind it names', () => {
        const desktop = { reachability: 'tunnel', sessionId: 's1' } as const;
        countClient(desktop, 'desktop');
        // The same app after a reconnect, on a new socket.
        countClient({ ...desktop }, 'desktop');
        countClient({ reachability: 'tunnel', sessionId: 's2' }, 'ios');
        countClient({ reachability: 'tunnel', sessionId: 's5' }, 'ios');
        countClient({ reachability: 'tunnel', sessionId: 's3', peer: { machineId: 'm' } }, undefined);
        countClient({ reachability: 'lan', sessionId: 's3', peer: { machineId: 'm' } }, undefined);
        countClient({ reachability: 'loopback', sessionId: null }, 'desktop');
        countClient({ reachability: 'tunnel', sessionId: 's4' }, 'toaster');
        countClient(undefined, 'desktop');
        expect(counts()).toEqual({ 'clients.desktop': 1, 'clients.ios': 2, 'clients.peer': 1 });
        countClient(desktop, 'desktop');
        expect(counts()).toEqual({ 'clients.desktop': 1 });
    });

    test('each view of a project counts once a day, by its kind', () => {
        const kinds: Record<string, string> = { canvas: 'canvas', notes: 'file', line: 'separator' };
        const kindOf = (viewId: string): string | null => kinds[viewId] ?? null;
        countViewShown('p1', 'canvas', kindOf);
        countViewShown('p1', 'canvas', kindOf);
        countViewShown('p1', 'notes', kindOf);
        countViewShown('p1', null, kindOf);
        countViewShown('p1', 'canvas', kindOf);
        countViewShown('p1', 'line', kindOf);
        countViewShown('p2', 'canvas', kindOf);
        expect(counts()).toEqual({ 'views.canvas': 2, 'views.file': 1 });
        countViewShown('p1', 'canvas', kindOf);
        expect(counts()).toEqual({ 'views.canvas': 1 });
    });
});
