import { describe, expect, test } from 'bun:test';
import { eventPayload, eventRefusal, everyMs, MAX_SENDS_PER_HOUR, SendLimit } from './policy.ts';

describe('SendLimit', () => {
    test('lets a chat be sent to again once the oldest send is an hour old, and counts each chat apart', () => {
        let now = 0;
        const limit = new SendLimit(() => now);

        for (let send = 0; send < MAX_SENDS_PER_HOUR; send++) {
            expect(limit.take('acme.builds', 'chat-1')).toBeNull();
            now += 1000;
        }

        expect(limit.take('acme.builds', 'chat-1')).toMatchObject({ code: 'limit' });
        expect(limit.take('acme.builds', 'chat-2')).toBeNull();

        now = 3_600_000;

        expect(limit.take('acme.builds', 'chat-1')).toBeNull();
        expect(limit.take('acme.builds', 'chat-1')).toMatchObject({ code: 'limit' });
    });
});

describe('what an extension hears of a machine event', () => {
    test('is a launch by its project, id and state, without the session it runs in or where', () => {
        const status = {
            projectId: 'p1',
            launchId: 'dev',
            sessionId: 'launch-1',
            kind: 'service',
            state: 'exited',
            exitCode: 1,
            startedAt: 1,
            endedAt: 2,
            port: 5173,
            url: 'http://localhost:5173',
            stopped: false,
            worktree: '/work/tree'
        };

        expect(eventPayload('launch.status', status)).toEqual({ project: { id: 'p1' }, launch: 'dev', state: 'exited', exitCode: 1 });
    });

    test('is a project that opens with its name and folder, and one that closes by its id', () => {
        const project = { id: 'p1', name: 'Shop', folder: '/work/shop', more: 'never handed on' };

        expect(eventPayload('project.opened', { project })).toEqual({ project: { id: 'p1', name: 'Shop', folder: '/work/shop' } });
        expect(eventPayload('project.closed', { projectId: 'p1' })).toEqual({ project: { id: 'p1' } });
    });

    test('is behind the read permission of its area, and nothing for an event of the wire it has no shape for', () => {
        const all = new Set(['launches.read', 'projects.read']);

        expect(['launch.status', 'project.opened', 'project.closed'].map((name) => eventRefusal(name, all))).toEqual([null, null, null]);
        expect(eventRefusal('launch.status', new Set(['launches.run']))).toBe('launch.status needs the permission launches.read in manifest.json');
        expect(eventRefusal('project.opened', new Set())).toBe('project.opened needs the permission projects.read in manifest.json');
        expect(eventRefusal('launches.changed', all)).toBe('launches.changed is no event an extension can follow');
        expect(eventPayload('launches.changed', { projectId: 'p1' })).toBeNull();
    });
});

describe('everyMs', () => {
    test('reads seconds, minutes and hours, and refuses anything under ten seconds', () => {
        expect([everyMs('10s'), everyMs('5m'), everyMs('1h'), everyMs('596h')]).toEqual([10_000, 300_000, 3_600_000, 2_145_600_000]);
        expect(() => everyMs('9s')).toThrow('not 9s');
        expect(() => everyMs('5 minutes')).toThrow('not 5 minutes');
    });

    test('refuses an interval longer than a timer holds, which would fire at once', () => {
        expect(() => everyMs('597h')).toThrow('at most 596h, not 597h');
        expect(() => everyMs('999999999h')).toThrow('not 999999999h');
        expect(() => everyMs(`${'9'.repeat(400)}s`)).toThrow('at most 596h');
    });
});
