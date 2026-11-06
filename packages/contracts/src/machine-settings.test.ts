import { describe, expect, test } from 'bun:test';
import { EndpointChangedEventSchema, EndpointInfoSchema, EndpointSetIdentityPayloadSchema, EndpointSettingsSchema } from './auth.ts';
import { MACHINE_SETTING_KEYS, isOwnerOnlySetting, isOwnerSeenSetting, settingDefault } from './machine-settings.ts';

const SWITCHES = [
    'agentsDeleteAnyView',
    'reachOpenProjects',
    'steerMessages',
    'streamingAllowed',
    'resumeAtReset',
    'visualReplies',
    'keepAwake',
    'keepAwakeOnBattery',
    'keepAwakeDisplay',
    'keepAwakeLidClosed',
    'broker',
    'lanDoor',
    'worktreeRoot',
    'terminalShell',
    'usageStats'
];

describe('the machine settings table', () => {
    test('sets the fields a client has always been able to set, and no more', () => {
        expect(Object.keys(EndpointSettingsSchema.shape).toSorted()).toEqual(SWITCHES.toSorted());
        expect(Object.keys(EndpointSetIdentityPayloadSchema.shape).toSorted()).toEqual(['icon', 'name', ...SWITCHES].toSorted());
    });

    test('tells every client of a setting but the two only the owner sees', () => {
        const settings = (shape: Record<string, unknown>): string[] =>
            Object.keys(shape).filter((key) => (MACHINE_SETTING_KEYS as readonly string[]).includes(key));

        expect(settings(EndpointInfoSchema.shape).toSorted()).toEqual([...SWITCHES, 'nodeSizes'].toSorted());
        expect(settings(EndpointChangedEventSchema.shape).toSorted()).toEqual(
            [...SWITCHES.filter((key) => key !== 'worktreeRoot' && key !== 'terminalShell'), 'nodeSizes'].toSorted()
        );
    });

    test('refuses the owner-only settings to other clients and keeps two of them from the event', () => {
        expect(MACHINE_SETTING_KEYS.filter(isOwnerOnlySetting).toSorted()).toEqual(['terminalShell', 'usageStats', 'worktreeRoot']);
        expect(MACHINE_SETTING_KEYS.filter(isOwnerSeenSetting).toSorted()).toEqual(['terminalShell', 'worktreeRoot']);
    });

    test('reads a setting as its default while nobody changed it', () => {
        expect(MACHINE_SETTING_KEYS.map((key) => [key, settingDefault(key)])).toEqual([
            ['agentsDeleteAnyView', false],
            ['reachOpenProjects', false],
            ['steerMessages', false],
            ['streamingAllowed', true],
            ['resumeAtReset', false],
            ['visualReplies', true],
            ['keepAwake', 'off'],
            ['keepAwakeOnBattery', false],
            ['keepAwakeDisplay', false],
            ['keepAwakeLidClosed', false],
            ['broker', { mode: 'default' }],
            ['lanDoor', true],
            ['worktreeRoot', null],
            ['terminalShell', null],
            ['nodeSizes', {}],
            ['usageStats', true]
        ]);
    });
});
