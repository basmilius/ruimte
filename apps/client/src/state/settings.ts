import { create } from 'zustand';
import { accentColor, NODE_ACCENTS, type AccentId } from '@/canvas/accents';

const STORAGE_KEY = 'ruimte.settings';

export const MONO_FONTS = [
    { id: 'system', label: 'System', stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
    { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
    { id: 'fira', label: 'Fira Code', stack: '"Fira Code", ui-monospace, Menlo, monospace' },
    { id: 'menlo', label: 'Menlo', stack: 'Menlo, ui-monospace, monospace' }
] as const;

export type MonoFontId = (typeof MONO_FONTS)[number]['id'];

/*
 * What the sidebar lists. `project` is the project of the workspace you are working in; `window` is
 * every workspace this window has open, each under the name of its own project. One window holds one
 * workspace today, so the second stand differs by the heading alone until panes arrive.
 */
export type SidebarScope = 'project' | 'window';

export const SIDEBAR_SCOPES: readonly SidebarScope[] = ['project', 'window'];

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

export const FONT_SIZE_RANGE = { min: 10, max: 20, step: 1 } as const;
export const INTERFACE_FONT_SIZE_RANGE = { min: 14, max: 24, step: 1 } as const;
export const FILES_TAB_LIMIT_RANGE = { min: 1, max: 20, step: 1 } as const;

export interface Settings {
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
    /* Which projects the sidebar lists: the one you are working in, or every one this window holds. */
    sidebarScope: SidebarScope;
    /* Where the palette starts when it browses for a folder to open. Empty is the home of whichever
       machine is being browsed. One setting for every machine rather than one per machine, because
       the folders people keep their work in have the same name everywhere; a path that is not on the
       machine being browsed falls back to its home, which `fs.browse` answering `exists` can tell. */
    browseStartFolder: string;
    /* Whether the git panel groups its changed files by folder instead of listing them flat. */
    gitTree: boolean;
    /* Whether a diff draws the two sides next to each other or one patch under the other. */
    diffLayout: 'stacked' | 'split';
    /* Whether a diff counts and shows changes that are whitespace alone. */
    diffWhitespace: boolean;
    /* Whether a drawing snaps to the canvas grid while you draw. Cmd inverts it for one gesture. */
    drawingSnap: boolean;
    /* Whether the dock of a canvas or a drawing waits below the edge until the pointer comes near. */
    dockAutoHide: boolean;
    /* How a reply in a chat appears while it is written. Only how this client draws it: the daemon
       sends the deltas either way. */
    chatStreaming: ChatStreamingMode;
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
       of the operating system. On: the point of the whole thing is the moment somebody walked away,
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
}

// The STUN answer of Ruimte's own coturn, so a direct connection across two networks asks no third party.
export const DEFAULT_STUN_SERVER = 'stun:turn.ruimte.app:3478';

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
    accent: 'blue',
    font: 'system',
    fontSize: 13,
    interfaceFontSize: 15,
    filesTabLimit: 5,
    filesShowHidden: false,
    sidebarScope: 'project',
    browseStartFolder: '',
    gitTree: true,
    diffLayout: 'stacked',
    diffWhitespace: true,
    drawingSnap: false,
    dockAutoHide: false,
    chatStreaming: 'words',
    updatesAutoDownload: true,
    agentsShowViews: false,
    agentsApprovals: true,
    agentsKeepAwake: false,
    agentsTurnNotify: true,
    agentsTurnSound: false,
    browserSwipe: true,
    directStunServers: DEFAULT_STUN_SERVER
};

// Rounded as well as clamped: the stepper used to move in halves, so a browser can still hand back
// a half pixel from before, and both text and the terminal render sharpest on a whole one.
const clampSize = (value: unknown, range: { min: number; max: number }, fallback: number): number => {
    const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(range.max, Math.max(range.min, size));
};

/* What a stored blob means, key by key: everything a client wrote before a setting existed, or wrote
   as something else, reads as what a fresh client gets. */
export const settingsFrom = (stored: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...stored,
    fontSize: clampSize(stored.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize),
    interfaceFontSize: clampSize(stored.interfaceFontSize, INTERFACE_FONT_SIZE_RANGE, DEFAULT_SETTINGS.interfaceFontSize),
    filesTabLimit: clampSize(stored.filesTabLimit, FILES_TAB_LIMIT_RANGE, DEFAULT_SETTINGS.filesTabLimit),
    // A path is typed by hand and read back as one; anything else in the blob is no folder.
    browseStartFolder: typeof stored.browseStartFolder === 'string' ? stored.browseStartFolder : DEFAULT_SETTINGS.browseStartFolder,
    sidebarScope: SIDEBAR_SCOPES.find((scope) => scope === stored.sidebarScope) ?? DEFAULT_SETTINGS.sidebarScope,
    // A client that stored null for the theme's own accent, or an id that has since gone, lands on the brand's.
    accent: NODE_ACCENTS.find((entry) => entry.id === stored.accent)?.id ?? DEFAULT_SETTINGS.accent,
    // Nothing moves a person's eyes unless that person said so, so only a stored `true` turns it on.
    agentsShowViews: stored.agentsShowViews === true,
    // Same rule: nothing keeps a laptop from sleeping unless a stored `true` asked for it.
    agentsKeepAwake: stored.agentsKeepAwake === true,
    // The two that start on, so only a stored `false` turns either of them off.
    agentsApprovals: stored.agentsApprovals !== false,
    agentsTurnNotify: stored.agentsTurnNotify !== false,
    chatStreaming: chatStreamingFrom(stored.chatStreaming),
    // Same rule as the block: nothing makes a sound unless a stored `true` asked for it.
    agentsTurnSound: stored.agentsTurnSound === true,
    browserSwipe: stored.browserSwipe !== false,
    // The key before it, `directStunServer`, held the previous default for nearly every client, since the field was hidden
    // and every save writes the whole blob; a new key leaves that value behind instead of recognizing it.
    directStunServers: typeof stored.directStunServers === 'string' ? stored.directStunServers : DEFAULT_SETTINGS.directStunServers
});

const read = (): Settings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return settingsFrom(raw ? (JSON.parse(raw) as Partial<Settings>) : {});
    } catch {
        return DEFAULT_SETTINGS;
    }
};

/* The accent as channels: a token that needs it with an alpha writes `rgb(var(--accent-rgb) / a)`,
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
                accent,
                font,
                fontSize,
                interfaceFontSize,
                filesTabLimit,
                filesShowHidden,
                sidebarScope,
                browseStartFolder,
                gitTree,
                diffLayout,
                diffWhitespace,
                drawingSnap,
                dockAutoHide,
                chatStreaming,
                updatesAutoDownload,
                agentsShowViews,
                agentsApprovals,
                agentsKeepAwake,
                agentsTurnNotify,
                agentsTurnSound,
                browserSwipe,
                directStunServers
            } = get();
            const next: Settings = {
                accent,
                font,
                fontSize,
                interfaceFontSize,
                filesTabLimit,
                filesShowHidden,
                sidebarScope,
                browseStartFolder,
                gitTree,
                diffLayout,
                diffWhitespace,
                drawingSnap,
                dockAutoHide,
                chatStreaming,
                updatesAutoDownload,
                agentsShowViews,
                agentsApprovals,
                agentsKeepAwake,
                agentsTurnNotify,
                agentsTurnSound,
                browserSwipe,
                directStunServers,
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
