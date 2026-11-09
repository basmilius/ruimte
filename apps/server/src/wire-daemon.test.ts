import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { tempHomes } from './temp-home-test-helpers.ts';
import { testRuntime, testSeams } from './testing/test-seams.ts';
import { wireDaemon } from './wire-daemon.ts';

const homeOf = tempHomes('ruimte-wire-daemon-');

describe('wireDaemon', () => {
    test('wires every bundle over the seams it is given, and the seams are what the services run on', async () => {
        const home = join(await homeOf(), 'home');
        const seams = testSeams({ home, clock: new ManualClock() });
        const wired = await wireDaemon({ runtime: testRuntime(home), launcher: 'standalone', seams, shutdown: async () => undefined });

        try {
            expect(Object.keys(wired.bundles).sort()).toEqual([
                'actions',
                'agents',
                'artifacts',
                'canvasHost',
                'chatMover',
                'clients',
                'computer',
                'connected',
                'databases',
                'devices',
                'extensions',
                'git',
                'language',
                'launches',
                'machine',
                'maintenance',
                'network',
                'ports',
                'power',
                'processes',
                'projects',
                'providers',
                'push',
                'remote',
                'routines',
                'settingPorts',
                'stats',
                'stores',
                'templates',
                'tunnels',
                'usage',
                'voice',
                'work'
            ]);

            await wired.bundles.agents.sessions.create({ sessionId: 'term-1', cols: 80, rows: 24, cwd: home });
            expect(seams.fakes.adapter.spawned).toHaveLength(1);

            // The one list of areas answers requests, and the host of the agent tools is the one the bundles hold.
            const frames: unknown[] = [];
            await wired.dispatcher.handle(
                { id: 'client-1', send: (frame) => frames.push(frame) },
                JSON.stringify({ id: 'r', type: 'server.ping', payload: {} })
            );
            expect(frames[0]).toMatchObject({ id: 'r', ok: true });
            expect(wired.bundles.canvasHost.tasks).toBe(wired.bundles.work.tasks.host);
            await wired.recoverWork();
        } finally {
            await wired.bundles.agents.sessions.killAllSettled();
            await wired.stop();
        }
    });

    test('is wired from the clock of the seams, never the system clock', async () => {
        const home = join(await homeOf(), 'home');
        const clock = new ManualClock();
        const seams = testSeams({ home, clock });
        const wired = await wireDaemon({ runtime: testRuntime(home), launcher: 'standalone', seams, shutdown: async () => undefined });

        try {
            clock.advance(60_000);
            await wired.bundles.stores.notices.put({ projectId: 'p', targetId: 'chat-1', from: 'chat-2', fromTitle: 'Other', text: 'hi' });
            expect(wired.bundles.stores.notices.waiting('chat-1')[0]?.createdAt).toBe(clock.now());
        } finally {
            await wired.stop();
        }
    });
});
