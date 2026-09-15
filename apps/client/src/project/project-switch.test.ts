import { describe, expect, test } from 'bun:test';
import { ProjectSwitch, REVEAL_DELAY_MS, type SwitchClock, type SwitchContext, type SwitchRun, type SwitchTarget } from './project-switch';

/* A clock that only moves when a test says so. */
const fakeClock = (): SwitchClock & { advance(ms: number): void } => {
    let now = 0;
    let timers: { at: number; run: () => void }[] = [];
    return {
        schedule(run, ms) {
            const timer = { at: now + ms, run };
            timers.push(timer);
            return () => {
                timers = timers.filter((entry) => entry !== timer);
            };
        },
        advance(ms) {
            now += ms;
            const due = timers.filter((entry) => entry.at <= now);
            timers = timers.filter((entry) => entry.at > now);
            for (const timer of due) {
                timer.run();
            }
        }
    };
};

/* A run whose steps wait on the test: `connect` ends the machine step, `open` the project step. */
const controlledRun = () => {
    const log: string[] = [];
    let connected!: (failure?: string) => void;
    let opened!: (failure?: string) => void;
    const settle = (resolve: () => void, reject: (e: Error) => void) => (failure?: string) => (failure === undefined ? resolve() : reject(new Error(failure)));
    const run: SwitchRun = {
        async steps({ signal, opening }: SwitchContext) {
            log.push('connect');
            await new Promise<void>((resolve, reject) => {
                connected = settle(resolve, reject);
                signal.addEventListener('abort', () => reject(new Error('cancelled')));
            });
            opening();
            log.push('open');
            await new Promise<void>((resolve, reject) => {
                opened = settle(resolve, reject);
            });
        },
        async back() {
            log.push('back');
        }
    };
    return { run, log, connect: (failure?: string) => connected(failure), open: (failure?: string) => opened(failure) };
};

const target: SwitchTarget = { endpointId: 'studio', summary: null, folder: null };

/* Lets the awaits between steps run. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
};

describe('switching to a project', () => {
    test('starts idle', () => {
        expect(new ProjectSwitch(fakeClock()).state).toEqual({ kind: 'idle' });
    });

    test('a switch that finishes within the delay never shows anything', async () => {
        const clock = fakeClock();
        const projectSwitch = new ProjectSwitch(clock);
        const { run, connect, open } = controlledRun();
        const outcome = projectSwitch.start(target, () => run);
        expect(projectSwitch.state).toEqual({ kind: 'connecting', target, visible: false });
        connect();
        await flush();
        open();
        expect(await outcome).toBe('done');
        clock.advance(REVEAL_DELAY_MS);
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
    });

    test('a slow machine is shown after the delay, then the project step', async () => {
        const clock = fakeClock();
        const projectSwitch = new ProjectSwitch(clock);
        const { run, connect, open } = controlledRun();
        const outcome = projectSwitch.start(target, () => run);
        clock.advance(REVEAL_DELAY_MS - 1);
        expect(projectSwitch.state).toMatchObject({ kind: 'connecting', visible: false });
        clock.advance(1);
        expect(projectSwitch.state).toMatchObject({ kind: 'connecting', visible: true });
        connect();
        await flush();
        expect(projectSwitch.state).toMatchObject({ kind: 'opening', visible: true });
        open();
        expect(await outcome).toBe('done');
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
    });

    test('the delay runs across both steps rather than starting over', async () => {
        const clock = fakeClock();
        const projectSwitch = new ProjectSwitch(clock);
        const { run, connect } = controlledRun();
        void projectSwitch.start(target, () => run);
        clock.advance(200);
        connect();
        await flush();
        expect(projectSwitch.state).toMatchObject({ kind: 'opening', visible: false });
        clock.advance(100);
        expect(projectSwitch.state).toMatchObject({ kind: 'opening', visible: true });
    });

    test('a failure shows its reason at once, whatever the delay', async () => {
        const clock = fakeClock();
        const projectSwitch = new ProjectSwitch(clock);
        const { run, connect } = controlledRun();
        const outcome = projectSwitch.start(target, () => run);
        connect('No network path to the machine');
        expect(await outcome).toBe('failed');
        expect(projectSwitch.state).toEqual({ kind: 'failed', target, reason: 'No network path to the machine' });
        clock.advance(REVEAL_DELAY_MS);
        expect(projectSwitch.state.kind).toBe('failed');
    });

    test('cancelling while connecting is over at once, and undoes nothing that moved', async () => {
        const projectSwitch = new ProjectSwitch(fakeClock());
        const { run, log } = controlledRun();
        const outcome = projectSwitch.start(target, () => run);
        projectSwitch.cancel();
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
        expect(await outcome).toBe('cancelled');
        // The run's own back decides there is nothing to undo; it is still asked.
        expect(log).toEqual(['connect', 'back']);
    });

    test('cancelling while opening goes back once the open stopped', async () => {
        const clock = fakeClock();
        const projectSwitch = new ProjectSwitch(clock);
        const { run, log, connect, open } = controlledRun();
        const outcome = projectSwitch.start(target, () => run);
        clock.advance(REVEAL_DELAY_MS);
        connect();
        await flush();
        projectSwitch.cancel();
        expect(projectSwitch.state).toEqual({ kind: 'returning', target, visible: true });
        await flush();
        expect(log).toEqual(['connect', 'open']);
        open();
        expect(await outcome).toBe('cancelled');
        expect(log).toEqual(['connect', 'open', 'back']);
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
    });

    test('retry after a failure starts a fresh run of the same plan', async () => {
        const projectSwitch = new ProjectSwitch(fakeClock());
        const runs = [controlledRun(), controlledRun()];
        let made = 0;
        const first = projectSwitch.start(target, () => runs[made++]!.run);
        runs[0]!.connect('Gone');
        expect(await first).toBe('failed');
        const second = projectSwitch.retry();
        expect(made).toBe(2);
        expect(projectSwitch.state).toMatchObject({ kind: 'connecting', target });
        runs[1]!.connect();
        await flush();
        runs[1]!.open();
        expect(await second).toBe('done');
    });

    test('back after a failure undoes the run and ends idle', async () => {
        const projectSwitch = new ProjectSwitch(fakeClock());
        const { run, log, connect, open } = controlledRun();
        const outcome = projectSwitch.start(target, () => run);
        connect();
        await flush();
        open('That folder is gone');
        expect(await outcome).toBe('failed');
        const going = projectSwitch.back();
        expect(projectSwitch.state).toMatchObject({ kind: 'returning', visible: true });
        await going;
        expect(log).toEqual(['connect', 'open', 'back']);
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
    });

    test('a second pick takes over without going back', async () => {
        const clock = fakeClock();
        const projectSwitch = new ProjectSwitch(clock);
        const first = controlledRun();
        const second = controlledRun();
        const other: SwitchTarget = { endpointId: 'attic', summary: null, folder: null };
        const firstOutcome = projectSwitch.start(target, () => first.run);
        clock.advance(REVEAL_DELAY_MS);
        const secondOutcome = projectSwitch.start(other, () => second.run);
        expect(await firstOutcome).toBe('replaced');
        expect(first.log).toEqual(['connect']);
        expect(projectSwitch.state).toEqual({ kind: 'connecting', target: other, visible: false });
        second.connect();
        await flush();
        second.open();
        expect(await secondOutcome).toBe('done');
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
    });

    test('cancel, retry and back do nothing when there is nothing to act on', async () => {
        const projectSwitch = new ProjectSwitch(fakeClock());
        projectSwitch.cancel();
        expect(projectSwitch.retry()).toBeNull();
        await projectSwitch.back();
        expect(projectSwitch.state).toEqual({ kind: 'idle' });
    });
});
