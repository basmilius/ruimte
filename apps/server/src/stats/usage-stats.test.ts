import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONTEXT_VERBS } from '@ruimte/contracts';
import { USAGE_VERB_COUNTERS } from '@ruimte/pulsar';
import { AGENT_TOOLKITS as TOOLKITS } from '../agent-features/list.ts';
import type { CanvasHost } from '../canvas/host.ts';
import { guideTool } from '../mcp/guide.ts';
import { toolCall } from '../tools/tool-test-helpers.ts';
import { runTool } from '../tools/tool.ts';
import { UsageCounter } from './usage-counter.ts';
import {
    countClient,
    countLimit,
    countProjectOpened,
    countUsages,
    countTurn,
    countUsage,
    countToolCall,
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

    // A counter the client does not know reads as plain "Ruimte" in a chat.
    test('every tool counts in a usage group, under a name the client knows', () => {
        const counters = new Set([guideTool(TOOLKITS), ...TOOLKITS.flatMap((toolkit) => toolkit.tools)].map((tool) => tool.counter));

        expect([...counters].filter((counter) => !Object.hasOwn(USAGE_VERB_COUNTERS, counter))).toEqual([]);
        expect([...counters].sort()).toEqual([...CONTEXT_VERBS].sort());
    });

    test('a guide call counts as help, the verb it replaced', async () => {
        const guide = guideTool(TOOLKITS);
        const [topic] = TOOLKITS.flatMap((toolkit) => toolkit.guides);

        await runTool(guide, { topic: topic!.name }, toolCall('chat-1', {} as CanvasHost));
        expect(counts()).toEqual({ 'verbs.help': 1 });
    });

    test('a tool call counts under its counter, and delegating and feature tools on the day as well', () => {
        countToolCall('agent');
        countToolCall('team');
        countToolCall('browser');
        countToolCall('read');
        countToolCall('no-such-counter');
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

    test('what the dispatcher says an answered request counts is counted, once per key where it says once', () => {
        countUsages(['actions.device', { counter: 'files.opened', once: '/work/a.ts' }, { counter: 'files.opened', once: '/work/a.ts' }]);
        countUsages([{ counter: 'files.opened', once: '/work/b.ts' }]);
        expect(counts()).toEqual({ 'actions.device': 1, 'files.opened': 2 });
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
