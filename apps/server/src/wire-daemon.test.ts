import { describe, expect, spyOn, test } from 'bun:test';
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

    test('tells a fatal report what to leave out as soon as it is known, before the wiring that could crash after it', async () => {
        const home = join(await homeOf(), 'home');
        const told: string[] = [];
        const base = testSeams({ home, clock: new ManualClock() });
        const seams = testSeams(
            { home, clock: new ManualClock() },
            {
                accounts: (input) => {
                    told.push('providers');

                    return base.accounts(input);
                },
                git: {
                    ...base.git,
                    worktrees: (input) => {
                        told.push('git');

                        return base.git.worktrees(input);
                    }
                },
                redactions: {
                    secret: (secret) => void told.push(`secret ${secret.length > 0}`),
                    projects: (source) => void told.push(`projects ${typeof source.known}`)
                }
            }
        );
        const wired = await wireDaemon({ runtime: testRuntime(home), launcher: 'standalone', seams, shutdown: async () => undefined });

        try {
            expect(told.slice(0, 4)).toEqual(['secret true', 'providers', 'projects function', 'git']);
        } finally {
            await wired.stop();
        }
    });

    test('writes the chats before the first await of a stop', async () => {
        const home = join(await homeOf(), 'home');
        const wired = await wireDaemon({
            runtime: testRuntime(home),
            launcher: 'standalone',
            seams: testSeams({ home, clock: new ManualClock() }),
            shutdown: async () => undefined
        });
        const persist = spyOn(wired.bundles.agents.chats, 'persistAllSync');

        try {
            const stopping = wired.stop();

            expect(persist).toHaveBeenCalledTimes(1);

            await stopping;
        } finally {
            persist.mockRestore();
        }
    });

    test('reads an extension node to an agent from the extension that draws it', async () => {
        const home = join(await homeOf(), 'home');
        const wired = await wireDaemon({
            runtime: testRuntime(home),
            launcher: 'standalone',
            seams: testSeams({ home, clock: new ManualClock() }),
            shutdown: async () => undefined
        });
        const nodeContext = spyOn(wired.bundles.extensions.host, 'nodeContext').mockResolvedValue([{ text: 'Lap 3 of 10' }, { text: 'Leader: Ada' }]);

        try {
            const reading = await wired.bundles.agents.context.answerSource(
                'chat-1',
                { id: 'race', kind: 'extension', title: 'Race', extension: { id: 'racing', type: 'board', data: { lap: 3 } } },
                null,
                null
            );

            expect(reading.text).toBe('Lap 3 of 10\nLeader: Ada');
            expect(nodeContext).toHaveBeenCalledWith('racing', 'board', { lap: 3 });
        } finally {
            nodeContext.mockRestore();
            await wired.stop();
        }
    });

    test('starts in the order the app needs: interrupted moves and old hidden chats before the socket, the open work before the outbox, the lid last', async () => {
        const home = join(await homeOf(), 'home');
        const wired = await wireDaemon({
            runtime: testRuntime(home),
            launcher: 'standalone',
            seams: testSeams({ home, clock: new ManualClock() }),
            shutdown: async () => undefined
        });
        const { chatMover, projects, work, routines, processes, power } = wired.bundles;
        const started: string[] = [];
        const told = (name: string) => () => void started.push(name);
        const spies = [
            spyOn(chatMover, 'repair').mockImplementation(async () => (told('chat moves')(), [])),
            spyOn(projects.store.hiddenAgents, 'all').mockImplementation(() => (told('hidden chats')(), [])),
            spyOn(work.tasks, 'recover').mockImplementation(async () => told('tasks')()),
            spyOn(work.peerTasks, 'recover').mockImplementation(async () => told('peer tasks')()),
            spyOn(routines.routines, 'start').mockImplementation(async () => told('routines')()),
            spyOn(work.worker, 'start').mockImplementation(told('outbox')),
            spyOn(work.endChildren, 'start').mockImplementation(told('end children')),
            spyOn(processes.selfUpdate, 'start').mockImplementation(told('self update')),
            spyOn(power.keepAwake, 'check').mockImplementation(told('keep awake')),
            spyOn(power.closedLid, 'start').mockImplementation(async () => told('closed lid')())
        ];

        try {
            await wired.start({ port: 0, requestStop: () => undefined, serve: told('serve') });

            expect(started).toEqual([
                'chat moves',
                'hidden chats',
                'serve',
                'tasks',
                'peer tasks',
                'routines',
                'outbox',
                'end children',
                'self update',
                'keep awake',
                'closed lid'
            ]);
        } finally {
            for (const spy of spies) {
                spy.mockRestore();
            }
            await wired.stop();
        }
    });
});
