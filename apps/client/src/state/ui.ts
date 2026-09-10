import type { ProjectPanelKind } from '@ruimte/contracts';
import { create } from 'zustand';

export type SettingsSectionId = 'appearance' | 'canvas' | 'files' | 'git' | 'agents' | 'machines' | 'keyboard' | 'about';

export type PanelKind = ProjectPanelKind;

const PANEL_KINDS: readonly PanelKind[] = ['files', 'git'];

const SIDEBAR_STORAGE_KEY = 'ruimte.sidebar';

/* The keys the panels lived in before they became a per-project thing. They are read once, as what
   a project that has never had panels of its own starts from, and never written again. */
const LEGACY_PANEL_KEY = 'ruimte.panel';
const LEGACY_PREVIEW_KEY = 'ruimte.preview';
const LEGACY_PANEL_WIDTH_KEY = 'ruimte.panel.width';
const LEGACY_PREVIEW_WIDTH_KEY = 'ruimte.preview.width';

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

export interface PanelState {
    open: boolean;
    /* Which panel the surface shows; it survives a close, so the toggle reopens the last one. */
    kind: PanelKind;
}

export interface PreviewState {
    open: boolean;
}

const CLOSED_PANEL: PanelState = { open: false, kind: 'files' };
const CLOSED_PREVIEW: PreviewState = { open: false };

/* The kind on its own for an open panel, `closed:` in front for one that is not, so a toggle still
   knows which panel it reopens. The shape the legacy key was written in. */
export const parsePanel = (raw: string | null): PanelState => {
    if (!raw) {
        return CLOSED_PANEL;
    }
    const open = !raw.startsWith('closed:');
    const kind = (open ? raw : raw.slice('closed:'.length)) as PanelKind;
    return PANEL_KINDS.includes(kind) ? { open, kind } : CLOSED_PANEL;
};

export const parsePreview = (raw: string | null): PreviewState => ({ open: raw === 'open' });

/* A width the legacy key holds, in whole pixels; null is "no width of the person's own". */
export const parseWidth = (raw: string | null): number | null => {
    const stored = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
};

const readLegacy = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

export interface PanelDefaults {
    panel: PanelState;
    preview: PreviewState;
    panelWidth: number | null;
    previewWidth: number | null;
}

/* What a project whose local file says nothing about the panels opens with. */
export const PANEL_DEFAULTS: PanelDefaults = {
    panel: parsePanel(readLegacy(LEGACY_PANEL_KEY)),
    preview: parsePreview(readLegacy(LEGACY_PREVIEW_KEY)),
    panelWidth: parseWidth(readLegacy(LEGACY_PANEL_WIDTH_KEY)),
    previewWidth: parseWidth(readLegacy(LEGACY_PREVIEW_WIDTH_KEY))
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
    preview: PreviewState;
    /* Null until a drag gives the column a width of the person's own for this project. */
    panelWidth: number | null;
    previewWidth: number | null;
    /* Whether the columns around the canvas show what was stored rather than what a person did.
       True from startup and again for every project that opens, false from the first change made
       here by hand. A column only slides when it is false, so a restore lands at its width. */
    panelsRestoring: boolean;
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
    setPreviewOpen(open: boolean): void;
    togglePreview(): void;
    setPanelWidth(width: number): void;
    setPreviewWidth(width: number): void;
    /* Puts a project's panels on screen in one go, when it opens; they land without sliding. */
    setPanels(state: PanelDefaults): void;
}

/* Which app-level dialog is up; nothing here belongs to a node. The panels do belong to a project:
   they are loaded from and saved to its machine-local file by `project/panels-port.ts`. */
export const useUi = create<UiStore>((set, get) => ({
    paletteOpen: false,
    paletteSeed: '',
    sidebarOpen: readSidebarOpen(),
    settings: { open: false, section: 'appearance' },
    /* Closed until a project says otherwise: the panels belong to a project and there is none
       yet, so the first paint of a reload cannot flash open a panel the project has closed. */
    panel: CLOSED_PANEL,
    preview: CLOSED_PREVIEW,
    panelWidth: null,
    previewWidth: null,
    panelsRestoring: true,
    layoutDialogOpen: false,
    worktreeDialogFor: null,
    setWorktreeDialogFor(groupId) {
        set({ worktreeDialogFor: groupId });
    },
    setSidebarOpen(open) {
        persistSidebarOpen(open);
        set({ sidebarOpen: open, panelsRestoring: false });
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
        set({ panel: { ...get().panel, ...patch }, panelsRestoring: false });
    },
    togglePanel(kind) {
        const panel = get().panel;
        /* Without a kind the chord reopens whatever was up last, so the panel has one toggle of its own. */
        set({ panel: kind ? { open: !(panel.open && panel.kind === kind), kind } : { ...panel, open: !panel.open }, panelsRestoring: false });
    },
    setPreviewOpen(open) {
        if (get().preview.open === open) {
            return;
        }
        set({ preview: { open }, panelsRestoring: false });
    },
    togglePreview() {
        get().setPreviewOpen(!get().preview.open);
    },
    setPanelWidth(width) {
        set({ panelWidth: width, panelsRestoring: false });
    },
    setPreviewWidth(width) {
        set({ previewWidth: width, panelsRestoring: false });
    },
    setPanels(state) {
        /* One update, so a panel and the width it opens at reach the DOM together: two would put a
           frame with the default width in between, and that frame is a slide. */
        set({
            panel: state.panel,
            preview: state.preview,
            panelWidth: state.panelWidth,
            previewWidth: state.previewWidth,
            panelsRestoring: true
        });
    }
}));
