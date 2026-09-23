import { bundledThemesInfo } from 'shiki/themes';
import { create } from 'zustand';
import { isLiveVoice, isVoiceLanguage, WorktreeMergeStrategySchema, type LiveVoice, type VoiceLanguage, type WorktreeMergeStrategy } from '@ruimte/contracts';
import { DEFAULT_STUN_SERVER } from '@ruimte/pulsar';
import { accentColor, NODE_ACCENTS, type AccentId } from '@/canvas/accents';
import { FORMAT_LANGUAGE, formatRegionFrom } from '@/format/regions';
import { LANGUAGE_SYSTEM, languageFrom } from '@/i18n/languages';
import { CODE_THEMES } from '@/shell/panels/code-themes';

const STORAGE_KEY = 'ruimte.settings';

export const MONO_FONTS = [
    { id: 'system', label: 'System', stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
    { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
    { id: 'fira', label: 'Fira Code', stack: '"Fira Code", ui-monospace, Menlo, monospace' },
    { id: 'menlo', label: 'Menlo', stack: 'Menlo, ui-monospace, monospace' }
] as const;

export type MonoFontId = (typeof MONO_FONTS)[number]['id'];

const WORKTREE_MERGE_STRATEGIES: readonly WorktreeMergeStrategy[] = WorktreeMergeStrategySchema.options;

/*
 * How a reply appears while it is written: a word at a time, a block at a time once each block is
 * closed, or whole once it is done.
 */
export type ChatStreamingMode = 'words' | 'blocks' | 'whole';

export const CHAT_STREAMING_MODES: readonly ChatStreamingMode[] = ['words', 'blocks', 'whole'];

/* A stored mode, or the switch it used to be: on was a word at a time, off was whole. */
export const chatStreamingFrom = (stored: unknown): ChatStreamingMode => {
    if (stored === false) {
        return 'whole';
    }
    return CHAT_STREAMING_MODES.find((mode) => mode === stored) ?? 'words';
};

export interface CodeThemeInfo {
    readonly id: string;
    readonly displayName: string;
    readonly type: 'light' | 'dark';
}

/* The themes code can be drawn in under the app's light or dark: ours first, then Shiki's in its own order. */
export const codeThemesOf = (mode: 'light' | 'dark'): readonly CodeThemeInfo[] => [
    ...CODE_THEMES.filter((theme) => theme.type === mode).map(({ name, displayName, type }) => ({ id: name, displayName, type })),
    ...bundledThemesInfo.filter((info) => info.type === mode)
];

/* A stored code theme id, if it is still one of ours or one Shiki bundles for that mode. */
const codeThemeFrom = (stored: unknown, mode: 'light' | 'dark', fallback: string): string =>
    codeThemesOf(mode).find((info) => info.id === stored)?.id ?? fallback;

export const FONT_SIZE_RANGE = { min: 10, max: 20, step: 1 } as const;
export const INTERFACE_FONT_SIZE_RANGE = { min: 14, max: 24, step: 1 } as const;
export const FILES_TAB_LIMIT_RANGE = { min: 1, max: 20, step: 1 } as const;

export interface Settings {
    sidebarScope: 'current' | 'all-open';
    /* One of the node accents. Blue is the brand's own and the one a fresh client starts on. */
    accent: AccentId;
    font: MonoFontId;
    /* Terminal font size in px; every terminal refits when it changes. */
    fontSize: number;
    /* The root font size in px, so the rem-based interface scales with it. Code and the terminal
       keep their own absolute sizes and stay put. */
    interfaceFontSize: number;
    /* How many files the viewer keeps open before the oldest unpinned tab makes room. */
    filesTabLimit: number;
    /* Whether the files tree shows dotfiles; the panel's eye button writes the same value. */
    filesShowHidden: boolean;
    /* Where the palette starts when it browses for a folder to open. Empty is the home of whichever
       machine is being browsed. One setting for every machine rather than one per machine, because
       the folders people keep their work in have the same name everywhere; a path that is not on the
       machine being browsed falls back to its home, which `fs.browse` answering `exists` can tell. */
    browseStartFolder: string;
    /* The Shiki theme id code is drawn in while the app is light, in the viewer, the editor and a chat. */
    codeThemeLight: string;
    /* The same while the app is dark. */
    codeThemeDark: string;
    /* Whether a long line of code wraps in the viewer and the editor. A diff keeps its own switch. */
    codeWrap: boolean;
    /* Whether a diff draws the two sides next to each other or one patch under the other. */
    diffLayout: 'stacked' | 'split';
    /* Whether a diff counts and shows changes that are whitespace alone. */
    diffWhitespace: boolean;
    /* How the merge dialog lands a worktree, as last picked on this client. */
    worktreeMergeStrategy: WorktreeMergeStrategy;
    /* Whether a drawing snaps to the canvas grid while you draw. Cmd inverts it for one gesture. */
    drawingSnap: boolean;
    /* Whether the dock of a canvas or a drawing waits below the edge until the pointer comes near. */
    dockAutoHide: boolean;
    /* How a reply in a chat appears while it is written. Only how this client draws it: the daemon
       sends the deltas either way. */
    chatStreaming: ChatStreamingMode;
    voiceLanguage: VoiceLanguage;
    liveVoice: LiveVoice;
    voiceInputDeviceId: string;
    /* Whether Voice pauses before deleting project data. */
    voiceConfirmDestructiveActions: boolean;
    /* Whether the desktop shell downloads an update as soon as it finds one, or waits to be asked. */
    updatesAutoDownload: boolean;
    /* Whether a view an agent asks for takes the place of the one you are working in. Off, which is
       where everyone starts, nothing moves and the request waits in the banner over the views.
       Making is shared and the daemon enforces it; looking is one person at one screen, so moving
       someone's eyes is the one thing that is asked rather than done. */
    agentsShowViews: boolean;
    /* Whether a permission a terminal agent asks for is offered in the node's header. On, because the
       whole point of the canvas is that the terminal you would have answered in is somewhere else,
       and either answer settles it, so this takes nothing away from the CLI's own prompt. Off, the
       machine is told to hold nothing for this client and the prompt in the terminal is the only
       place to answer; another client that wants them is asked as before. */
    agentsApprovals: boolean;
    /* Whether this machine stays awake while an agent works. About the computer this window runs on
       and nothing else, which is why it sits with the client and not with a project or a daemon.
       Off to start with: a laptop that never sleeps is not something to arrange behind someone. */
    agentsKeepAwake: boolean;
    /* Whether a turn that ends while this window is not the one in front says so, as a notification
       of the operating system. On. The point of the whole thing is the moment somebody walked away,
       and it never fires while the window is in front, so it cannot land on top of what you are doing. */
    agentsTurnNotify: boolean;
    /* Whether those notifications make a sound. Off, because a sound arrives in whatever the person
       walked away to do, which may be a call. */
    agentsTurnSound: boolean;
    /* Whether two fingers sideways on a trackpad go back and forward in a browser page. On, because
       it is what every browser on macOS does; off, the pages do not even report their wheel. */
    browserSwipe: boolean;
    /* The STUN servers a direct connection asks for this client's public address, separated by spaces.
       Empty offers the addresses of this machine's own interfaces only, which is enough on one network. */
    directStunServers: string;
    /* Which language the interface is written in. `system` is whatever the operating system asks
       for, and one of `APP_LANGUAGES` overrules it. */
    language: string;
    /* Which region writes the numbers, dates and times. `language` follows whatever the interface
       is written in, `system` follows the operating system, and a tag from `FORMAT_REGIONS`
       overrules both. The two are apart because a person can read one language in another country's
       notation, which is what an English app on a Dutch Mac already was. */
    formatRegion: string;
}

/* What `RTCPeerConnection` takes for the servers in the setting; none for an empty field. */
export const iceServersFrom = (value: string): RTCIceServer[] => {
    const urls = value.split(/[\s,]+/).filter((url) => url !== '');
    return urls.length === 0 ? [] : [{ urls }];
};

interface SettingsStore extends Settings {
    /* Bumped on every change, so a terminal knows to read the tokens again. */
    version: number;
    update(patch: Partial<Settings>): void;
}

const DEFAULT_SETTINGS: Settings = {
    sidebarScope: 'current',
    accent: 'blue',
    font: 'system',
    fontSize: 13,
    interfaceFontSize: 15,
    filesTabLimit: 5,
    filesShowHidden: false,
    browseStartFolder: '',
    codeThemeLight: 'night-owl-light',
    codeThemeDark: 'night-owl',
    codeWrap: false,
    diffLayout: 'stacked',
    diffWhitespace: true,
    worktreeMergeStrategy: 'squash',
    drawingSnap: false,
    dockAutoHide: false,
    chatStreaming: 'words',
    voiceLanguage: 'nl',
    liveVoice: 'marin',
    voiceInputDeviceId: 'default',
    voiceConfirmDestructiveActions: true,
    updatesAutoDownload: true,
    agentsShowViews: false,
    agentsApprovals: true,
    agentsKeepAwake: false,
    agentsTurnNotify: true,
    agentsTurnSound: false,
    browserSwipe: true,
    directStunServers: DEFAULT_STUN_SERVER,
    language: LANGUAGE_SYSTEM,
    formatRegion: FORMAT_LANGUAGE
};

// Rounded as well as clamped. The stepper used to move in halves, so a browser can still hand back
// a half pixel from before, and both text and the terminal render sharpest on a whole one.
const clampSize = (value: unknown, range: { min: number; max: number }, fallback: number): number => {
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(range.max, Math.max(range.min, size));
};

/* What a stored blob means, key by key. Everything a client wrote before a setting existed, or wrote
   as something else, reads as what a fresh client gets. */
export const settingsFrom = (stored: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...stored,
    sidebarScope: stored.sidebarScope === 'all-open' ? 'all-open' : 'current',
    fontSize: clampSize(stored.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize),
    interfaceFontSize: clampSize(stored.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize),
    filesTabLimit: clampSize(stored.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit),
    // A path is typed by hand and read back as one; anything else in the blob is no folder.
    browseStartFolder: typeof stored.browseStartFolder === 'string' ? stored.browseStartFolder : DEFAULT_SETTINGS.browseStartFolder,
    codeThemeLight: codeThemeFrom(stored.codeThemeLight, 'light', DEFAULT_SETTINGS.codeThemeLight),
    codeThemeDark: codeThemeFrom(stored.codeThemeDark, 'dark', DEFAULT_SETTINGS.codeThemeDark),
    codeWrap: stored.codeWrap === true,
    // A client that stored null for the theme's own accent, or an id that has since gone, lands on the brand's.
    accent: NODE_ACCENTS.find((entry) => entry.id === stored.accent)?.id ?? DEFAULT_SETTINGS.accent,
    // Nothing moves a person's eyes unless that person said so, so only a stored `true` turns it on.
    agentsShowViews: stored.agentsShowViews === true,
    // Same rule. Nothing keeps a laptop from sleeping unless a stored `true` asked for it.
    agentsKeepAwake: stored.agentsKeepAwake === true,
    // The two that start on, so only a stored `false` turns either of them off.
    agentsApprovals: stored.agentsApprovals !== false,
    agentsTurnNotify: stored.agentsTurnNotify !== false,
    chatStreaming: chatStreamingFrom(stored.chatStreaming),
    voiceLanguage: isVoiceLanguage(stored.voiceLanguage) ? stored.voiceLanguage : 'nl',
    liveVoice: isLiveVoice(stored.liveVoice)
        ? stored.liveVoice
        : (stored as Partial<Settings> & { voiceGender?: unknown }).voiceGender === 'male'
          ? 'cedar'
          : 'marin',
    voiceInputDeviceId:
        typeof stored.voiceInputDeviceId === 'string' && stored.voiceInputDeviceId.trim() !== ''
            ? stored.voiceInputDeviceId
            : DEFAULT_SETTINGS.voiceInputDeviceId,
    voiceConfirmDestructiveActions: stored.voiceConfirmDestructiveActions !== false,
    // Same rule as the block. Nothing makes a sound unless a stored `true` asked for it.
    agentsTurnSound: stored.agentsTurnSound === true,
    browserSwipe: stored.browserSwipe !== false,
    worktreeMergeStrategy: WORKTREE_MERGE_STRATEGIES.find((strategy) => strategy === stored.worktreeMergeStrategy) ?? DEFAULT_SETTINGS.worktreeMergeStrategy,
    // The key before it, `directStunServer`, held the previous default for nearly every client, since the field was hidden
    // and every save writes the whole blob; a new key leaves that value behind instead of recognizing it.
    directStunServers: typeof stored.directStunServers === 'string' ? stored.directStunServers : DEFAULT_SETTINGS.directStunServers,
    language: languageFrom(stored.language),
    formatRegion: formatRegionFrom(stored.formatRegion)
});

const read = (): Settings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return settingsFrom(raw ? (JSON.parse(raw) as Partial<Settings>) : {});
    } catch {
        return DEFAULT_SETTINGS;
    }
};

/* The accent as channels. A token that needs it with an alpha writes `rgb(var(--accent-rgb) / a)`,
   which still computes to a literal color for the reader that wants one, the terminal above all. */
const channelsOf = (hex: string): string => {
    const value = Number.parseInt(hex.slice(1), 16);
    return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
};

/* The few tokens a person may change are set on the root, over the theme's own values. */
const apply = (settings: Settings): void => {
    // The tokens are written on the document, and a test that reads this module for its defaults has none.
    if (typeof document === 'undefined') {
        return;
    }
    const root = document.documentElement.style;
    root.setProperty('font-size', `${settings.interfaceFontSize}px`);
    const accent = accentColor(settings.accent);
    if (accent) {
        root.setProperty('--accent', accent);
        root.setProperty('--accent-rgb', channelsOf(accent));
        root.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 16%, var(--surface))`);
        root.setProperty('--term-cursor', accent);
    }
    const font = MONO_FONTS.find((entry) => entry.id === settings.font);
    if (font && font.id !== 'system') {
        root.setProperty('--font-mono', font.stack);
    } else {
        root.removeProperty('--font-mono');
    }
};

export const useSettings = create<SettingsStore>((set, get) => {
    const initial = read();
    apply(initial);
    return {
        ...initial,
        version: 0,
        update(patch) {
            const {
                sidebarScope,
                accent,
                font,
                fontSize,
                interfaceFontSize,
                filesTabLimit,
                filesShowHidden,
                browseStartFolder,
                codeThemeLight,
                codeThemeDark,
                codeWrap,
                diffLayout,
                diffWhitespace,
                worktreeMergeStrategy,
                drawingSnap,
                dockAutoHide,
                chatStreaming,
                voiceLanguage,
                liveVoice,
                voiceInputDeviceId,
                voiceConfirmDestructiveActions,
                updatesAutoDownload,
                agentsShowViews,
                agentsApprovals,
                agentsKeepAwake,
                agentsTurnNotify,
                agentsTurnSound,
                browserSwipe,
                directStunServers,
                language,
                formatRegion
            } = get();
            const next: Settings = {
                sidebarScope,
                accent,
                font,
                fontSize,
                interfaceFontSize,
                filesTabLimit,
                filesShowHidden,
                browseStartFolder,
                codeThemeLight,
                codeThemeDark,
                codeWrap,
                diffLayout,
                diffWhitespace,
                worktreeMergeStrategy,
                drawingSnap,
                dockAutoHide,
                chatStreaming,
                voiceLanguage,
                liveVoice,
                voiceInputDeviceId,
                voiceConfirmDestructiveActions,
                updatesAutoDownload,
                agentsShowViews,
                agentsApprovals,
                agentsKeepAwake,
                agentsTurnNotify,
                agentsTurnSound,
                browserSwipe,
                directStunServers,
                language,
                formatRegion,
                ...patch
            };
            next.fontSize = clampSize(next.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize);
            next.interfaceFontSize = clampSize(next.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize);
            next.filesTabLimit = clampSize(next.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Storage that refuses still leaves the setting on for this session.
            }
            apply(next);
            set({ ...next, version: get().version + 1 });
        }
    };
});
