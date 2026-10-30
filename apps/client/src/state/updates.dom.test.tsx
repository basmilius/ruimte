import { afterEach, describe, expect, test } from 'bun:test';
import type { UpdateState } from '@/desktop/bridge';
import { setUpdateTrack, startUpdates } from '@/state/updates';
import { until } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';

function shellOn(currentVersion: string): string[] {
    const asked: string[] = [];
    installDesktop({
        updateState: async () => ({ status: 'idle', currentVersion }) as UpdateState,
        onUpdateState: () => () => undefined,
        configureUpdates: async () => void asked.push('auto'),
        configureUpdateTrack: async (track) => void asked.push(track),
        checkForUpdate: async () => void asked.push('check')
    });
    return asked;
}

afterEach(() => {
    removeDesktop();
});

describe('the update track', () => {
    test.each([
        ['0.29.0', null, 'stable'],
        ['0.29.0-beta.3', null, 'prerelease'],
        ['0.29.0-beta.3', 'stable', 'stable'],
        ['0.29.0', 'prerelease', 'prerelease']
    ] as const)('on %s with %s chosen, the first check follows %s', async (version, chosen, expected) => {
        const asked = shellOn(version);
        const stop = startUpdates(true, chosen);
        await until(() => asked.includes('check'));
        stop?.();
        expect(asked).toEqual(['auto', expected, 'check']);
    });

    test('a person who chooses another track is checked for right away', async () => {
        const asked = shellOn('0.29.0');
        await setUpdateTrack('prerelease');
        expect(asked).toEqual(['prerelease', 'check']);
    });
});
