import type { ProjectPanelKind } from '@ruimte/contracts';
import { create } from 'zustand';

export type SettingsSectionId = 'appearance' | 'keyboard' | 'views' | 'files' | 'agents' | 'usage' | 'machines' | 'about';

export type PanelKind = ProjectPanelKind;

/* A surface of the app rather than of a project: it fills the main column and no view is active
   while it is up. Not persisted, so a reload lands on the project's own view. */
export type AppPage = 'usage';

const PANEL_KINDS: readonly PanelKind[] = ['files', 'git', 'processes'];

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

export type ViewDialog =
    | { kind: 'rename' | 'delete' | 'icon'; viewId: string }
    /* Promoting a node that has lines drawn into it: those lines do not survive the move. */
    | { kind: 'promote'; nodeId: string }
    | { kind: 'new-browser' }
    | null;

/* What the palette is doing: jumping and running commands, searching through the files of the open
   folder, or picking one file out of it. The mode is a step inside the same dialog, not a dialog of
   its own. */
export type PaletteMode = 'default' | 'grep' | 'file';

/* What a picked file becomes. A node carries where it lands, in world units, because the menu that
   asked knows the point that was right-clicked and the palette does not. */
export type FilePick = { kind: 'node'; at: { x: number; y: number } } | { kind: 'view' };

interface UiStore {
    paletteOpen: boolean;
    paletteMode: PaletteMode;
    page: AppPage | null;
    /* Whether the session list is in view; it survives a reload, like everything else on the canvas. */
    sidebarOpen: boolean;
    /* Which canvases the sidebar has folded open, per project, or null until the list seeds itself.
       It rides the project's machine-local file with the panels (`project/panels-port.ts`). */
    sidebarExpanded: string[] | null;
    /* Text the palette opens with; a path puts it straight into folder browsing. */
    paletteSeed: string;
    /* How often the folder browser has been asked for. A count and not a flag: the command can be
       chosen while the palette is already open, which changes nothing else about this store, and
       choosing it twice in a row has to start browsing twice. Which step browsing is on after that
       is the palette's own business. */
    paletteBrowseAt: number;
    /* What the file mode does with the file that is chosen; null in every other mode. */
    filePick: FilePick | null;
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
    /* What a view is being asked about, from the sidebar, the breadcrumb or the palette alike. */
    viewDialog: ViewDialog;
    setPage(page: AppPage | null): void;
    /* The same page again closes it, which is what the button in the sidebar does. */
    togglePage(page: AppPage): void;
    setWorktreeDialogFor(groupId: string | null): void;
    setViewDialog(dialog: ViewDialog): void;
    setSidebarOpen(open: boolean): void;
    toggleSidebar(): void;
    openPalette(seed?: string): void;
    /* The palette in its find-in-files mode, from the palette itself or from the files panel. */
    openFindInFiles(seed?: string): void;
    /* The palette browsing folders, from its own command or from the project menu. Nothing is
       typed: with one machine it opens on that machine's start folder, with more on the machines. */
    openFolderBrowser(): void;
    /* The palette listing the files of the open folder, to make one of them a node or a view. */
    openFilePicker(pick: FilePick): void;
    setPaletteMode(mode: PaletteMode): void;
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
    setSidebarExpanded(ids: string[] | null): void;
}

/* Opening a panel is asking for the project back, so it takes the column from whatever page is up.
   Closing one leaves the page where it is: nothing was asked of the project. */
const leaves = (opening: boolean, page: AppPage | null): { page: AppPage | null } => ({ page: opening ? null : page });

/* Which app-level dialog is up; nothing here belongs to a node. The panels do belong to a project:
   they are loaded from and saved to its machine-local file by `project/panels-port.ts`. */
export const useUi = create<UiStore>((set, get) => ({
    paletteOpen: false,
    paletteMode: 'default',
    page: null,
    paletteSeed: '',
    paletteBrowseAt: 0,
    filePick: null,
    sidebarOpen: readSidebarOpen(),
    sidebarExpanded: null,
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
    viewDialog: null,
    setPage(page) {
        set({ page });
    },
    togglePage(page) {
        set({ page: get().page === page ? null : page });
    },
    setWorktreeDialogFor(groupId) {
        set({ worktreeDialogFor: groupId });
    },
    setViewDialog(dialog) {
        set({ viewDialog: dialog });
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
        set({ paletteOpen: true, paletteMode: 'default', paletteSeed: seed, filePick: null });
    },
    openFindInFiles(seed = '') {
        set({ paletteOpen: true, paletteMode: 'grep', paletteSeed: seed, filePick: null });
    },
    openFolderBrowser() {
        set({ paletteOpen: true, paletteMode: 'default', paletteSeed: '', paletteBrowseAt: get().paletteBrowseAt + 1, filePick: null });
    },
    openFilePicker(pick) {
        set({ paletteOpen: true, paletteMode: 'file', paletteSeed: '', filePick: pick });
    },
    setPaletteMode(mode) {
        set({ paletteMode: mode, paletteSeed: '', filePick: null });
    },
    setPaletteOpen(open) {
        set(open ? { paletteOpen: true, paletteMode: 'default', paletteSeed: '', filePick: null } : { paletteOpen: false, filePick: null });
    },
    setSettings(patch) {
        set({ settings: { ...get().settings, ...patch } });
    },
    setPanel(patch) {
        const panel = { ...get().panel, ...patch };
        set({ panel, ...leaves(panel.open, get().page), panelsRestoring: false });
    },
    togglePanel(kind) {
        const was = get().panel;
        /* Without a kind the shortcut reopens whatever was up last, so the panel has one toggle of its own. */
        const panel = kind ? { open: !(was.open && was.kind === kind), kind } : { ...was, open: !was.open };
        set({ panel, ...leaves(panel.open, get().page), panelsRestoring: false });
    },
    setPreviewOpen(open) {
        if (get().preview.open === open) {
            return;
        }
        set({ preview: { open }, ...leaves(open, get().page), panelsRestoring: false });
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
    setSidebarExpanded(ids) {
        set({ sidebarExpanded: ids });
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
