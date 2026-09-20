import type { GitDiffScope, ProjectPanels } from '@ruimte/contracts';
import { tabKey, type FileTab } from '@/state/files';
import { DEFAULT_LOG_HEIGHT, DEFAULT_SCOPE } from '@/state/git';
import type { PanelDefaults } from '@/state/ui';

/* Everything the surfaces around the canvas remember for one project on this machine. */
export interface PanelsState extends PanelDefaults {
    tabs: FileTab[];
    active: string | null;
    expandedDirs: string[];
    gitScope: GitDiffScope;
    gitCollapsedDirs: string[];
    gitLogHeight: number;
    /* The canvases the sidebar has open, or null while nobody has folded the list by hand. */
    sidebarExpanded: string[] | null;
    /* The last favicon of every browser node, by node id. */
    favicons: Record<string, string>;
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
        /* The tabs decide, not what was stored: nothing else opens the preview, so a file that
           stayed open behind a closed preview would have no way back on screen. */
        preview: { open: tabs.length > 0 },
        panelWidth: width(stored?.panelWidth, defaults.panelWidth),
        previewWidth: width(stored?.previewWidth, defaults.previewWidth),
        planAnchor: stored?.plan ?? defaults.planAnchor,
        planWidth: width(stored?.planWidth, defaults.planWidth),
        flowWidth: width(stored?.flowWidth, defaults.flowWidth),
        tabs,
        active,
        expandedDirs: stored?.expandedDirs ?? [],
        gitScope: stored?.git?.scope ?? DEFAULT_SCOPE,
        gitCollapsedDirs: stored?.git?.collapsedDirs ?? [],
        gitLogHeight: width(stored?.git?.logHeight, DEFAULT_LOG_HEIGHT) ?? DEFAULT_LOG_HEIGHT,
        sidebarExpanded: stored?.sidebarExpanded ?? null,
        favicons: stored?.favicons ?? {}
    };
};

/* The other way, for the machine-local file. A width nobody dragged stays out of it. */
export const serializePanels = (state: PanelsState): ProjectPanels => ({
    panel: state.panel,
    preview: state.preview,
    ...(state.panelWidth === null ? {} : { panelWidth: Math.round(state.panelWidth) }),
    ...(state.previewWidth === null ? {} : { previewWidth: Math.round(state.previewWidth) }),
    ...(state.planAnchor === null ? {} : { plan: state.planAnchor }),
    ...(state.planWidth === null ? {} : { planWidth: Math.round(state.planWidth) }),
    ...(state.flowWidth === null ? {} : { flowWidth: Math.round(state.flowWidth) }),
    tabs: state.tabs.map((tab) => ({ path: tab.path, pinned: tab.pinned, ...(tab.view ? { view: tab.view } : {}) })),
    activeTab: state.active,
    expandedDirs: state.expandedDirs,
    git: { scope: state.gitScope, collapsedDirs: state.gitCollapsedDirs, logHeight: Math.round(state.gitLogHeight) },
    /* A list nobody has folded stays out of the file, so the next open still seeds itself. */
    ...(state.sidebarExpanded === null ? {} : { sidebarExpanded: state.sidebarExpanded }),
    /* A project with no page open writes no map at all. */
    ...(Object.keys(state.favicons).length === 0 ? {} : { favicons: state.favicons })
});
