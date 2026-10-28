import { bundledThemesInfo } from 'shiki/themes';
import { create } from 'zustand';
import { z } from 'zod';
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
import { storedJson, switchesFrom } from '@/state/stored-json';
import { applyPalette } from '@/state/palette';
import { palettePresetFrom, presetTokens, type PalettePreset } from '@/state/palette-presets';

export const SETTINGS_STORAGE_KEY = 'ruimte.settings';

/* The editor's own defaults, written out so the settings never load the editor to know them. */
const DEFAULT_SMART_KEYS: EditorSmartKeys = {
    autoPairBrackets: true,
    autoPairQuotes: true,
    surroundSelection: true,
    tabOutOfClosers: true,
    smartIndentOnEnter: true,
    indentOnPaste: true,
    smartSemicolon: true,
    smartArrow: true,
    templateLiterals: true,
    camelHumps: false
};

export const FOLD_OUTLINES: readonly EditorFoldOutline[] = ['off', 'hover', 'always'];

export const TRAILING_WHITESPACE_MODES = ['off', 'modified', 'all'] as const;

export type TrailingWhitespaceMode = (typeof TRAILING_WHITESPACE_MODES)[number];

export const MONO_FONTS = [
    { id: 'system', label: 'System', stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
    { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace' },
    { id: 'fira', label: 'Fira Code', stack: '"Fira Code Variable", ui-monospace, Menlo, monospace' },
    { id: 'menlo', label: 'Menlo', stack: 'Menlo, ui-monospace, monospace' }
] as const;

export type MonoFontId = (typeof MONO_FONTS)[number]['id'];

export type TerminalFontId = MonoFontId | 'editor';

export function monoFontStack(id: MonoFontId): string {
    return (MONO_FONTS.find((entry) => entry.id === id) ?? MONO_FONTS[0]).stack;
}

/* The face the terminals draw in: their own pick, or the editor's while the pick is `editor`. */
export function terminalFontOf(settings: Pick<Settings, 'font' | 'terminalFont'>): MonoFontId {
    return settings.terminalFont === 'editor' ? settings.font : settings.terminalFont;
}

/* Inter, IBM Plex Sans and Geist are bundled; a browser fetches a face only once a stack uses it. */
export const INTERFACE_FONTS = [
    { id: 'system', label: 'System', stack: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' },
    { id: 'inter', label: 'Inter', stack: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    { id: 'plex', label: 'IBM Plex Sans', stack: '"IBM Plex Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    { id: 'geist', label: 'Geist', stack: '"Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    { id: 'helvetica', label: 'Helvetica Neue', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' }
] as const;

export type InterfaceFontId = (typeof INTERFACE_FONTS)[number]['id'];

const WORKTREE_MERGE_STRATEGIES: readonly WorktreeMergeStrategy[] = WorktreeMergeStrategySchema.options;

/*
 * How a reply appears while it is written: a word at a time, a block at a time once each block is
 * closed, or whole once it is done.
 */
export type ChatStreamingMode = 'words' | 'blocks' | 'whole';

const CHAT_STREAMING_MODES: readonly ChatStreamingMode[] = ['words', 'blocks', 'whole'];

/* A stored mode, or the switch it used to be: on was a word at a time, off was whole. */
function chatStreamingFrom(stored: unknown): ChatStreamingMode {
    if (stored === false) {
        return 'whole';
    }
    return CHAT_STREAMING_MODES.find((mode) => mode === stored) ?? 'words';
}

/* When this computer stays awake: never, while an agent works, or all the time. */
export type KeepAwakeMode = 'off' | 'working' | 'always';

const KEEP_AWAKE_MODES: readonly KeepAwakeMode[] = ['off', 'working', 'always'];

/* A stored mode, or the switch before it under `agentsKeepAwake`, whose on was while an agent works. */
function keepAwakeFrom(stored: unknown, legacy: unknown): KeepAwakeMode {
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
    /* How the toolbar moves between projects: the switcher, or a tab per project this window opened. */
    projectNavigation: 'switcher' | 'tabs';
    /* "Needs you" lists what waits in every open project, not only the one on screen. The combined sidebar always does. */
    needsYouAllProjects: boolean;
    /* One of the node accents. Blue is the brand's own and the one a fresh client starts on. */
    accent: AccentId;
    /* The tint of the grounds, surfaces and text on both sides; the default keeps the theme's own grays. */
    palette: PalettePreset;
    /* The glow at the top of the sidebar, and of the toolbar while the sidebar is closed, in the color of the project. */
    projectGlow: boolean;
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
    /* Where the palette starts browsing for a folder; empty is the machine's home. One for every machine,
       since work folders have the same name everywhere; a path a machine lacks falls back to its home. */
    browseStartFolder: string;
    /* The Shiki theme id code is drawn in while the app is light, in the viewer, the editor and a chat. */
    codeThemeLight: string;
    /* The same while the app is dark. */
    codeThemeDark: string;
    codeWrap: boolean;
    codeIndentGuides: boolean;
    codeWhitespace: boolean;
    /* Whether the editor pins the lines that open the scopes around the top line while scrolling. */
    codeStickyScroll: boolean;
    /* Whether documentation comments are drawn as formatted text in place of their lines. */
    codeRenderDocs: boolean;
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
    /* The size, in px, every editor of this client draws its code at after a person zoomed; null follows `codeFontSize`. */
    codeZoom: number | null;
    /* Which lines lose their trailing spaces and tabs right before a save. */
    codeTrailingWhitespace: TrailingWhitespaceMode;
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
    /* A design chat hides them whatever this says. */
    chatHideToolCalls: boolean;
    /* Speech to Text's own; Voice speaks these two only on a machine that keeps no preferences of its own (`voice.preferences`). */
    voiceLanguage: VoiceLanguage;
    liveVoice: LiveVoice;
    voiceInputDeviceId: string;
    /* Whether Voice pauses before deleting project data. */
    voiceConfirmDestructiveActions: boolean;
    /* Whether the desktop shell downloads an update as soon as it finds one, or waits to be asked. */
    updatesAutoDownload: boolean;
    /* Whether a view an agent asks for takes the place of the one you work in. Off, the request waits
       in the banner: moving someone's eyes is the one thing an agent asks rather than does. */
    agentsShowViews: boolean;
    /* Whether the maps in chats load their tiles through Ruimte's map service. On to start with; off, a map is the outline of the world and the list of its places. */
    chatMapTiles: boolean;
    /* About the computer this window runs on, so it sits with the client. Off to start with: a laptop
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
    /* Whether a canvas shows a map of its nodes in the bottom right corner. Off, since it covers a corner of every canvas. */
    canvasMinimap: boolean;
    /* The STUN servers a direct connection asks for this client's public address, separated by spaces.
       Empty offers the addresses of this machine's own interfaces only, which is enough on one network. */
    directStunServers: string;
    /* Which language the interface is written in. `system` is whatever the operating system asks
       for, and one of `APP_LANGUAGES` overrules it. */
    language: string;
    /* Which region writes the numbers, dates and times: `language`, `system` or a tag from
       `FORMAT_REGIONS`. Apart from `language`, since a person can read one language in another
       country's notation. */
    formatRegion: string;
    /* Whether this client has met the onboarding: put off, closed or finished. */
    onboardingSeen: boolean;
    /* Whether "How Ruimte works" was read here, the one task no machine can tell. */
    onboardingIntroSeen: boolean;
    /* Set by the first-run choice just before the app restarts, so the list opens without the welcome the person just had. Cleared when the onboarding closes. */
    onboardingSkipWelcome: boolean;
    /* Whether a file ends in a line break after a save. On, since a file without one shows up in every diff and in tools that read lines. */
    codeEnsureFinalNewline: boolean;
    /* The face of the terminals; `editor` follows `font`, so a client that stored nothing sees one face everywhere. */
    terminalFont: TerminalFontId;
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
    projectNavigation: 'switcher',
    needsYouAllProjects: true,
    accent: 'blue',
    palette: 'default',
    projectGlow: true,
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
    codeStickyScroll: true,
    codeRenderDocs: false,
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
    codeZoom: null,
    codeTrailingWhitespace: 'off',
    diffLayout: 'stacked',
    diffWhitespace: true,
    worktreeMergeStrategy: 'squash',
    drawingSnap: false,
    dockAutoHide: false,
    chatStreaming: 'words',
    chatSteerByDefault: false,
    chatHideToolCalls: false,
    voiceLanguage: 'nl',
    liveVoice: 'marin',
    voiceInputDeviceId: 'default',
    voiceConfirmDestructiveActions: true,
    updatesAutoDownload: true,
    agentsShowViews: false,
    chatMapTiles: true,
    keepAwake: 'off',
    keepAwakeOnBattery: false,
    keepAwakeDisplay: false,
    agentsTurnSound: false,
    browserSwipe: true,
    canvasMinimap: false,
    directStunServers: DEFAULT_STUN_SERVER,
    language: LANGUAGE_SYSTEM,
    formatRegion: FORMAT_LANGUAGE,
    onboardingSeen: false,
    onboardingIntroSeen: false,
    onboardingSkipWelcome: false,
    codeEnsureFinalNewline: true,
    terminalFont: 'editor'
};

// Rounded as well as clamped: storage can still hold a half pixel, and text renders sharpest on a whole one.
function clampSize(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(range.max, Math.max(range.min, size));
}

// One decimal, the step of the stepper, so a float that drifted in storage reads back as what was shown.
function clampRatio(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const ratio = typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : fallback;
    return Math.min(range.max, Math.max(range.min, ratio));
}

/* The layout and the sizes, which an update checks as well as a read. */
function measuresFrom(
    values: Partial<Settings>
): Pick<Settings, 'panelLayout' | 'fontSize' | 'interfaceFontSize' | 'codeFontSize' | 'codeLineHeight' | 'terminalLineHeight' | 'filesTabLimit'> {
    return {
        panelLayout: values.panelLayout === 'roomy' ? 'roomy' : 'standard',
        fontSize: clampSize(values.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize),
        interfaceFontSize: clampSize(values.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize),
        codeFontSize: clampSize(values.codeFontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.codeFontSize),
        codeLineHeight: clampRatio(values.codeLineHeight, CODE_LINE_HEIGHT_RANGE, DEFAULT_SETTINGS.codeLineHeight),
        terminalLineHeight: clampRatio(values.terminalLineHeight, TERMINAL_LINE_HEIGHT_RANGE, DEFAULT_SETTINGS.terminalLineHeight),
        filesTabLimit: clampSize(values.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit)
    };
}

/* The settings alone, without the store's version and methods. */
function settingsOf(state: Settings): Settings {
    return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, state[key as keyof Settings]])) as unknown as Settings;
}

/* What a stored blob means, key by key. Everything a client wrote before a setting existed, or wrote
   as something else, reads as what a fresh client gets. */
export function settingsFrom(stored: Partial<Settings>): Settings {
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        ...measuresFrom(stored),
        sidebarScope: stored.sidebarScope === 'all-open' ? 'all-open' : 'current',
        projectNavigation: stored.projectNavigation === 'tabs' ? 'tabs' : 'switcher',
        needsYouAllProjects: stored.needsYouAllProjects !== false,
        terminalLinkDestination: stored.terminalLinkDestination === 'ruimte' ? 'ruimte' : 'external',
        // A path is typed by hand and read back as one; anything else in the blob is no folder.
        browseStartFolder: typeof stored.browseStartFolder === 'string' ? stored.browseStartFolder : DEFAULT_SETTINGS.browseStartFolder,
        codeThemeLight: codeThemeFrom(stored.codeThemeLight, 'light', DEFAULT_SETTINGS.codeThemeLight),
        codeThemeDark: codeThemeFrom(stored.codeThemeDark, 'dark', DEFAULT_SETTINGS.codeThemeDark),
        codeWrap: stored.codeWrap === true,
        codeIndentGuides: stored.codeIndentGuides !== false,
        codeWhitespace: stored.codeWhitespace === true,
        codeStickyScroll: stored.codeStickyScroll !== false,
        codeRenderDocs: stored.codeRenderDocs === true,
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
        smartKeys: switchesFrom(stored.smartKeys, DEFAULT_SMART_KEYS),
        // The editor keeps a size it is handed inside its own zoom range.
        codeZoom: typeof stored.codeZoom === 'number' && Number.isFinite(stored.codeZoom) ? Math.round(stored.codeZoom) : null,
        codeTrailingWhitespace: TRAILING_WHITESPACE_MODES.find((mode) => mode === stored.codeTrailingWhitespace) ?? DEFAULT_SETTINGS.codeTrailingWhitespace,
        // A client that stored null for the theme's own accent, or an id that has since gone, lands on the brand's.
        accent: NODE_ACCENTS.find((entry) => entry.id === stored.accent)?.id ?? DEFAULT_SETTINGS.accent,
        palette: palettePresetFrom(stored.palette),
        projectGlow: stored.projectGlow !== false,
        // Nothing moves a person's eyes unless that person said so, so only a stored `true` turns it on.
        agentsShowViews: stored.agentsShowViews === true,
        // On unless a person turned it off, so a client that stored nothing yet draws maps.
        chatMapTiles: stored.chatMapTiles !== false,
        keepAwake: keepAwakeFrom(stored.keepAwake, (stored as Partial<Settings> & { agentsKeepAwake?: unknown }).agentsKeepAwake),
        keepAwakeOnBattery: stored.keepAwakeOnBattery === true,
        keepAwakeDisplay: stored.keepAwakeDisplay === true,
        chatStreaming: chatStreamingFrom(stored.chatStreaming),
        chatSteerByDefault: stored.chatSteerByDefault === true,
        chatHideToolCalls: stored.chatHideToolCalls === true,
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
        canvasMinimap: stored.canvasMinimap === true,
        worktreeMergeStrategy:
            WORKTREE_MERGE_STRATEGIES.find((strategy) => strategy === stored.worktreeMergeStrategy) ?? DEFAULT_SETTINGS.worktreeMergeStrategy,
        directStunServers: typeof stored.directStunServers === 'string' ? stored.directStunServers : DEFAULT_SETTINGS.directStunServers,
        language: languageFrom(stored.language),
        formatRegion: formatRegionFrom(stored.formatRegion),
        onboardingSeen: stored.onboardingSeen === true,
        onboardingIntroSeen: stored.onboardingIntroSeen === true,
        onboardingSkipWelcome: stored.onboardingSkipWelcome === true,
        codeEnsureFinalNewline: stored.codeEnsureFinalNewline !== false,
        terminalFont:
            stored.terminalFont === 'editor' ? 'editor' : (MONO_FONTS.find((entry) => entry.id === stored.terminalFont)?.id ?? DEFAULT_SETTINGS.terminalFont)
    };
}

/* Every field is checked on its own by `settingsFrom`, so a blob of an older version keeps what still fits. */
const storedSettings = storedJson<Partial<Settings>, Settings>(
    SETTINGS_STORAGE_KEY,
    z.custom<Partial<Settings>>((stored) => typeof stored === 'object' && stored !== null)
);

function read(): Settings {
    try {
        return settingsFrom(storedSettings.read() ?? {});
    } catch {
        return DEFAULT_SETTINGS;
    }
}

function applyColors(palette: PalettePreset, accentId: AccentId, preview = false): void {
    const accent = accentColor(accentId);
    applyPalette(
        {
            light: { ...presetTokens(palette, 'light'), accent },
            dark: { ...presetTokens(palette, 'dark'), accent }
        },
        { preview }
    );
}

/* Shows the app in a palette or an accent a person is looking at before picking it, or with none back in
   the ones they picked. Nothing is stored, so another window and a reload still have the picked ones. */
export function previewColors(preview: { palette?: PalettePreset; accent?: AccentId } | null): void {
    if (typeof document === 'undefined') {
        return;
    }
    const settings = useSettings.getState();
    applyColors(preview?.palette ?? settings.palette, preview?.accent ?? settings.accent, preview !== null);
}

/* The few tokens a person may change are set over the theme's own values: the type on the root, the
   colors in the palette's stylesheet, which knows the two sides apart. */
/* Counts the stacks that went on the root once their face arrived, for an editor that measures its face itself. */
export const useLoadedFaces = create<{ count: number }>(() => ({ count: 0 }));

const pendingStacks = new Map<string, string | null>();

/* A terminal and the editor measure a face once, from a canvas, so a bundled face goes on the root only once
   it has arrived; before that they would measure the fallback and keep its widths. */
function setFontStack(property: string, stack: string | null): void {
    const root = document.documentElement.style;
    pendingStacks.set(property, stack);

    if (stack === null) {
        root.removeProperty(property);
        return;
    }

    const probe = `16px ${stack.split(',')[0]}`;

    if (!document.fonts || document.fonts.check(probe)) {
        root.setProperty(property, stack);
        return;
    }

    void document.fonts
        .load(probe)
        .catch(() => [])
        .then(() => {
            // A person who picked another face in the meantime keeps that one.
            if (pendingStacks.get(property) !== stack) {
                return;
            }
            root.setProperty(property, stack);
            useLoadedFaces.setState((state) => ({ count: state.count + 1 }));
        });
}

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
    applyColors(settings.palette, settings.accent);
    const interfaceFont = INTERFACE_FONTS.find((entry) => entry.id === settings.interfaceFont);
    setFontStack('--font-sans', interfaceFont && interfaceFont.id !== 'system' ? interfaceFont.stack : null);
    const font = MONO_FONTS.find((entry) => entry.id === settings.font);
    setFontStack('--font-mono', font && font.id !== 'system' ? font.stack : null);
    // Unset, the terminal library falls back to `--font-mono`, so only "Same as Editor" leaves it unset; System writes its stack, or the terminal would take the editor's face.
    const terminalFont = settings.terminalFont === 'editor' ? undefined : MONO_FONTS.find((entry) => entry.id === settings.terminalFont);
    setFontStack('--term-font', terminalFont ? terminalFont.stack : null);
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
            const next: Settings = { ...settingsOf(get()), ...patch };
            Object.assign(next, measuresFrom(next));
            // Storage that refuses still leaves the setting on for this session.
            storedSettings.write(next);
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
