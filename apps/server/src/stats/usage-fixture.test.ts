import { afterEach, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoWeekOf, UsageReportBatchSchema } from '@ruimte/pulsar';
import type { Launcher } from '../telemetry/reporter.ts';
import { UsageCounter } from './usage-counter.ts';
import { usageBatchesOf, usageDayOf } from './usage-reporter.ts';
import {
    countChatStarted,
    countLimit,
    countTurn,
    countUsage,
    countVerb,
    installUsageCounter,
    recordFirstToken,
    recordStartup,
    recordTiming
} from './usage-stats.ts';

/*
 * The usage batch Observatory builds against (`packages/pulsar/fixtures/usage.json`), made by the daemon's own counter
 * and serializer. A change that alters what goes out fails here; `UPDATE_USAGE_FIXTURE=1 bun test` writes the new one,
 * which Observatory has to take before the release that sends it.
 */
const FIXTURE = join(import.meta.dir, '../../../../packages/pulsar/fixtures/usage.json');
const DAY_MS = 86_400_000;

afterEach(() => installUsageCounter(null));

function batchOfTwoDays(): unknown {
    let clock = Date.parse('2026-10-20T09:00:00Z');
    let launcher: Launcher = 'desktop';
    const counter = new UsageCounter({
        store: { read: async () => null, write: async () => undefined },
        describe: () => ({ version: '0.22.0', launcher }),
        now: () => clock,
        schedule: () => () => undefined
    });
    installUsageCounter(counter);

    // A day at the desktop: chats with several providers and models, the new features and the timings.
    counter.noteSignedIn(true);
    recordStartup(900);
    recordStartup(1500);
    recordStartup(1100);
    countChatStarted('claude');
    countChatStarted('grok');
    countTurn('claude', 'claude-opus-5-5', 'auto-accept-edits');
    countTurn('claude', 'claude-opus-5-5', 'plan');
    countTurn('codex', 'gpt-5-codex', 'full-access');
    countTurn('nanogpt', 'my-finetune', 'supervised');
    countTurn('my-own-agent', null, null);
    countLimit('claude');
    countVerb('agent');
    countVerb('read');
    for (const counted of [
        'projects.opened',
        'terminals.started',
        'views.chat',
        'clients.ios',
        'actions.browser',
        'limitResumes',
        'voice.sessions',
        'dictations',
        'files.opened',
        'files.saved',
        'git.commits',
        'git.pushes',
        'git.pulls',
        'git.conflictsResolved',
        'plans.created',
        'visuals.shown',
        'prWatches.started',
        'database.queries',
        'devices.started',
        'peers.tasks',
        'connections.local',
        'connections.lan',
        'connections.turn',
        'connectFailures.timeout',
        'connectFailures.ice'
    ] as const) {
        countUsage(counted);
    }
    recordFirstToken('claude', 1400);
    recordFirstToken('claude', 1200);
    recordFirstToken('codex', 2100);
    recordTiming('terminalAttachMs', 85);
    recordTiming('remoteConnectMs', 640);

    // The next day as a service on its own: a terminal and a launch, no desktop start and no timing.
    clock += DAY_MS;
    launcher = 'service';
    countUsage('terminals.started');
    countUsage('launches.run');
    countUsage('connections.direct');

    clock += DAY_MS;
    const cohortWeek = isoWeekOf(counter.firstDate!);
    const days = counter.finished().map((record) => usageDayOf(record, cohortWeek, 'darwin', 'arm64')!);
    const batches = usageBatchesOf(days);
    expect(batches).toHaveLength(1);
    return batches[0];
}

test('the usage fixture is what the daemon sends', () => {
    const batch = batchOfTwoDays();
    expect(UsageReportBatchSchema.safeParse(batch).success).toBe(true);
    const text = `${JSON.stringify(batch, null, 2)}\n`;
    if (process.env.UPDATE_USAGE_FIXTURE === '1') {
        writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
});
