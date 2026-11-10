import type { ProjectPanels } from '@ruimte/contracts';
import { z } from 'zod';
import { create } from 'zustand';
import { panelTraits } from '@/state/panel-traits';
import { isScratchProject, useProject } from '@/state/project';
import { storedJson, storedText } from '@/state/stored-json';

export type SettingsSectionId = string;

/* The kind of a panel, as registered by the feature that draws it (`registry/panels.ts`), or an extension's `extension:<id>`. */
export type PanelKind = string;

const PANEL_KINDS: readonly PanelKind[] = ['files', 'git', 'processes', 'devices'];

const storedSidebar = storedText('ruimte.sidebar');
const storedSidebarWidth = storedText('ruimte.sidebar.width');
const storedChosenLaunches = storedJson(
    'ruimte.launches.chosen',
    z.custom<Record<string, string>>((stored) => stored !== null && typeof stored === 'object' && !Array.isArray(stored))
);

/* Where the panels lived before they were per project: read as a new project's defaults, never written. */
const LEGACY_PANEL_KEY = 'ruimte.panel';
const LEGACY_PANEL_WIDTH_KEY = 'ruimte.panel.width';

export interface PanelState {
    open: boolean;
    /* Which panel the surface shows; it survives a close, so the toggle reopens the last one. */
    kind: PanelKind;
}

/* The chat and the plan the plan panel shows, and whether a person closed it. */
export type PlanAnchor = NonNullable<ProjectPanels['plan']>;

const CLOSED_PANEL: PanelState = { open: false, kind: 'files' };

/* What the Chats project has no panel for: its folder is the daemon's, and so are its repository and what runs in it. */
export function panelHidden(kind: PanelKind, scratch: boolean): boolean {
    return scratch && panelTraits(kind).hiddenInScratch === true;
}

/* The panel as the window shows it: one the project has no place for reads as closed, whatever its file stored. */
export function shownPanel(panel: PanelState, scratch: boolean): PanelState {
    return panel.open && panelHidden(panel.kind, scratch) ? { ...panel, open: false } : panel;
}

/* The kind on its own for an open panel, `closed:` in front for one that is not, so a toggle still
   knows which panel it reopens. The shape the legacy key was written in. */
export function parsePanel(raw: string | null): PanelState {
    if (!raw) {
        return CLOSED_PANEL;
    }
    const open = !raw.startsWith('closed:');
    const kind = (open ? raw : raw.slice('closed:'.length)) as PanelKind;
    return PANEL_KINDS.includes(kind) ? { open, kind } : CLOSED_PANEL;
}

/* A width the legacy key holds, in whole pixels; null is "no width of the person's own". */
export function parseWidth(raw: string | null): number | null {
    const stored = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
}

export interface PanelDefaults {
    panel: PanelState;
    panelWidth: number | null;
    planAnchor: PlanAnchor | null;
    planWidth: number | null;
}

/* What a project whose local file says nothing about the panels opens with. */
export const PANEL_DEFAULTS: PanelDefaults = {
    panel: parsePanel(storedText(LEGACY_PANEL_KEY).read()),
    panelWidth: parseWidth(storedText(LEGACY_PANEL_WIDTH_KEY).read()),
    planAnchor: null,
    planWidth: null
};

interface SettingsState {
    open: boolean;
    /* The section the dialog shows; it stays where it was so reopening lands on the same pane. */
    section: SettingsSectionId;
    /* The row a search result points at, which scrolls itself into view and lights up once. */
    target: string | null;
    /* Bumped to put the keyboard in the search field; the field focuses on every change. */
    searchAt: number;
}

/* What the palette is doing: jumping and running commands, searching the files of the open folder,
   searching the project's chats, or picking one file. A step inside the same dialog. */
type PaletteMode = 'default' | 'grep' | 'chats' | 'file';

/* What a picked file becomes. A node carries where it lands, in world units, because the menu that
   asked knows the point that was right-clicked and the palette does not. */
type FilePick = { kind: 'node'; at: { x: number; y: number } } | { kind: 'view' } | { kind: 'tab' };

interface UiStore {
    paletteOpen: boolean;
    paletteMode: PaletteMode;
    /* Whether the session list is in view; it survives a reload, like everything else on the canvas. */
    sidebarOpen: boolean;
    /* The width a person dragged the session list to, null for the default; like `sidebarOpen` it belongs to the app, not a project. */
    sidebarWidth: number | null;
    /* Which canvases the sidebar has folded open, per project, or null until the list seeds itself.
       It rides the project's machine-local file with the panels (`project/panels-port.ts`). */
    sidebarExpanded: string[] | null;
    /* Text the palette opens with; a path puts it straight into folder browsing. */
    paletteSeed: string;
    /* A count and not a flag: asking twice while the palette is open has to start browsing twice. */
    paletteBrowseAt: number;
    /* The machine the folder browser was asked to open on, or null to open on the machines as usual. */
    paletteBrowseMachine: string | null;
    /* What picking a machine is for: its folders, or a new chat on it, which needs no folder at all. */
    paletteBrowseFor: 'folder' | 'chat';
    /* What the file mode does with the file that is chosen; null in every other mode. */
    filePick: FilePick | null;
    settings: SettingsState;
    panel: PanelState;
    /* Null until a drag gives the column a width of the person's own for this project. */
    panelWidth: number | null;
    /* One per window, since a window shows one project. Open follows from the rules in
       `plan/panel-rules.ts` and never from the project's file. */
    planAnchor: PlanAnchor | null;
    planOpen: boolean;
    planWidth: number | null;
    /* True while the columns show what was stored, false from the first change by hand. A column
       only slides when it is false, so a restore lands at its width. */
    panelsRestoring: boolean;
    /* The launch the toolbar's chip shows, by `endpointKey(endpointId, projectId)`. This client's
       choice, so it stays in this client's storage and never in a project file. */
    chosenLaunches: Record<string, string>;
    chooseLaunch(projectKey: string, launchId: string): void;
    setSidebarOpen(open: boolean): void;
    toggleSidebar(): void;
    openPalette(seed?: string): void;
    openFindInFiles(seed?: string): void;
    /* The palette in its chat search mode; with nothing typed it lists the CLI sessions started outside the app. */
    openChatSearch(seed?: string): void;
    /* With one machine it opens on that machine's start folder, with more on the machines. */
    openFolderBrowser(machineId?: string): void;
    /* The machines, for a new chat on the one that is picked. */
    openChatMachines(): void;
    /* The palette listing the files of the open folder, to make one of them a node or a view. */
    openFilePicker(pick: FilePick): void;
    setPaletteMode(mode: PaletteMode): void;
    setPaletteOpen(open: boolean): void;
    setSettings(patch: Partial<SettingsState>): void;
    setPanel(patch: Partial<PanelState>): void;
    togglePanel(kind?: PanelKind): void;
    setPanelWidth(width: number): void;
    setSidebarWidth(width: number): void;
    setPlanPanel(state: { anchor: PlanAnchor | null; open: boolean }): void;
    setPlanWidth(width: number): void;
    /* Puts a project's panels on screen in one go, when it opens; they land without sliding. */
    setPanels(state: PanelDefaults): void;
    setSidebarExpanded(ids: string[] | null): void;
}

/* Which app-level dialog is up; nothing here belongs to a node. The panels do belong to a project.
   They are loaded from and saved to its machine-local file by `project/panels-port.ts`. */
export const useUi = create<UiStore>((set, get) => {
    const openPaletteIn = (paletteMode: PaletteMode, seed: string): void => {
        set({ paletteOpen: true, paletteMode, paletteSeed: seed, filePick: null });
    };

    const browseMachines = (paletteBrowseFor: UiStore['paletteBrowseFor'], machineId: string | null): void => {
        set({
            paletteOpen: true,
            paletteMode: 'default',
            paletteSeed: '',
            paletteBrowseAt: get().paletteBrowseAt + 1,
            paletteBrowseMachine: machineId,
            paletteBrowseFor,
            filePick: null
        });
    };

    return {
        paletteOpen: false,
        paletteMode: 'default',
        paletteSeed: '',
        paletteBrowseAt: 0,
        paletteBrowseMachine: null,
        paletteBrowseFor: 'folder',
        filePick: null,
        sidebarOpen: storedSidebar.read() !== 'closed',
        sidebarWidth: parseWidth(storedSidebarWidth.read()),
        sidebarExpanded: null,
        settings: { open: false, section: 'general', target: null, searchAt: 0 },
        /* Closed until a project says otherwise, so a reload cannot flash open a panel the project has closed. */
        panel: CLOSED_PANEL,
        panelWidth: null,
        planAnchor: null,
        planOpen: false,
        planWidth: null,
        panelsRestoring: true,
        chosenLaunches: storedChosenLaunches.read() ?? {},
        chooseLaunch(projectKey, launchId) {
            if (get().chosenLaunches[projectKey] === launchId) {
                return;
            }
            const chosenLaunches = { ...get().chosenLaunches, [projectKey]: launchId };
            storedChosenLaunches.write(chosenLaunches);
            set({ chosenLaunches });
        },
        setSidebarOpen(open) {
            storedSidebar.write(open ? 'open' : 'closed');
            set({ sidebarOpen: open, panelsRestoring: false });
        },
        toggleSidebar() {
            get().setSidebarOpen(!get().sidebarOpen);
        },
        openPalette(seed = '') {
            openPaletteIn('default', seed);
        },
        openFindInFiles(seed = '') {
            openPaletteIn('grep', seed);
        },
        openChatSearch(seed = '') {
            openPaletteIn('chats', seed);
        },
        openFolderBrowser(machineId) {
            browseMachines('folder', machineId ?? null);
        },
        openChatMachines() {
            browseMachines('chat', null);
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
            set({ panel, panelsRestoring: false });
        },
        togglePanel(kind) {
            const was = get().panel;
            /* Without a kind the shortcut reopens whatever was up last, so the panel has one toggle of its own. */
            const panel = kind ? { open: !(was.open && was.kind === kind), kind } : { ...was, open: !was.open };
            set({ panel, panelsRestoring: false });
        },
        setPanelWidth(width) {
            set({ panelWidth: width, panelsRestoring: false });
        },
        setSidebarWidth(width) {
            storedSidebarWidth.write(String(width));
            set({ sidebarWidth: width, panelsRestoring: false });
        },
        setPlanPanel({ anchor, open }) {
            if (get().planAnchor === anchor && get().planOpen === open) {
                return;
            }
            set({ planAnchor: anchor, planOpen: open, panelsRestoring: false });
        },
        setPlanWidth(width) {
            set({ planWidth: width, panelsRestoring: false });
        },
        setSidebarExpanded(ids) {
            set({ sidebarExpanded: ids });
        },
        setPanels(state) {
            /* One update, so a panel and its width reach the DOM together instead of sliding from the default. */
            set({
                panel: state.panel,
                panelWidth: state.panelWidth,
                planAnchor: state.planAnchor,
                // Closed until the chat is on screen. The rules open it, never the file.
                planOpen: false,
                planWidth: state.planWidth,
                panelsRestoring: true
            });
        }
    };
});

export function useShownPanel(): PanelState {
    const panel = useUi((s) => s.panel);
    const scratch = useProject((s) => isScratchProject(s.current));
    return shownPanel(panel, scratch);
}
