import { describe, expect, test } from 'bun:test';
import { DEFAULT_STUN_SERVER } from '@ruimte/pulsar';
import { codeThemesOf, iceServersFrom, settingsFrom } from './settings';

describe('a view an agent asks for', () => {
    test('is not followed until a person says so', () => {
        expect(settingsFrom({}).agentsShowViews).toBe(false);
        expect(settingsFrom({ accent: 'blue' }).agentsShowViews).toBe(false);
    });

    test('follows only on a stored true, never on whatever else is under the key', () => {
        expect(settingsFrom({ agentsShowViews: true }).agentsShowViews).toBe(true);
        expect(settingsFrom({ agentsShowViews: 'yes' as unknown as boolean }).agentsShowViews).toBe(false);
    });
});

describe('keeping the machine awake', () => {
    test('is off until a person turns it on, since a laptop that never sleeps is a decision', () => {
        expect(settingsFrom({}).agentsKeepAwake).toBe(false);
        expect(settingsFrom({ agentsShowViews: true }).agentsKeepAwake).toBe(false);
    });

    test('is on only for a stored true, never for whatever else is under the key', () => {
        expect(settingsFrom({ agentsKeepAwake: true }).agentsKeepAwake).toBe(true);
        expect(settingsFrom({ agentsKeepAwake: 1 as unknown as boolean }).agentsKeepAwake).toBe(false);
    });
});

describe('answering a permission here', () => {
    test('starts on: the terminal you would have answered in is the one thing the canvas moved away', () => {
        expect(settingsFrom({}).agentsApprovals).toBe(true);
        expect(settingsFrom({ agentsShowViews: true }).agentsApprovals).toBe(true);
    });

    test('is off for a stored false and for nothing else', () => {
        expect(settingsFrom({ agentsApprovals: false }).agentsApprovals).toBe(false);
        expect(settingsFrom({ agentsApprovals: 0 as unknown as boolean }).agentsApprovals).toBe(true);
    });
});

describe('being told a turn ended', () => {
    test('starts on: it only ever fires while you are elsewhere, which is when it is worth having', () => {
        expect(settingsFrom({}).agentsTurnNotify).toBe(true);
        expect(settingsFrom({ agentsKeepAwake: true }).agentsTurnNotify).toBe(true);
    });

    test('is off for a stored false and for nothing else', () => {
        expect(settingsFrom({ agentsTurnNotify: false }).agentsTurnNotify).toBe(false);
        expect(settingsFrom({ agentsTurnNotify: 0 as unknown as boolean }).agentsTurnNotify).toBe(true);
    });

    test('makes no sound until somebody asks for one', () => {
        expect(settingsFrom({}).agentsTurnSound).toBe(false);
        expect(settingsFrom({ agentsTurnNotify: true }).agentsTurnSound).toBe(false);
        expect(settingsFrom({ agentsTurnSound: true }).agentsTurnSound).toBe(true);
        expect(settingsFrom({ agentsTurnSound: 1 as unknown as boolean }).agentsTurnSound).toBe(false);
    });
});

describe('streaming replies', () => {
    test('starts a word at a time, and a mode that is stored is kept', () => {
        expect(settingsFrom({}).chatStreaming).toBe('words');
        expect(settingsFrom({ chatStreaming: 'blocks' }).chatStreaming).toBe('blocks');
        expect(settingsFrom({ chatStreaming: 'whole' }).chatStreaming).toBe('whole');
    });

    test('the switch it used to be reads as the mode it meant, and anything else as words', () => {
        const stored = (value: unknown) => settingsFrom({ chatStreaming: value as 'words' }).chatStreaming;
        expect(stored(true)).toBe('words');
        expect(stored(false)).toBe('whole');
        expect(stored(0)).toBe('words');
        expect(stored('paragraphs')).toBe('words');
    });
});

describe('GPT-Live speech', () => {
    test('starts in Dutch with Marin and keeps supported choices', () => {
        expect(settingsFrom({})).toMatchObject({
            voiceLanguage: 'nl',
            liveVoice: 'marin',
            voiceInputDeviceId: 'default',
            voiceConfirmDestructiveActions: true
        });
        expect(settingsFrom({ voiceLanguage: 'ja', liveVoice: 'cedar', voiceInputDeviceId: 'iphone', voiceConfirmDestructiveActions: false })).toMatchObject({
            voiceLanguage: 'ja',
            liveVoice: 'cedar',
            voiceInputDeviceId: 'iphone',
            voiceConfirmDestructiveActions: false
        });
    });

    test('does not pass unknown stored values to a Live session', () => {
        expect(settingsFrom({ voiceLanguage: 'klingon' as 'nl', liveVoice: 'robot' as 'marin' })).toMatchObject({
            voiceLanguage: 'nl',
            liveVoice: 'marin'
        });
        expect(settingsFrom({ liveVoice: 'willow' as 'marin' }).liveVoice).toBe('marin');
    });

    test('moves the earlier male and female choices to their named voices', () => {
        expect(settingsFrom({ voiceGender: 'male' } as never).liveVoice).toBe('cedar');
        expect(settingsFrom({ voiceGender: 'female' } as never).liveVoice).toBe('marin');
    });

    test('does not keep an invalid microphone id', () => {
        expect(settingsFrom({ voiceInputDeviceId: '' }).voiceInputDeviceId).toBe('default');
        expect(settingsFrom({ voiceInputDeviceId: 42 as unknown as string }).voiceInputDeviceId).toBe('default');
    });

    test('only skips destructive-action confirmation after an explicit stored choice', () => {
        expect(settingsFrom({ voiceConfirmDestructiveActions: false }).voiceConfirmDestructiveActions).toBe(false);
        expect(settingsFrom({ voiceConfirmDestructiveActions: 0 as unknown as boolean }).voiceConfirmDestructiveActions).toBe(true);
    });
});

describe('swiping between pages', () => {
    test('starts on, the way every browser on macOS does it', () => {
        expect(settingsFrom({}).browserSwipe).toBe(true);
    });

    test('is off for a stored false and for nothing else', () => {
        expect(settingsFrom({ browserSwipe: false }).browserSwipe).toBe(false);
        expect(settingsFrom({ browserSwipe: 0 as unknown as boolean }).browserSwipe).toBe(true);
    });
});

describe('the rest of a stored blob', () => {
    test('a key that is there is kept, and a size out of range is pulled back into it', () => {
        const settings = settingsFrom({ fontSize: 99, filesShowHidden: true, browseStartFolder: '/Users/bas' });
        expect(settings.fontSize).toBe(20);
        expect(settings.filesShowHidden).toBe(true);
        expect(settings.browseStartFolder).toBe('/Users/bas');
    });
});

describe('the STUN servers of a direct connection', () => {
    test('start on the coturn Ruimte runs, which answers without a credential', () => {
        expect(settingsFrom({}).directStunServers).toBe('stun:turn.ruimte.app:3478');
        expect(iceServersFrom(DEFAULT_STUN_SERVER)).toEqual([{ urls: ['stun:turn.ruimte.app:3478'] }]);
    });

    test('leave the value under the old key behind, which for nearly every client was the previous default', () => {
        const stored = { directStunServer: 'stun:stun.example.com:19302' } as Partial<Parameters<typeof settingsFrom>[0]>;
        expect(settingsFrom(stored).directStunServers).toBe(DEFAULT_STUN_SERVER);
    });

    test('keep what is stored under the new key, an empty field for this network only included', () => {
        expect(settingsFrom({ directStunServers: 'stun:a.example.com stun:b.example.com' }).directStunServers).toBe('stun:a.example.com stun:b.example.com');
        expect(settingsFrom({ directStunServers: '' }).directStunServers).toBe('');
        expect(settingsFrom({ directStunServers: 3 as unknown as string }).directStunServers).toBe(DEFAULT_STUN_SERVER);
    });
});

describe('worktreeMergeStrategy', () => {
    test('starts on squash and keeps what this client picked, but not a strategy that does not exist', () => {
        expect(settingsFrom({}).worktreeMergeStrategy).toBe('squash');
        expect(settingsFrom({ worktreeMergeStrategy: 'rebase' }).worktreeMergeStrategy).toBe('rebase');
        expect(settingsFrom({ worktreeMergeStrategy: 'octopus' as unknown as 'merge' }).worktreeMergeStrategy).toBe('squash');
    });
});

describe('the colors of code', () => {
    test('start on our own theme, light and dark', () => {
        expect(settingsFrom({})).toMatchObject({ codeThemeLight: 'ruimte-light', codeThemeDark: 'ruimte-dark' });
    });

    test('keep a theme Shiki bundles for that side', () => {
        expect(settingsFrom({ codeThemeLight: 'github-light', codeThemeDark: 'github-dark' })).toMatchObject({
            codeThemeLight: 'github-light',
            codeThemeDark: 'github-dark'
        });
    });

    test('keep one of our own themes for its side', () => {
        expect(settingsFrom({ codeThemeLight: 'ruimte-light', codeThemeDark: 'ruimte-dark' })).toMatchObject({
            codeThemeLight: 'ruimte-light',
            codeThemeDark: 'ruimte-dark'
        });
        expect(settingsFrom({ codeThemeLight: 'ruimte-dark', codeThemeDark: 'ruimte-light' })).toMatchObject({
            codeThemeLight: 'ruimte-light',
            codeThemeDark: 'ruimte-dark'
        });
    });

    test('drop a theme that is gone, or one made for the other side', () => {
        expect(settingsFrom({ codeThemeLight: 'retired-theme', codeThemeDark: 42 as unknown as string })).toMatchObject({
            codeThemeLight: 'ruimte-light',
            codeThemeDark: 'ruimte-dark'
        });
        expect(settingsFrom({ codeThemeLight: 'github-dark', codeThemeDark: 'github-light' })).toMatchObject({
            codeThemeLight: 'ruimte-light',
            codeThemeDark: 'ruimte-dark'
        });
    });

    test('offer our own theme first, then every bundled theme, each on its own side only', () => {
        const light = codeThemesOf('light');
        const dark = codeThemesOf('dark');
        expect(light[0]?.id).toBe('ruimte-light');
        expect(dark[0]?.id).toBe('ruimte-dark');
        expect(light.map((info) => info.id)).toContain('night-owl-light');
        expect(dark.map((info) => info.id)).toContain('night-owl');
        expect(light.every((info) => info.type === 'light')).toBe(true);
        expect(dark.every((info) => info.type === 'dark')).toBe(true);
    });
});

describe('wrapping long lines of code', () => {
    test('is off until a person turns it on', () => {
        expect(settingsFrom({}).codeWrap).toBe(false);
        expect(settingsFrom({ codeWrap: true }).codeWrap).toBe(true);
        expect(settingsFrom({ codeWrap: 'yes' as unknown as boolean }).codeWrap).toBe(false);
    });
});

describe('sidebar scope', () => {
    test('requires an explicit opt-in, including when loading old or invalid settings', () => {
        expect(settingsFrom({}).sidebarScope).toBe('current');
        expect(settingsFrom({ sidebarScope: 'all-open' }).sidebarScope).toBe('all-open');
        expect(settingsFrom({ sidebarScope: true as unknown as 'current' }).sidebarScope).toBe('current');
        expect(settingsFrom({ sidebarScope: 'all' as 'current' }).sidebarScope).toBe('current');
    });
});
