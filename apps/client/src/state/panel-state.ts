import type { GitDiffScope, ProjectPanels } from '@ruimte/contracts';
import { tabKey, type FileTab } from '@/state/files';
import { DEFAULT_SCOPE } from '@/state/git';
import type { PanelDefaults } from '@/state/ui';

/* Everything the surfaces around the canvas remember for one project on this machine. */
export interface PanelsState extends PanelDefaults {
    tabs: FileTab[];
    active: string | null;
    expandedDirs: string[];
    gitScope: GitDiffScope;
    gitCollapsedDirs: string[];
}

/* A width from the file is a whole positive number of pixels or it is nothing at all. */
const width = (stored: number | undefined, fallback: number | null): number | null => {
    return stored !== undefined && Number.isFinite(stored) && stored > 0 ? Math.round(stored) : fallback;
};

/*
 * What the project's local file says, with the app's defaults filling in for whatever it leaves
 * out. A file written before the panels lived here says nothing, so it opens on the defaults.
 */
export const parsePanels = (stored: ProjectPanels | undefined, defaults: PanelsState): PanelsState => {
    const tabs: FileTab[] = (stored?.tabs ?? []).map((tab) => ({
        key: tabKey(tab.path, tab.view),
        path: tab.path,
        ...(tab.view ? { view: tab.view } : {}),
        pinned: tab.pinned,
        dirty: false
    }));
    /* A tab that is not among them would leave the viewer pointing at nothing. */
    const active = tabs.some((tab) => tab.key === stored?.activeTab) ? (stored?.activeTab ?? null) : (tabs[0]?.key ?? null);
    return {
        panel: stored?.panel ?? defaults.panel,
        /* With no file open there is nothing to preview, and the toolbar hides the toggle that
           would close it again, so an empty preview never comes back up. */
        preview: { open: (stored?.preview ?? defaults.preview).open && tabs.length > 0 },
        panelWidth: width(stored?.panelWidth, defaults.panelWidth),
        previewWidth: width(stored?.previewWidth, defaults.previewWidth),
        tabs,
        active,
        expandedDirs: stored?.expandedDirs ?? [],
        gitScope: stored?.git?.scope ?? DEFAULT_SCOPE,
        gitCollapsedDirs: stored?.git?.collapsedDirs ?? []
    };
};

/* The other way, for the machine-local file. A width nobody dragged stays out of it. */
export const serializePanels = (state: PanelsState): ProjectPanels => ({
    panel: state.panel,
    preview: state.preview,
    ...(state.panelWidth === null ? {} : { panelWidth: Math.round(state.panelWidth) }),
    ...(state.previewWidth === null ? {} : { previewWidth: Math.round(state.previewWidth) }),
    tabs: state.tabs.map((tab) => ({ path: tab.path, pinned: tab.pinned, ...(tab.view ? { view: tab.view } : {}) })),
    activeTab: state.active,
    expandedDirs: state.expandedDirs,
    git: { scope: state.gitScope, collapsedDirs: state.gitCollapsedDirs }
});
