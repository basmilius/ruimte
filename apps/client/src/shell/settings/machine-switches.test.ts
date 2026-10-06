import { afterEach, describe, expect, test } from 'bun:test';
import { searchSettings } from '@/shell/settings/search';
import { serverInfoOf, useServers, type ServerInfo } from '@/state/server';
import { anyMachineShows, MACHINE_SWITCHES, showsMachineSwitch } from './machine-switches';

function machine(patch: Partial<ServerInfo>): ServerInfo {
    return { ...serverInfoOf('nobody'), ...patch };
}

describe('the switches of a machine', () => {
    test('visual replies sit beside the resume after a limit', () => {
        expect(MACHINE_SWITCHES).toEqual(['resumeAtReset', 'visualReplies', 'agentsDeleteAnyView']);
    });

    test('a machine that reports visual replies shows their switch, on or off', () => {
        expect(showsMachineSwitch('visualReplies', machine({ visualReplies: true }))).toBe(true);
        expect(showsMachineSwitch('visualReplies', machine({ visualReplies: false }))).toBe(true);
    });

    test('a machine from before visuals, or one that never answered, has no switch for them', () => {
        expect(showsMachineSwitch('visualReplies', machine({ visualReplies: null }))).toBe(false);
        expect(showsMachineSwitch('visualReplies', undefined)).toBe(false);
        expect(serverInfoOf('nobody').visualReplies).toBeNull();
    });

    test('the other switches show for every machine', () => {
        for (const setting of ['resumeAtReset', 'agentsDeleteAnyView'] as const) {
            expect(showsMachineSwitch(setting, undefined)).toBe(true);
            expect(showsMachineSwitch(setting, machine({ visualReplies: null }))).toBe(true);
        }
    });
});

describe('searching for visual replies', () => {
    afterEach(() => {
        useServers.setState({ byEndpoint: {} });
    });

    test('finds the switch once a machine reported it, and leads nowhere before that', () => {
        useServers.setState({ byEndpoint: { old: machine({ visualReplies: null }) } });
        expect(anyMachineShows('visualReplies')).toBe(false);
        expect(searchSettings('visual replies').map((result) => result.id)).not.toContain('agents.visualReplies');

        useServers.setState({ byEndpoint: { old: machine({ visualReplies: null }), current: machine({ visualReplies: false }) } });
        expect(anyMachineShows('visualReplies')).toBe(true);
        expect(searchSettings('chart table mockup').map((result) => result.id)).toEqual(['agents.visualReplies']);
    });
});
