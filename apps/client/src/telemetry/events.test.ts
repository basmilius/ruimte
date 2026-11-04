import { describe, expect, test } from 'bun:test';
import { createDailyDedupe, createScrubber } from '@ruimte/telemetry';
import { memoryStorage } from '../../testing/memory-storage';
import { CLIENT_TAGS, connectionEvent, storageDedupeStore } from './events';

describe('connectionEvent', () => {
    test('a drop names the link, the kind of machine and the close code, and groups by them', () => {
        expect(connectionEvent({ kind: 'dropped', code: 1006, machine: 'local', link: 'socket' })).toEqual({
            message: 'The socket link to a local machine dropped (1006)',
            level: 'error',
            fingerprint: ['connection-dropped', 'local', 'socket', '1006'],
            tags: { problem: 'connection-dropped', machine: 'local', link: 'socket', close_code: '1006' }
        });
        expect(connectionEvent({ kind: 'dropped', code: null, machine: 'remote', link: 'direct' }).tags.close_code).toBe('none');
    });

    test('a timeout carries the request type and nothing of its payload', () => {
        const event = connectionEvent({ kind: 'timeout', request: 'fs.read', machine: 'remote', link: 'direct' });
        expect(event.fingerprint).toEqual(['request-timeout', 'fs.read']);
        expect(event.tags).toEqual({ problem: 'request-timeout', machine: 'remote', link: 'direct', request: 'fs.read' });
    });

    test('keeps every tag through the scrubber of the client', () => {
        const event = connectionEvent({ kind: 'refused', mismatch: 'daemon-older', machine: 'remote', link: 'direct' });
        const withUrl: { tags: Record<string, string> } = { ...event, tags: { ...event.tags, url: 'https://station.ruimte.app/x' } };
        const scrubbed = createScrubber({ tags: CLIENT_TAGS }).scrubEvent(withUrl);
        expect(scrubbed?.tags).toEqual(event.tags);
    });
});

describe('storageDedupeStore', () => {
    test('lets an error out once a day across every window of the app', () => {
        const storage = memoryStorage();
        const first = createDailyDedupe({ store: storageDedupeStore(() => storage), now: () => 0 });
        const second = createDailyDedupe({ store: storageDedupeStore(() => storage), now: () => 1000 });
        const event = connectionEvent({ kind: 'timeout', request: 'session.list', machine: 'local', link: 'socket' });
        expect(first.admit(event)).toBe(true);
        expect(second.admit(event)).toBe(false);
        expect(storage.values.size).toBe(1);
    });

    test('a page without storage still reports', () => {
        const dedupe = createDailyDedupe({
            store: storageDedupeStore(() => {
                throw new Error('storage is blocked');
            })
        });
        expect(dedupe.admit({ message: 'x' })).toBe(true);
    });
});
