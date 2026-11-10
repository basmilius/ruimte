import { describe, expect, test } from 'bun:test';
import type { Dispatcher, UsageCount } from '../dispatcher.ts';
import { peerTasksArea } from '../peer/worker/area-tasks.ts';
import { browserArea } from './browser.ts';
import { computerArea } from './computer.ts';
import { databaseArea } from './database.ts';
import { deviceArea } from './device.ts';
import { fsArea } from './fs.ts';
import { gitArea } from './git.ts';
import { gitDepsWith } from './test-helpers.ts';
import { voiceArea } from './voice.ts';

/* What each request declares it counts, read from the registration itself without answering anything. */
function declaredCounts(): (type: string, payload?: unknown) => readonly UsageCount[] {
    const declared = new Map<string, unknown>();
    const recorder = {
        register: (type: string, _handler: unknown, options?: { count?: unknown }) => void declared.set(type, options?.count)
    } as unknown as Dispatcher;
    const unused = {} as never;
    for (const area of [
        browserArea({ browsers: unused, pages: unused, streamingAllowed: () => true }),
        deviceArea({ devices: unused, control: unused, watch: unused, streamingAllowed: () => true, home: '/home' }),
        databaseArea({ service: unused, connections: unused, agents: unused, sql: unused }),
        computerArea({ computer: unused }),
        fsArea({ watcher: unused, boundaryOf: unused, machineHome: unused, language: unused }),
        gitArea(gitDepsWith()),
        voiceArea({ keys: unused, preferences: unused, sessions: unused }),
        peerTasksArea({ links: unused, tasks: unused })
    ]) {
        area.handlers?.(recorder);
    }

    return (type, payload) => {
        const count = declared.get(type);

        return typeof count === 'function' ? (count(payload) as readonly UsageCount[]) : ((count as readonly UsageCount[] | undefined) ?? []);
    };
}

describe('what a request counts once it was answered', () => {
    const counts = declaredCounts();

    test('a request counts only when it is an action a person takes', () => {
        expect(counts('device.action')).toEqual(['actions.device']);
        expect(counts('project.list')).toEqual([]);
        expect(counts('browser.navigate')).toEqual(['actions.browser']);
        expect(counts('browser.command')).toEqual(['actions.browser']);
        expect(counts('computer.control')).toEqual(['actions.computer']);
    });

    test('a git action counts what it did, and one that only fetches, checks out or branches counts nothing', () => {
        expect(counts('git.action', { kind: 'commit' })).toEqual(['git.commits']);
        expect(counts('git.action', { kind: 'commit-push' })).toEqual(['git.commits', 'git.pushes']);
        for (const kind of ['push', 'force-push', 'publish']) {
            expect(counts('git.action', { kind })).toEqual(['git.pushes']);
        }
        expect(counts('git.action', { kind: 'pull' })).toEqual(['git.pulls']);
        expect(counts('git.action', { kind: 'sync' })).toEqual(['git.pulls', 'git.pushes']);
        expect(counts('git.action', { kind: 'checkout' })).toEqual([]);
        expect(counts('git.resolve')).toEqual(['git.conflictsResolved']);
        expect(counts('git.pr-watch')).toEqual(['prWatches.started']);
    });

    test('a database request counts a query only when it executes one', () => {
        expect(counts('database.request', { id: 'd1', method: 'execute' })).toEqual(['actions.database', 'database.queries']);
        expect(counts('database.request', { id: 'd2', method: 'tables' })).toEqual(['actions.database']);
        expect(counts('database.request', 'not an object')).toEqual(['actions.database']);
    });

    test('a device counts as started when it boots, and a file as saved when it is written', () => {
        expect(counts('device.boot')).toEqual(['actions.device', 'devices.started']);
        expect(counts('fs.write')).toEqual(['files.saved']);
        expect(counts('fs.writeCommit')).toEqual(['files.saved']);
        expect(counts('voice.start')).toEqual(['voice.sessions']);
        expect(counts('peer.taskStart')).toEqual(['peers.tasks']);
    });

    test('a file read counts once per file a day, however often a client reads it again', () => {
        expect(counts('fs.read', { path: '/work/a.ts' })).toEqual([{ counter: 'files.opened', once: '/work/a.ts' }]);
        expect(counts('fs.read', { path: '/work/b.ts' })).toEqual([{ counter: 'files.opened', once: '/work/b.ts' }]);
    });
});
