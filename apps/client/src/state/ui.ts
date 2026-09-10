import { create } from 'zustand';

export type SettingsSectionId = 'appearance' | 'canvas' | 'files' | 'agents' | 'machines' | 'keyboard' | 'about';

export type PanelKind = 'files' | 'git';

const PANEL_KINDS: readonly PanelKind[] = ['files', 'git'];

const SIDEBAR_STORAGE_KEY = 'ruimte.sidebar';
const PANEL_STORAGE_KEY = 'ruimte.panel';

const readSidebarOpen = (): boolean => {
    try {
        return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'closed';
    } catch {
        return true;
    }
};

const persistSidebarOpen = (open: boolean): void => {
    try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
        // Storage that refuses keeps the sidebar for this session only.
    }
};

interface PanelState {
    open: boolean;
    /* Which panel the surface shows; it survives a close, so the toggle reopens the last one. */
    kind: PanelKind;
}

const CLOSED_PANEL: PanelState = { open: false, kind: 'files' };

/* The kind on its own for an open panel, `closed:` in front for one that is not, so a reload lands
   on the panel that was up and the toggle still knows which one it reopens. */
export const parsePanel = (raw: string | null): PanelState => {
    if (!raw) {
        return CLOSED_PANEL;
    }
    const open = !raw.startsWith('closed:');
    const kind = (open ? raw : raw.slice('closed:'.length)) as PanelKind;
    return PANEL_KINDS.includes(kind) ? { open, kind } : CLOSED_PANEL;
};

export const serializePanel = (panel: PanelState): string => (panel.open ? panel.kind : `closed:${panel.kind}`);

const readPanel = (): PanelState => {
    try {
        return parsePanel(localStorage.getItem(PANEL_STORAGE_KEY));
    } catch {
        return CLOSED_PANEL;
    }
};

const persistPanel = (panel: PanelState): void => {
    try {
        localStorage.setItem(PANEL_STORAGE_KEY, serializePanel(panel));
    } catch {
        // Storage that refuses keeps the panel for this session only.
    }
};

interface SettingsState {
    open: boolean;
    /* The section the dialog shows; it stays where it was so reopening lands on the same pane. */
    section: SettingsSectionId;
}

interface UiStore {
    paletteOpen: boolean;
    /* Whether the session list is in view; it survives a reload, like everything else on the canvas. */
    sidebarOpen: boolean;
    /* Text the palette opens with; a path puts it straight into folder browsing. */
    paletteSeed: string;
    settings: SettingsState;
    panel: PanelState;
    layoutDialogOpen: boolean;
    /* The group a worktree is being bound to, while its dialog is up. */
    worktreeDialogFor: string | null;
    setWorktreeDialogFor(groupId: string | null): void;
    setSidebarOpen(open: boolean): void;
    toggleSidebar(): void;
    openPalette(seed?: string): void;
    setLayoutDialogOpen(open: boolean): void;
    setPaletteOpen(open: boolean): void;
    setSettings(patch: Partial<SettingsState>): void;
    setPanel(patch: Partial<PanelState>): void;
    togglePanel(kind?: PanelKind): void;
}

/* Which app-level dialog is up; nothing here belongs to a project or a node. */
export const useUi = create<UiStore>((set, get) => ({
    paletteOpen: false,
    paletteSeed: '',
    sidebarOpen: readSidebarOpen(),
    settings: { open: false, section: 'appearance' },
    panel: readPanel(),
    layoutDialogOpen: false,
    worktreeDialogFor: null,
    setWorktreeDialogFor(groupId) {
        set({ worktreeDialogFor: groupId });
    },
    setSidebarOpen(open) {
        persistSidebarOpen(open);
        set({ sidebarOpen: open });
    },
    toggleSidebar() {
        get().setSidebarOpen(!get().sidebarOpen);
    },
    setLayoutDialogOpen(open) {
        set({ layoutDialogOpen: open });
    },
    openPalette(seed = '') {
        set({ paletteOpen: true, paletteSeed: seed });
    },
    setPaletteOpen(open) {
        set(open ? { paletteOpen: true, paletteSeed: '' } : { paletteOpen: false });
    },
    setSettings(patch) {
        set({ settings: { ...get().settings, ...patch } });
    },
    setPanel(patch) {
        const next = { ...get().panel, ...patch };
        persistPanel(next);
        set({ panel: next });
    },
    togglePanel(kind) {
        const panel = get().panel;
        /* Without a kind the chord reopens whatever was up last, so the panel has one toggle of its own. */
        const next: PanelState = kind ? { open: !(panel.open && panel.kind === kind), kind } : { ...panel, open: !panel.open };
        persistPanel(next);
        set({ panel: next });
    }
}));
