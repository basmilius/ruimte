import { describe, expect, test } from 'bun:test';
import type { GitRepo, LaunchConfigEntry, LaunchesDocument, LaunchStatus } from '@ruimte/contracts';
import { chosenLaunch, headlineOf, launchFolder, launchSections, launchViews, othersOf, outputOf, shortAddress } from './model.ts';

const launch = (id: string, overrides: Partial<LaunchConfigEntry> = {}): LaunchConfigEntry => ({
    id,
    name: id,
    kind: 'service',
    command: `run ${id}`,
    shared: true,
    ...overrides
});

const status = (launchId: string, overrides: Partial<LaunchStatus> = {}): LaunchStatus => ({
    projectId: 'p1',
    launchId,
    sessionId: `launch-${launchId}`,
    kind: 'service',
    state: 'running',
    exitCode: null,
    startedAt: 1_000,
    endedAt: null,
    port: null,
    url: null,
    stopped: false,
    ...overrides
});

const doc = (launches: LaunchConfigEntry[], approved = launches.map((entry) => entry.id)): LaunchesDocument => ({ rev: 1, launches, approved });

describe('the state of a launch', () => {
    test('a launch that never ran is at rest, or waits on approval', () => {
        const views = launchViews(doc([launch('a'), launch('b')], ['a']), {});
        expect(views.get('a')?.phase).toBe('idle');
        expect(views.get('b')?.phase).toBe('held');
    });

    test('a running launch reads as running even when its command changed under it', () => {
        const views = launchViews(doc([launch('a')], []), { a: status('a', { state: 'starting', port: 8000 }) });
        expect(views.get('a')).toMatchObject({ phase: 'starting', live: true, port: 8000 });
    });

    test('a task passes on exit 0 and fails on any other code', () => {
        const views = launchViews(doc([launch('t', { kind: 'task' }), launch('u', { kind: 'task' })]), {
            t: status('t', { kind: 'task', state: 'exited', exitCode: 0 }),
            u: status('u', { kind: 'task', state: 'exited', exitCode: 2 })
        });
        expect(views.get('t')?.phase).toBe('passed');
        expect(views.get('u')).toMatchObject({ phase: 'failed', exitCode: 2 });
    });

    test('a stopped service is at rest; one that fell over stays red', () => {
        const views = launchViews(doc([launch('a'), launch('b')]), {
            a: status('a', { state: 'exited', exitCode: 130, stopped: true }),
            b: status('b', { state: 'exited', exitCode: 255 })
        });
        expect(views.get('a')?.phase).toBe('idle');
        expect(views.get('b')).toMatchObject({ phase: 'failed', exitCode: 255 });
    });

    test('a group reads its members', () => {
        const members = [launch('a'), launch('b'), launch('g', { kind: 'group', launches: ['a', 'b'] })];
        expect(launchViews(doc(members), { a: status('a'), b: status('b', { state: 'starting' }) }).get('g')?.phase).toBe('starting');
        expect(launchViews(doc(members), { a: status('a') }).get('g')?.phase).toBe('running');
        expect(launchViews(doc(members), { a: status('a', { state: 'exited', exitCode: 1 }) }).get('g')?.phase).toBe('failed');
        expect(launchViews(doc(members, ['a', 'b']), {}).get('g')?.phase).toBe('held');
    });
});

describe('the chip', () => {
    test('shows the chosen launch, else the first', () => {
        const document = doc([launch('a'), launch('b')]);
        expect(chosenLaunch(document, 'b')?.id).toBe('b');
        expect(chosenLaunch(document, 'gone')?.id).toBe('a');
        expect(chosenLaunch(doc([]), undefined)).toBeNull();
    });

    test('counts what runs beside it, and turns red for one that failed', () => {
        const document = doc([launch('a'), launch('b'), launch('c'), launch('g', { kind: 'group', launches: ['a', 'b'] })]);
        const views = launchViews(document, { a: status('a'), b: status('b'), c: status('c') });
        expect(othersOf(views, document.launches[3]!)).toEqual({ count: 1, failed: false });
        expect(othersOf(views, document.launches[0]!)).toEqual({ count: 2, failed: false });
        const failed = launchViews(document, { c: status('c', { state: 'exited', exitCode: 1 }) });
        expect(othersOf(failed, document.launches[0]!)).toEqual({ count: 1, failed: true });
    });
});

describe('the chip headline', () => {
    const document = doc([launch('a'), launch('b'), launch('c'), launch('g', { kind: 'group', launches: ['a', 'b'] })]);
    const headline = (statuses: Record<string, LaunchStatus>) => headlineOf(launchViews(document, statuses))?.launch.id;

    test('is the launch in the worst phase, error first and running last', () => {
        expect(headline({ a: status('a'), b: status('b', { state: 'exited', exitCode: 1 }), c: status('c', { state: 'starting' }) })).toBe('b');
        expect(headline({ a: status('a'), c: status('c', { state: 'starting' }) })).toBe('c');
        expect(headline({ a: status('a', { state: 'exited', exitCode: 0 }), b: status('b') })).toBe('b');
    });

    test('takes the first launch on a tie, skips groups and is null without launches', () => {
        expect(headline({ a: status('a'), b: status('b') })).toBe('a');
        expect(headline({})).toBe('a');
        expect(headlineOf(launchViews(doc([]), {}))).toBeNull();
    });
});

describe('the panel', () => {
    test('shows a group through the member that runs, else the one that failed', () => {
        const document = doc([launch('a'), launch('b'), launch('g', { kind: 'group', launches: ['a', 'b'] })]);
        const group = document.launches[2]!;
        expect(outputOf(launchViews(document, { a: status('a', { state: 'exited', exitCode: 0 }), b: status('b') }), group)?.launch.id).toBe('b');
        expect(outputOf(launchViews(document, { b: status('b', { state: 'exited', exitCode: 1 }) }), group)?.launch.id).toBe('b');
        expect(outputOf(launchViews(document, {}), group)?.launch.id).toBe('a');
        expect(outputOf(launchViews(document, {}), document.launches[1]!)?.launch.id).toBe('b');
    });
});

describe('the menu', () => {
    const repos: GitRepo[] = [
        { path: '/p', label: 'p', kind: 'root' },
        { path: '/p/backend', label: 'backend', kind: 'nested' },
        { path: '/p/frontend', label: 'frontend', kind: 'nested' }
    ];

    test('groups the launches per checkout, the project folder first', () => {
        const launches = [
            launch('dev', { cwd: 'frontend' }),
            launch('server', { cwd: 'backend' }),
            launch('all', { kind: 'group', launches: ['dev', 'server'] }),
            launch('tests', { cwd: 'backend/tests' })
        ];
        expect(launchSections(launches, '/p', repos).map((section) => [section.label, section.launches.map((entry) => entry.id)])).toEqual([
            [null, ['all']],
            ['backend', ['server', 'tests']],
            ['frontend', ['dev']]
        ]);
    });

    test('a checkout heading is the name it declares, else its folder', () => {
        const named = [repos[0]!, { ...repos[1]!, name: 'Backend API' }, repos[2]!];
        const launches = [launch('server', { cwd: 'backend' }), launch('dev', { cwd: 'frontend' })];
        expect(launchSections(launches, '/p', named).map((section) => section.label)).toEqual(['Backend API', 'frontend']);
    });

    test('a folder with one checkout has no headings', () => {
        const launches = [launch('dev', { cwd: 'frontend' }), launch('build', { cwd: 'frontend' })];
        expect(launchSections(launches, '/p', repos)).toEqual([{ label: null, launches }]);
    });

    test('a private folder of its own counts over the shared one', () => {
        expect(launchFolder(launch('a', { cwd: 'backend' }), '/p')).toBe('/p/backend');
        expect(launchFolder(launch('a', { cwd: './' }), '/p/')).toBe('/p');
        expect(launchFolder(launch('a', { cwd: 'backend', overlay: { cwd: '/elsewhere/' } }), '/p')).toBe('/elsewhere');
    });

    test('an address reads without its scheme', () => {
        expect(shortAddress('http://localhost:8000/')).toBe('localhost:8000');
    });
});
