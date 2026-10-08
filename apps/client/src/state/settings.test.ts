import { describe, expect, test } from 'bun:test';
import { DEFAULT_STUN_SERVER } from '@ruimte/pulsar';
import { DEFAULT_CODE_FOLDING } from './code-folding';
import { codeLineHeight, codeThemesOf, iceServersFrom, settingsFrom, useSettings, type KeepAwakeMode, type Settings } from './settings';

describe('panel layout', () => {
    test('keeps existing installations compact and accepts only the roomy option', () => {
        expect(settingsFrom({}).panelLayout).toBe('standard');
        expect(settingsFrom({ panelLayout: 'roomy' }).panelLayout).toBe('roomy');
        expect(settingsFrom({ panelLayout: 'wide' as Settings['panelLayout'] }).panelLayout).toBe('standard');
    });

    test('persists the choice through unrelated updates and reloads it for another window', () => {
        const previousStorage = globalThis.localStorage;
        const previous = useSettings.getState();
        const items = new Map<string, string>();
        globalThis.localStorage = {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => items.set(key, value)
        } as unknown as Storage;
        try {
            useSettings.getState().update({ panelLayout: 'roomy' });
            useSettings.getState().update({ dockAutoHide: true });
            useSettings.setState({ panelLayout: 'standard' });
            useSettings.getState().reload();
            expect(useSettings.getState().panelLayout).toBe('roomy');
            expect(useSettings.getState().dockAutoHide).toBe(true);
        } finally {
            globalThis.localStorage = previousStorage;
            useSettings.setState(previous);
        }
    });
});

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
    const legacy = (value: unknown): Partial<Settings> => ({ agentsKeepAwake: value }) as Partial<Settings>;

    test('is off until a person turns it on, since a laptop that never sleeps is a decision', () => {
        expect(settingsFrom({}).keepAwake).toBe('off');
        expect(settingsFrom({ agentsShowViews: true }).keepAwake).toBe('off');
        expect(settingsFrom({ keepAwake: 'sometimes' as unknown as KeepAwakeMode }).keepAwake).toBe('off');
    });

    test('keeps a stored mode', () => {
        expect(settingsFrom({ keepAwake: 'always' }).keepAwake).toBe('always');
        expect(settingsFrom({ keepAwake: 'working' }).keepAwake).toBe('working');
    });

    test('reads the switch it used to be: on was while an agent works, anything else is off', () => {
        expect(settingsFrom(legacy(true)).keepAwake).toBe('working');
        expect(settingsFrom(legacy(false)).keepAwake).toBe('off');
        expect(settingsFrom(legacy(1)).keepAwake).toBe('off');
    });

    test('a mode written since wins over the switch left beside it', () => {
        expect(settingsFrom({ ...legacy(true), keepAwake: 'off' }).keepAwake).toBe('off');
    });

    test('holds on the power adapter only, with the display allowed to sleep, until a person says otherwise', () => {
        expect(settingsFrom({}).keepAwakeOnBattery).toBe(false);
        expect(settingsFrom({}).keepAwakeDisplay).toBe(false);
        expect(settingsFrom({ keepAwakeOnBattery: true, keepAwakeDisplay: true })).toMatchObject({ keepAwakeOnBattery: true, keepAwakeDisplay: true });
        expect(settingsFrom({ keepAwakeOnBattery: 1 as unknown as boolean }).keepAwakeOnBattery).toBe(false);
    });
});

describe('agent notifications', () => {
    test('makes no sound until somebody asks for one', () => {
        expect(settingsFrom({}).agentsTurnSound).toBe(false);
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

describe('the code font size', () => {
    test('starts at 13 and is held to the range of the terminal, in whole pixels', () => {
        expect(settingsFrom({}).codeFontSize).toBe(13);
        expect(settingsFrom({ codeFontSize: 99 }).codeFontSize).toBe(20);
        expect(settingsFrom({ codeFontSize: 4 }).codeFontSize).toBe(10);
        expect(settingsFrom({ codeFontSize: 14.5 }).codeFontSize).toBe(15);
        expect(settingsFrom({ codeFontSize: '16' as unknown as number }).codeFontSize).toBe(13);
    });

    test('draws the default line height as 20px at the default size and in whole pixels at every size', () => {
        const { codeLineHeight: ratio } = settingsFrom({});
        expect(codeLineHeight(13, ratio)).toBe(20);
        for (let size = 10; size <= 20; size += 1) {
            expect(Math.abs(codeLineHeight(size, ratio) - Math.round((size * 20) / 13))).toBeLessThanOrEqual(1);
        }
    });

    test('rounds the code line to whole pixels for any multiplier', () => {
        expect(codeLineHeight(13, 1.2)).toBe(16);
        expect(codeLineHeight(13, 2.5)).toBe(33);
        expect(codeLineHeight(15, 1.3)).toBe(20);
        for (let size = 10; size <= 20; size += 1) {
            for (let step = 10; step <= 25; step += 1) {
                expect(Number.isInteger(codeLineHeight(size, step / 10))).toBe(true);
            }
        }
    });

    test('holds the code line height to 1 through 2.5 in steps of a tenth', () => {
        expect(settingsFrom({}).codeLineHeight).toBe(1.5);
        expect(settingsFrom({ codeLineHeight: 0.5 }).codeLineHeight).toBe(1);
        expect(settingsFrom({ codeLineHeight: 9 }).codeLineHeight).toBe(2.5);
        expect(settingsFrom({ codeLineHeight: 1.2000000000000002 }).codeLineHeight).toBe(1.2);
        expect(settingsFrom({ codeLineHeight: 1.54 }).codeLineHeight).toBe(1.5);
        expect(settingsFrom({ codeLineHeight: Number.NaN }).codeLineHeight).toBe(1.5);
        expect(settingsFrom({ codeLineHeight: '2' as unknown as number }).codeLineHeight).toBe(1.5);
    });

    test('holds the terminal line height to 1 through 2 in steps of a tenth', () => {
        expect(settingsFrom({}).terminalLineHeight).toBe(1);
        expect(settingsFrom({ terminalLineHeight: 0.8 }).terminalLineHeight).toBe(1);
        expect(settingsFrom({ terminalLineHeight: 3 }).terminalLineHeight).toBe(2);
        expect(settingsFrom({ terminalLineHeight: 1.14 }).terminalLineHeight).toBe(1.1);
        expect(settingsFrom({ terminalLineHeight: Number.POSITIVE_INFINITY }).terminalLineHeight).toBe(1);
    });

    test('clamps a line height written through update', () => {
        useSettings.getState().update({ codeLineHeight: 7, terminalLineHeight: 7 });
        expect(useSettings.getState().codeLineHeight).toBe(2.5);
        expect(useSettings.getState().terminalLineHeight).toBe(2);
        useSettings.getState().update({ codeLineHeight: 1.5, terminalLineHeight: 1 });
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

describe('what the editor draws', () => {
    test('has indent guides on and whitespace off until a person says otherwise', () => {
        expect(settingsFrom({}).codeIndentGuides).toBe(true);
        expect(settingsFrom({ codeIndentGuides: false }).codeIndentGuides).toBe(false);
        expect(settingsFrom({}).codeWhitespace).toBe(false);
        expect(settingsFrom({ codeWhitespace: true }).codeWhitespace).toBe(true);
        expect(settingsFrom({ codeWhitespace: 'yes' as unknown as boolean }).codeWhitespace).toBe(false);
    });
});

describe('code vision', () => {
    test('shows usages and authors until a person turns one off', () => {
        expect(settingsFrom({}).codeVisionUsages).toBe(true);
        expect(settingsFrom({}).codeVisionAuthors).toBe(true);
        expect(settingsFrom({ codeVisionUsages: false }).codeVisionUsages).toBe(false);
        expect(settingsFrom({ codeVisionAuthors: false }).codeVisionAuthors).toBe(false);
        expect(settingsFrom({ codeVisionAuthors: 'no' as unknown as boolean }).codeVisionAuthors).toBe(true);
    });
});

describe('code folding', () => {
    test('folds the file header and the imports until a person says otherwise', () => {
        expect(settingsFrom({}).codeFolding).toEqual(DEFAULT_CODE_FOLDING);
        expect(settingsFrom({ codeFolding: { imports: false } as never }).codeFolding.imports).toBe(false);
        expect(settingsFrom({ codeFolding: 'nope' as never }).codeFolding).toEqual(DEFAULT_CODE_FOLDING);
    });

    test('shows the outline on hover, and reads only an outline it knows', () => {
        expect(settingsFrom({}).codeFoldOutline).toBe('hover');
        expect(settingsFrom({ codeFoldOutline: 'always' }).codeFoldOutline).toBe('always');
        expect(settingsFrom({ codeFoldOutline: 'sometimes' as never }).codeFoldOutline).toBe('hover');
    });
});

describe('AI in the editor', () => {
    test('starts with Claude Code editing inline, changes in the gutter and the lines attributed', () => {
        const settings = settingsFrom({});
        expect(settings.aiInlineAgent).toEqual({ provider: 'claude', model: null });
        expect(settings.aiAgentChanges).toBe('gutter');
        expect(settings.aiAttribution).toBe(true);
    });

    test('reads a stored pick, and falls back for an agent or a mode it does not know', () => {
        expect(settingsFrom({ aiInlineAgent: { provider: 'codex', model: 'gpt-5' } }).aiInlineAgent).toEqual({ provider: 'codex', model: 'gpt-5' });
        expect(settingsFrom({ aiInlineAgent: { provider: 'nobody', model: 4 } as never }).aiInlineAgent).toEqual({ provider: 'claude', model: null });
        expect(settingsFrom({ aiAgentChanges: 'review' }).aiAgentChanges).toBe('review');
        expect(settingsFrom({ aiAgentChanges: 'loud' as never }).aiAgentChanges).toBe('gutter');
        expect(settingsFrom({ aiAttribution: false }).aiAttribution).toBe(false);
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

describe('a setting another window changed', () => {
    test('is read again, and every surface that reads the version sees it moved', () => {
        const items = new Map<string, string>([['ruimte.settings', JSON.stringify({ keepAwake: 'always', agentsShowViews: true })]]);
        const before = globalThis.localStorage;
        globalThis.localStorage = { getItem: (key: string) => items.get(key) ?? null } as Storage;
        try {
            const version = useSettings.getState().version;
            useSettings.getState().reload();
            expect(useSettings.getState().keepAwake).toBe('always');
            expect(useSettings.getState().agentsShowViews).toBe(true);
            expect(useSettings.getState().version).toBe(version + 1);
        } finally {
            globalThis.localStorage = before;
        }
    });
});

describe('the onboarding', () => {
    test('is unseen on a client that stored nothing about it, an install from before it included', () => {
        expect(settingsFrom({}).onboardingSeen).toBe(false);
        expect(settingsFrom({ accent: 'blue', keepAwake: 'always' }).onboardingIntroSeen).toBe(false);
    });

    test('stays seen only on a stored true', () => {
        expect(settingsFrom({ onboardingSeen: true, onboardingIntroSeen: true })).toMatchObject({ onboardingSeen: true, onboardingIntroSeen: true });
        expect(settingsFrom({ onboardingSeen: 'yes' as unknown as boolean }).onboardingSeen).toBe(false);
    });
});

describe('smart keys', () => {
    test('are on for a fresh client, except the camel humps', () => {
        expect(settingsFrom({}).smartKeys).toEqual({
            autoPairBrackets: true,
            autoPairQuotes: true,
            surroundSelection: true,
            tabOutOfClosers: true,
            smartIndentOnEnter: true,
            indentOnPaste: true,
            smartSemicolon: true,
            smartArrow: true,
            camelHumps: false
        });
    });

    test('keep what is stored and take the default for what is not, or is not a switch', () => {
        const stored = { autoPairQuotes: false, camelHumps: true, smartSemicolon: 'no' as unknown as boolean };
        expect(settingsFrom({ smartKeys: stored as never }).smartKeys).toMatchObject({
            autoPairQuotes: false,
            camelHumps: true,
            smartSemicolon: true,
            autoPairBrackets: true
        });
        expect(settingsFrom({ smartKeys: null as never }).smartKeys.camelHumps).toBe(false);
    });
});
