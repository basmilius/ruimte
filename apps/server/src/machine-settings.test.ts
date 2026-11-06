import { describe, expect, mock, test } from 'bun:test';
import { MACHINE_SETTING_KEYS } from '@ruimte/contracts';
import { NO_SETTING_PORTS } from './endpoint-id-test-helpers.ts';
import {
    defaultSettings,
    followSettings,
    prepareSettings,
    settingFields,
    settingsFromFile,
    settingsToFile,
    withSettings,
    type SettingContext
} from './machine-settings.ts';

function context(patch: Partial<SettingContext> = {}): SettingContext {
    return {
        owner: false,
        home: '/home/ruimte',
        closedLid: { available: true, rule: async () => true },
        current: defaultSettings(),
        ...patch
    };
}

describe('machine settings', () => {
    test('a file holds only what differs from the defaults, and reads back as the same settings', () => {
        const changed = withSettings(defaultSettings(), {
            steerMessages: true,
            streamingAllowed: false,
            broker: { mode: 'off' },
            worktreeRoot: '/work',
            usageStats: false
        });
        const file = settingsToFile(changed);

        expect(file).toEqual({ steerMessages: true, streamingAllowed: false, broker: { mode: 'off' }, worktreeRoot: '/work', usageStats: false });
        expect(settingsFromFile(file)).toEqual(changed);
        expect(settingsToFile(defaultSettings())).toEqual({});
    });

    test('a node size in the file is read one kind at a time', () => {
        const read = settingsFromFile({ nodeSizes: { terminal: { w: 640, h: 400 }, chat: 'wide', mystery: { w: 1, h: 1 } } });

        expect(read.nodeSizes).toEqual({ terminal: { w: 640, h: 400 } });
    });

    test('every setting the owner alone sees stays out of what everyone hears, and a null without a place on the wire is left out', () => {
        const values = withSettings(defaultSettings(), { worktreeRoot: '/work', terminalShell: 'cmd' });

        expect(Object.keys(settingFields(values, 'everyone'))).toEqual(MACHINE_SETTING_KEYS.filter((key) => key !== 'worktreeRoot' && key !== 'terminalShell'));
        expect(settingFields(values, 'owner')).toEqual({ worktreeRoot: '/work', terminalShell: 'cmd' });
        expect(settingFields(defaultSettings(), 'owner')).toEqual({ worktreeRoot: null });
    });

    test('a client that is not the owner is refused each owner-only setting and told what it cannot do', async () => {
        await expect(prepareSettings({ usageStats: false }, context())).rejects.toMatchObject({
            code: 'owner-only',
            message: 'Only a person on this machine can turn its usage statistics on or off'
        });
        await expect(prepareSettings({ terminalShell: 'wsl' }, context())).rejects.toMatchObject({ code: 'owner-only' });
        await expect(prepareSettings({ worktreeRoot: '/work' }, context())).rejects.toMatchObject({ code: 'owner-only' });
        expect(await prepareSettings({ usageStats: false, terminalShell: 'wsl' }, context({ owner: true }))).toEqual({
            usageStats: false,
            terminalShell: 'wsl'
        });
    });

    test('an empty worktree folder puts it back, and the closed lid turns on only with its rule', async () => {
        expect(await prepareSettings({ worktreeRoot: '' }, context({ owner: true }))).toEqual({ worktreeRoot: null });

        const noRule = context({ closedLid: { available: true, rule: async () => false } });
        await expect(prepareSettings({ keepAwakeLidClosed: true }, noRule)).rejects.toMatchObject({ code: 'closed-lid-no-rule' });
        await expect(prepareSettings({ keepAwakeLidClosed: true }, context({ closedLid: { available: false, rule: async () => true } }))).rejects.toMatchObject(
            {
                code: 'closed-lid-unavailable'
            }
        );
        expect(await prepareSettings({ keepAwakeLidClosed: false }, noRule)).toEqual({ keepAwakeLidClosed: false });
        expect(
            await prepareSettings({ keepAwakeLidClosed: true }, context({ ...noRule, current: withSettings(defaultSettings(), { keepAwakeLidClosed: true }) }))
        ).toEqual({
            keepAwakeLidClosed: true
        });
    });

    test('a change is followed once per effect, and a setting that stayed where it was is not', async () => {
        const keepAwakeChanged = mock(() => undefined);
        const streamingChanged = mock((_allowed: boolean) => undefined);
        const brokerChanged = mock(async () => undefined);
        const ports = { ...NO_SETTING_PORTS, keepAwakeChanged, streamingChanged, brokerChanged };
        const before = defaultSettings();

        await followSettings(
            before,
            withSettings(before, { keepAwake: 'always', keepAwakeDisplay: true, streamingAllowed: false, steerMessages: true }),
            () => ports
        );
        expect(keepAwakeChanged).toHaveBeenCalledTimes(1);
        expect(streamingChanged).toHaveBeenCalledWith(false);
        expect(brokerChanged).not.toHaveBeenCalled();

        await followSettings(before, withSettings(before, { lanDoor: true, broker: { mode: 'default' } }), () => ports);
        expect(keepAwakeChanged).toHaveBeenCalledTimes(1);
        expect(brokerChanged).not.toHaveBeenCalled();
    });
});
