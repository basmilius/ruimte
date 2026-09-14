import { afterEach, describe, expect, test } from 'bun:test';
import { useReleaseNotes } from '@/state/release-notes';
import { useToasts } from '@/state/toasts';
import { describeUpdate, hasUpdate, noteVersionChange, seenVersionChange } from '@/state/updates';
import type { UpdateState } from '@/desktop/bridge';

describe('seenVersionChange', () => {
    test('is first when nothing was seen, or something that is not a version', () => {
        expect(seenVersionChange(null, '0.0.9')).toBe('first');
        expect(seenVersionChange('garbage', '0.0.9')).toBe('first');
    });

    test('is updated when the version went up', () => {
        expect(seenVersionChange('0.0.8', '0.0.9')).toBe('updated');
        expect(seenVersionChange('0.0.9', '0.0.10')).toBe('updated');
    });

    test('is same for the same version', () => {
        expect(seenVersionChange('0.0.9', '0.0.9')).toBe('same');
    });

    test('is older after a downgrade', () => {
        expect(seenVersionChange('0.0.9', '0.0.8')).toBe('older');
    });
});

describe('noteVersionChange', () => {
    const storageWith = (entries: Record<string, string>) => {
        const map = new Map(Object.entries(entries));
        return { map, storage: { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) } };
    };

    afterEach(() => {
        for (const toast of useToasts.getState().toasts) {
            useToasts.getState().dismiss(toast.id);
        }
        useReleaseNotes.setState({ previousSeen: null });
    });

    test('shows one toast after an update, and none on the next start', () => {
        const { map, storage } = storageWith({ 'ruimte.seenVersion': '0.0.7' });
        expect(noteVersionChange('0.0.9', storage)).toBe('updated');
        expect(map.get('ruimte.seenVersion')).toBe('0.0.9');
        expect(useToasts.getState().toasts.map((toast) => [toast.title, toast.persist])).toEqual([['Updated to version 0.0.9', true]]);
        expect(useReleaseNotes.getState().previousSeen).toBe('0.0.7');
        expect(noteVersionChange('0.0.9', storage)).toBe('same');
        expect(useToasts.getState().toasts).toHaveLength(1);
    });

    test('remembers a fresh install and a downgrade without a toast', () => {
        const fresh = storageWith({});
        expect(noteVersionChange('0.0.9', fresh.storage)).toBe('first');
        expect(fresh.map.get('ruimte.seenVersion')).toBe('0.0.9');
        const downgrade = storageWith({ 'ruimte.seenVersion': '0.0.9' });
        expect(noteVersionChange('0.0.8', downgrade.storage)).toBe('older');
        expect(downgrade.map.get('ruimte.seenVersion')).toBe('0.0.8');
        expect(useToasts.getState().toasts).toEqual([]);
    });
});

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
        expect(describeUpdate(state({ status: 'downloading', version: '1.2.0', percent: 41.6 })).detail).toBe('42%');
    });

    test('carries the reason a check failed, and says so when there is none', () => {
        expect(describeUpdate(state({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' })).detail).toBe('net::ERR_INTERNET_DISCONNECTED');
        expect(describeUpdate(state({ status: 'error' })).detail).toBe('No reason given.');
    });

    test('treats a checkout as a place updates do not come from', () => {
        expect(describeUpdate(state({ status: 'unsupported' })).headline).toBe('Updates come from the desktop app');
    });
});
