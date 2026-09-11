import { describe, expect, test } from 'bun:test';
import { describeUpdate, hasUpdate } from '@/state/updates';
import type { UpdateState } from '@/desktop/bridge';

const state = (patch: Partial<UpdateState>): UpdateState => ({ status: 'idle', currentVersion: '1.0.0', ...patch });

describe('hasUpdate', () => {
    test('is true only while there is something to do about a new version', () => {
        expect(hasUpdate(state({ status: 'available' }))).toBe(true);
        expect(hasUpdate(state({ status: 'downloading' }))).toBe(true);
        expect(hasUpdate(state({ status: 'ready' }))).toBe(true);
    });

    test('is false where a button would only get in the way', () => {
        for (const status of ['unsupported', 'idle', 'checking', 'current', 'error'] as const) {
            expect(hasUpdate(state({ status }))).toBe(false);
        }
    });
});

describe('describeUpdate', () => {
    test('names the version on the other side', () => {
        expect(describeUpdate(state({ status: 'available', version: '1.2.0' })).headline).toBe('Version 1.2.0 is available');
        expect(describeUpdate(state({ status: 'ready', version: '1.2.0' })).headline).toBe('Version 1.2.0 is ready');
    });

    test('rounds the progress it reports', () => {
        expect(describeUpdate(state({ status: 'downloading', version: '1.2.0', percent: 41.6 })).detail).toBe('42% of the way.');
    });

    test('carries the reason a check failed, and says so when there is none', () => {
        expect(describeUpdate(state({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' })).detail).toBe('net::ERR_INTERNET_DISCONNECTED');
        expect(describeUpdate(state({ status: 'error' })).detail).toBe('No reason given.');
    });

    test('treats a checkout as a place updates do not come from', () => {
        expect(describeUpdate(state({ status: 'unsupported' })).headline).toBe('Updates come from the desktop app');
    });
});
