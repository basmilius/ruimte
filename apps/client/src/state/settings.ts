import { bundledThemesInfo } from 'shiki/themes';
import { create } from 'zustand';
import { isLiveVoice, isVoiceLanguage, WorktreeMergeStrategySchema, type LiveVoice, type VoiceLanguage, type WorktreeMergeStrategy } from '@ruimte/contracts';
import { DEFAULT_STUN_SERVER } from '@ruimte/pulsar';
import { accentColor, NODE_ACCENTS, type AccentId } from '@/canvas/accents';
import { FORMAT_LANGUAGE, formatRegionFrom } from '@adecore/ui/format';
import { LANGUAGE_SYSTEM, languageFrom } from '@/i18n/languages';
import type { EditorFoldOutline, EditorSmartKeys } from '@adecore/editor';
import {
    agentChangesModeFrom,
    DEFAULT_AGENT_CHANGES_MODE,
    DEFAULT_GHOST_TEXT_MODE,
    DEFAULT_INLINE_EDIT_AGENT,
    ghostTextModeFrom,
    inlineEditAgentFrom,
    type AgentChangesMode,
    type GhostTextMode,
    type InlineEditAgent
} from '@/state/ai-settings';
import { type CodeFolding, codeFoldingFrom, DEFAULT_CODE_FOLDING } from '@/state/code-folding';
import { CODE_THEMES } from '@/shell/panels/code-themes';

export const SETTINGS_STORAGE_KEY = 'ruimte.settings';

/* The editor's own defaults, written out so the settings never load the editor to know them. */
export const DEFAULT_SMART_KEYS: EditorSmartKeys = {
    autoPairBrackets: true,
    autoPairQuotes: true,
    surroundSelection: true,
    tabOutOfClosers: true,
    smartIndentOnEnter: true,
    indentOnPaste: true,
    smartSemicolon: true,
    smartArrow: true,
    camelHumps: false
};

/* A key a client has not stored is what a fresh one gets, so the keys a later version adds start as it decides. */
export function smartKeysFrom(stored: unknown): EditorSmartKeys {
    const keys: Partial<Record<keyof EditorSmartKeys, unknown>> = typeof stored === 'object' && stored !== null ? stored : {};
    const result = { ...DEFAULT_SMART_KEYS };
    for (const name of Object.keys(DEFAULT_SMART_KEYS) as (keyof EditorSmartKeys)[]) {
        if (typeof keys[name] === 'boolean') {
            result[name] = keys[name];
        }
    }
    return result;
}

export const FOLD_OUTLINES: readonly EditorFoldOutline[] = ['off', 'hover', 'always'];

export const MONO_FONTS = [
    { id: 'system', label: 'System', stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
    { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
    { id: 'fira', label: 'Fira Code', stack: '"Fira Code", ui-monospace, Menlo, monospace' },
    { id: 'menlo', label: 'Menlo', stack: 'Menlo, ui-monospace, monospace' }
] as const;

export type MonoFontId = (typeof MONO_FONTS)[number]['id'];

/* Installed faces only: Geist is bundled for the wordmark alone. */
export const INTERFACE_FONTS = [
    { id: 'system', label: 'System', stack: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' },
    { id: 'inter', label: 'Inter', stack: '"Inter", "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    { id: 'plex', label: 'IBM Plex Sans', stack: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    { id: 'helvetica', label: 'Helvetica Neue', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' }
] as const;

export type InterfaceFontId = (typeof INTERFACE_FONTS)[number]['id'];

const WORKTREE_MERGE_STRATEGIES: readonly WorktreeMergeStrategy[] = WorktreeMergeStrategySchema.options;

/*
 * How a reply appears while it is written: a word at a time, a block at a time once each block is
 * closed, or whole once it is done.
 */
export type ChatStreamingMode = 'words' | 'blocks' | 'whole';

export const CHAT_STREAMING_MODES: readonly ChatStreamingMode[] = ['words', 'blocks', 'whole'];

/* A stored mode, or the switch it used to be: on was a word at a time, off was whole. */
export function chatStreamingFrom(stored: unknown): ChatStreamingMode {
    if (stored === false) {
        return 'whole';
    }
    return CHAT_STREAMING_MODES.find((mode) => mode === stored) ?? 'words';
}

/* When this computer stays awake: never, while an agent works, or all the time. */
export type KeepAwakeMode = 'off' | 'working' | 'always';

export const KEEP_AWAKE_MODES: readonly KeepAwakeMode[] = ['off', 'working', 'always'];

/* A stored mode, or the switch before it under `agentsKeepAwake`, whose on was while an agent works. */
export function keepAwakeFrom(stored: unknown, legacy: unknown): KeepAwakeMode {
    const mode = KEEP_AWAKE_MODES.find((entry) => entry === stored);
    if (mode) {
        return mode;
    }
    return legacy === true ? 'working' : 'off';
}

export interface CodeThemeInfo {
    readonly id: string;
    readonly displayName: string;
    readonly type: 'light' | 'dark';
}

/* The themes code can be drawn in under the app's light or dark: ours first, then Shiki's in its own order. */
export function codeThemesOf(mode: 'light' | 'dark'): readonly CodeThemeInfo[] {
    return [
        ...CODE_THEMES.filter((theme) => theme.type === mode).map(({ name, displayName, type }) => ({ id: name, displayName, type })),
        ...bundledThemesInfo.filter((info) => info.type === mode)
    ];
}

/* A stored code theme id, if it is still one of ours or one Shiki bundles for that mode. */
function codeThemeFrom(stored: unknown, mode: 'light' | 'dark', fallback: string): string {
    return codeThemesOf(mode).find((info) => info.id === stored)?.id ?? fallback;
}

export const FONT_SIZE_RANGE = { min: 10, max: 20, step: 1 } as const;
export const INTERFACE_FONT_SIZE_RANGE = { min: 14, max: 24, step: 1 } as const;
export const FILES_TAB_LIMIT_RANGE = { min: 1, max: 20, step: 1 } as const;

/* Multipliers of the font size. The code default gives 20px at the default 13px, the line a client drew before the setting. */
export const CODE_LINE_HEIGHT_RANGE = { min: 1, max: 2.5, step: 0.1 } as const;
export const TERMINAL_LINE_HEIGHT_RANGE = { min: 1, max: 2, step: 0.1 } as const;

/* The line a code size draws on, in whole pixels, since a fractional row blurs the text and drifts the editor's rows against the viewer's. */
export function codeLineHeight(size: number, ratio: number): number {
    return Math.round(size * ratio);
}

export interface Settings {
    sidebarScope: 'current' | 'all-open';
    panelLayout: 'standard' | 'roomy';
    /* "Needs you" lists what waits in every open project, not only the one on screen. The combined sidebar always does. */
    needsYouAllProjects: boolean;
    /* One of the node accents. Blue is the brand's own and the one a fresh client starts on. */
    accent: AccentId;
    interfaceFont: InterfaceFontId;
    font: MonoFontId;
    /* Terminal font size in px; every terminal refits when it changes. */
    fontSize: number;
    /* The root font size in px, so the rem-based interface scales with it. Code and the terminal
       keep their own absolute sizes and stay put. */
    interfaceFontSize: number;
    /* Code and diffs in the panels and the editor, in px. A chat keeps the interface's own code size. */
    codeFontSize: number;
    /* Code line height as a multiplier of `codeFontSize`; the line itself is always a whole number of pixels. */
    codeLineHeight: number;
    /* Terminal line height as xterm's `lineHeight` multiplier of the cell, 1 being the font's own. */
    terminalLineHeight: number;
    terminalLinkDestination: 'external' | 'ruimte';
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
    /* Whether a long line of code wraps in the viewer, the editor and a diff. */
    codeWrap: boolean;
    /* Whether the editor draws a line at each indentation level. */
    codeIndentGuides: boolean;
    /* Whether the editor draws spaces as dots and tabs as arrows. */
    codeWhitespace: boolean;
    /* Whether the editor says above a declaration how many times it is used. */
    codeVisionUsages: boolean;
    /* Whether the editor says above a declaration who wrote it, by git. */
    codeVisionAuthors: boolean;
    /* What folds by itself when a file opens, and when the arrow that folds shows in the gutter. */
    codeFolding: CodeFolding;
    codeFoldOutline: EditorFoldOutline;
    /* The agent that handles an inline edit, which runs as a chat in the project. */
    aiInlineAgent: InlineEditAgent;
    /* How the edits of a running chat show in the files that are open. */
    aiAgentChanges: AgentChangesMode;
    /* Whether the gutter marks the lines an agent wrote. */
    aiAttribution: boolean;
    /* Whether the hover explains code and rename suggests names, both with the model on the machine. */
    aiOnDeviceHelp: boolean;
    /* When the editor asks the model on the machine for ghost text. */
    aiGhostText: GhostTextMode;
    /* Whether a font draws `=>` or `!==` as one glyph. Off sets the whole document, since the diffs draw in a shadow root that only inheritance reaches. */
    codeLigatures: boolean;
    /* What the editor does by itself as you type. The defaults are the editor's own: all on, except the camel humps. */
    smartKeys: EditorSmartKeys;
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
    chatSteerByDefault: boolean;
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
    /* When this computer stays awake. About the computer this window runs on and nothing else, which is
       why it sits with the client and not with a project or a daemon. Off to start with: a laptop
       that never sleeps is not something to arrange behind someone. */
    keepAwake: KeepAwakeMode;
    /* Whether that holds on battery as well. Off, it holds on the power adapter only. */
    keepAwakeOnBattery: boolean;
    /* Whether the display stays on as well, which only `always` offers: while an agent works nobody
       needs to watch it. */
    keepAwakeDisplay: boolean;
    /* Whether agent notifications make a sound. Off, because a sound arrives in whatever the person
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
    /* Whether this client has met the onboarding: put off, closed or finished. A client from before it
       has nothing stored, which reads as not met, so every install meets it once. */
    onboardingSeen: boolean;
    /* Whether "How Ruimte works" was read here, the one task no machine can tell. */
    onboardingIntroSeen: boolean;
}

/* What `RTCPeerConnection` takes for the servers in the setting; none for an empty field. */
export function iceServersFrom(value: string): RTCIceServer[] {
    const urls = value.split(/[\s,]+/).filter((url) => url !== '');
    return urls.length === 0 ? [] : [{ urls }];
}

interface SettingsStore extends Settings {
    /* Bumped on every change, so a terminal knows to read the tokens again. */
    version: number;
    update(patch: Partial<Settings>): void;
    /* Reads what another window wrote, which that window already applied to itself. */
    reload(): void;
}

const DEFAULT_SETTINGS: Settings = {
    sidebarScope: 'current',
    panelLayout: 'standard',
    needsYouAllProjects: true,
    accent: 'blue',
    interfaceFont: 'system',
    font: 'system',
    fontSize: 13,
    interfaceFontSize: 15,
    codeFontSize: 13,
    codeLineHeight: 1.5,
    terminalLineHeight: 1,
    terminalLinkDestination: 'external',
    filesTabLimit: 5,
    filesShowHidden: false,
    browseStartFolder: '',
    codeThemeLight: 'ruimte-light',
    codeThemeDark: 'ruimte-dark',
    codeWrap: false,
    codeIndentGuides: true,
    codeWhitespace: false,
    codeVisionUsages: true,
    codeVisionAuthors: true,
    codeFolding: { ...DEFAULT_CODE_FOLDING },
    codeFoldOutline: 'hover',
    aiInlineAgent: { ...DEFAULT_INLINE_EDIT_AGENT },
    aiAgentChanges: DEFAULT_AGENT_CHANGES_MODE,
    aiAttribution: true,
    aiOnDeviceHelp: true,
    aiGhostText: DEFAULT_GHOST_TEXT_MODE,
    codeLigatures: true,
    smartKeys: { ...DEFAULT_SMART_KEYS },
    diffLayout: 'stacked',
    diffWhitespace: true,
    worktreeMergeStrategy: 'squash',
    drawingSnap: false,
    dockAutoHide: false,
    chatStreaming: 'words',
    chatSteerByDefault: false,
    voiceLanguage: 'nl',
    liveVoice: 'marin',
    voiceInputDeviceId: 'default',
    voiceConfirmDestructiveActions: true,
    updatesAutoDownload: true,
    agentsShowViews: false,
    keepAwake: 'off',
    keepAwakeOnBattery: false,
    keepAwakeDisplay: false,
    agentsTurnSound: false,
    browserSwipe: true,
    directStunServers: DEFAULT_STUN_SERVER,
    language: LANGUAGE_SYSTEM,
    formatRegion: FORMAT_LANGUAGE,
    onboardingSeen: false,
    onboardingIntroSeen: false
};

// Rounded as well as clamped. The stepper used to move in halves, so a browser can still hand back
// a half pixel from before, and both text and the terminal render sharpest on a whole one.
function clampSize(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(range.max, Math.max(range.min, size));
}

// One decimal, the step of the stepper, so a float that drifted in storage reads back as what was shown.
function clampRatio(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const ratio = typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : fallback;
    return Math.min(range.max, Math.max(range.min, ratio));
}

/* What a stored blob means, key by key. Everything a client wrote before a setting existed, or wrote
   as something else, reads as what a fresh client gets. */
export function settingsFrom(stored: Partial<Settings>): Settings {
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        panelLayout: stored.panelLayout === 'roomy' ? 'roomy' : 'standard',
        sidebarScope: stored.sidebarScope === 'all-open' ? 'all-open' : 'current',
        needsYouAllProjects: stored.needsYouAllProjects !== false,
        fontSize: clampSize(stored.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize),
        interfaceFontSize: clampSize(stored.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize),
        codeFontSize: clampSize(stored.codeFontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.codeFontSize),
        codeLineHeight: clampRatio(stored.codeLineHeight, CODE_LINE_HEIGHT_RANGE, DEFAULT_SETTINGS.codeLineHeight),
        terminalLineHeight: clampRatio(stored.terminalLineHeight, TERMINAL_LINE_HEIGHT_RANGE, DEFAULT_SETTINGS.terminalLineHeight),
        terminalLinkDestination: stored.terminalLinkDestination === 'ruimte' ? 'ruimte' : 'external',
        filesTabLimit: clampSize(stored.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit),
        // A path is typed by hand and read back as one; anything else in the blob is no folder.
        browseStartFolder: typeof stored.browseStartFolder === 'string' ? stored.browseStartFolder : DEFAULT_SETTINGS.browseStartFolder,
        codeThemeLight: codeThemeFrom(stored.codeThemeLight, 'light', DEFAULT_SETTINGS.codeThemeLight),
        codeThemeDark: codeThemeFrom(stored.codeThemeDark, 'dark', DEFAULT_SETTINGS.codeThemeDark),
        codeWrap: stored.codeWrap === true,
        codeIndentGuides: stored.codeIndentGuides !== false,
        codeWhitespace: stored.codeWhitespace === true,
        codeVisionUsages: stored.codeVisionUsages !== false,
        codeVisionAuthors: stored.codeVisionAuthors !== false,
        codeFolding: codeFoldingFrom(stored.codeFolding),
        codeFoldOutline: FOLD_OUTLINES.find((outline) => outline === stored.codeFoldOutline) ?? DEFAULT_SETTINGS.codeFoldOutline,
        aiInlineAgent: inlineEditAgentFrom(stored.aiInlineAgent),
        aiAgentChanges: agentChangesModeFrom(stored.aiAgentChanges),
        aiAttribution: stored.aiAttribution !== false,
        aiOnDeviceHelp: stored.aiOnDeviceHelp !== false,
        aiGhostText: ghostTextModeFrom(stored.aiGhostText),
        codeLigatures: stored.codeLigatures !== false,
        smartKeys: smartKeysFrom(stored.smartKeys),
        // A client that stored null for the theme's own accent, or an id that has since gone, lands on the brand's.
        accent: NODE_ACCENTS.find((entry) => entry.id === stored.accent)?.id ?? DEFAULT_SETTINGS.accent,
        // Nothing moves a person's eyes unless that person said so, so only a stored `true` turns it on.
        agentsShowViews: stored.agentsShowViews === true,
        // Same rule. Nothing keeps a laptop from sleeping unless a person asked for it.
        keepAwake: keepAwakeFrom(stored.keepAwake, (stored as Partial<Settings> & { agentsKeepAwake?: unknown }).agentsKeepAwake),
        keepAwakeOnBattery: stored.keepAwakeOnBattery === true,
        keepAwakeDisplay: stored.keepAwakeDisplay === true,
        chatStreaming: chatStreamingFrom(stored.chatStreaming),
        chatSteerByDefault: stored.chatSteerByDefault === true,
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
        agentsTurnSound: stored.agentsTurnSound === true,
        browserSwipe: stored.browserSwipe !== false,
        worktreeMergeStrategy:
            WORKTREE_MERGE_STRATEGIES.find((strategy) => strategy === stored.worktreeMergeStrategy) ?? DEFAULT_SETTINGS.worktreeMergeStrategy,
        // The key before it, `directStunServer`, held the previous default for nearly every client, since the field was hidden
        // and every save writes the whole blob; a new key leaves that value behind instead of recognizing it.
        directStunServers: typeof stored.directStunServers === 'string' ? stored.directStunServers : DEFAULT_SETTINGS.directStunServers,
        language: languageFrom(stored.language),
        formatRegion: formatRegionFrom(stored.formatRegion),
        onboardingSeen: stored.onboardingSeen === true,
        onboardingIntroSeen: stored.onboardingIntroSeen === true
    };
}

function read(): Settings {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        return settingsFrom(raw ? (JSON.parse(raw) as Partial<Settings>) : {});
    } catch {
        return DEFAULT_SETTINGS;
    }
}

/* The accent as channels. A token that needs it with an alpha writes `rgb(var(--accent-rgb) / a)`,
   which still computes to a literal color for the reader that wants one, the terminal above all. */
function channelsOf(hex: string): string {
    const value = Number.parseInt(hex.slice(1), 16);
    return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/* The few tokens a person may change are set on the root, over the theme's own values. */
function apply(settings: Settings): void {
    // The tokens are written on the document, and a test that reads this module for its defaults has none.
    if (typeof document === 'undefined') {
        return;
    }
    document.documentElement.dataset.panelLayout = settings.panelLayout;
    const root = document.documentElement.style;
    root.setProperty('font-size', `${settings.interfaceFontSize}px`);
    root.setProperty('--code-font-size', `${settings.codeFontSize}px`);
    root.setProperty('--code-line-height', `${codeLineHeight(settings.codeFontSize, settings.codeLineHeight)}px`);
    const accent = accentColor(settings.accent);
    if (accent) {
        root.setProperty('--accent', accent);
        root.setProperty('--accent-rgb', channelsOf(accent));
        root.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 16%, var(--surface))`);
        root.setProperty('--term-cursor', accent);
    }
    const interfaceFont = INTERFACE_FONTS.find((entry) => entry.id === settings.interfaceFont);
    if (interfaceFont && interfaceFont.id !== 'system') {
        root.setProperty('--font-sans', interfaceFont.stack);
    } else {
        root.removeProperty('--font-sans');
    }
    const font = MONO_FONTS.find((entry) => entry.id === settings.font);
    if (font && font.id !== 'system') {
        root.setProperty('--font-mono', font.stack);
    } else {
        root.removeProperty('--font-mono');
    }
    if (settings.codeLigatures) {
        root.removeProperty('font-variant-ligatures');
    } else {
        root.setProperty('font-variant-ligatures', 'none');
    }
}

export const useSettings = create<SettingsStore>((set, get) => {
    const initial = read();
    apply(initial);
    return {
        ...initial,
        version: 0,
        update(patch) {
            const {
                sidebarScope,
                panelLayout,
                needsYouAllProjects,
                accent,
                interfaceFont,
                font,
                fontSize,
                interfaceFontSize,
                codeFontSize,
                codeLineHeight,
                terminalLineHeight,
                terminalLinkDestination,
                filesTabLimit,
                filesShowHidden,
                browseStartFolder,
                codeThemeLight,
                codeThemeDark,
                codeWrap,
                codeIndentGuides,
                codeWhitespace,
                codeVisionUsages,
                codeVisionAuthors,
                codeFolding,
                codeFoldOutline,
                aiInlineAgent,
                aiAgentChanges,
                aiAttribution,
                aiOnDeviceHelp,
                aiGhostText,
                codeLigatures,
                smartKeys,
                diffLayout,
                diffWhitespace,
                worktreeMergeStrategy,
                drawingSnap,
                dockAutoHide,
                chatStreaming,
                chatSteerByDefault,
                voiceLanguage,
                liveVoice,
                voiceInputDeviceId,
                voiceConfirmDestructiveActions,
                updatesAutoDownload,
                agentsShowViews,
                keepAwake,
                keepAwakeOnBattery,
                keepAwakeDisplay,
                agentsTurnSound,
                browserSwipe,
                directStunServers,
                language,
                formatRegion,
                onboardingSeen,
                onboardingIntroSeen
            } = get();
            const next: Settings = {
                sidebarScope,
                panelLayout,
                needsYouAllProjects,
                accent,
                interfaceFont,
                font,
                fontSize,
                interfaceFontSize,
                codeFontSize,
                codeLineHeight,
                terminalLineHeight,
                terminalLinkDestination,
                filesTabLimit,
                filesShowHidden,
                browseStartFolder,
                codeThemeLight,
                codeThemeDark,
                codeWrap,
                codeIndentGuides,
                codeWhitespace,
                codeVisionUsages,
                codeVisionAuthors,
                codeFolding,
                codeFoldOutline,
                aiInlineAgent,
                aiAgentChanges,
                aiAttribution,
                aiOnDeviceHelp,
                aiGhostText,
                codeLigatures,
                smartKeys,
                diffLayout,
                diffWhitespace,
                worktreeMergeStrategy,
                drawingSnap,
                dockAutoHide,
                chatStreaming,
                chatSteerByDefault,
                voiceLanguage,
                liveVoice,
                voiceInputDeviceId,
                voiceConfirmDestructiveActions,
                updatesAutoDownload,
                agentsShowViews,
                keepAwake,
                keepAwakeOnBattery,
                keepAwakeDisplay,
                agentsTurnSound,
                browserSwipe,
                directStunServers,
                language,
                formatRegion,
                onboardingSeen,
                onboardingIntroSeen,
                ...patch
            };
            next.panelLayout = next.panelLayout === 'roomy' ? 'roomy' : 'standard';
            next.fontSize = clampSize(next.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize);
            next.interfaceFontSize = clampSize(next.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize);
            next.codeFontSize = clampSize(next.codeFontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.codeFontSize);
            next.codeLineHeight = clampRatio(next.codeLineHeight, CODE_LINE_HEIGHT_RANGE, DEFAULT_SETTINGS.codeLineHeight);
            next.terminalLineHeight = clampRatio(next.terminalLineHeight, TERMINAL_LINE_HEIGHT_RANGE, DEFAULT_SETTINGS.terminalLineHeight);
            next.filesTabLimit = clampSize(next.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit);
            try {
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Storage that refuses still leaves the setting on for this session.
            }
            apply(next);
            set({ ...next, version: get().version + 1 });
        },
        reload() {
            const next = read();
            apply(next);
            set({ ...next, version: get().version + 1 });
        }
    };
});
