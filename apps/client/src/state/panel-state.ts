import {
    ProjectStripTabSchema,
    type GitDiffScope,
    type ProjectFileTab,
    type ProjectPanelKind,
    type ProjectPanels,
    type ProjectStripTab
} from '@ruimte/contracts';
import { databaseTabId, databaseTabKey } from '@/database/tabs';
import type { LooseStrip } from '@/shell/legacy-files-cell';
import { isDatabaseTab, tabKey, type DatabaseTab, type FileTab, type Tab } from '@/state/files';
import { DEFAULT_LOG_HEIGHT, DEFAULT_SCOPE } from '@/state/git';
import type { PanelDefaults, PanelKind } from '@/state/ui';

/* Everything the surfaces around the canvas remember for one project on this machine. */
export interface PanelsState extends PanelDefaults {
    /* The loose views, in the order they were opened. Where they stand is the layout's. */
    tabs: Tab[];
    /* The one in front, for a client from before every cell could be a tab host. */
    active: string | null;
    expandedDirs: string[];
    gitScope: GitDiffScope;
    gitCollapsedDirs: string[];
    gitLogHeight: number;
    gitHiddenRepos: string[];
    /* The canvases the sidebar has open, or null while nobody has folded the list by hand. */
    sidebarExpanded: string[] | null;
    /* The last favicon of every browser node, by node id. */
    favicons: Record<string, string>;
}

/* A width from the file is a whole positive number of pixels or it is nothing at all. */
function width(stored: number | undefined, fallback: number | null): number | null {
    return stored !== undefined && Number.isFinite(stored) && stored > 0 ? Math.round(stored) : fallback;
}

/* The kind of the panel, from the flags a kind an older client does not know is stored in. */
function storedPanelKind(stored: ProjectPanels, kind: ProjectPanelKind): PanelKind {
    if (stored.databasesPanel === true) {
        return 'databases';
    }
    return stored.launchesPanel === true ? 'launches' : kind;
}

function fileTabOf(tab: ProjectFileTab): FileTab {
    return {
        key: tabKey(tab.path, tab.view),
        path: tab.path,
        ...(tab.view ? { view: tab.view } : {}),
        ...(tab.console ? { console: tab.console } : {}),
        pinned: tab.pinned
    };
}

function tabOf(stored: ProjectStripTab): Tab {
    if (stored.kind === 'file') {
        return fileTabOf(stored);
    }
    const { id, ...tab } = stored;
    return { ...tab, key: databaseTabKey(id) };
}

/* A tab of the databases cell of a release before the strip, in the shape it wrote; a console was a text of its own, which no file holds. */
function oldDatabaseTabOf(stored: unknown): Tab | null {
    const entry = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
    const parsed = ProjectStripTabSchema.safeParse({ ...entry, pinned: false });
    return parsed.success && parsed.data.kind !== 'file' ? tabOf(parsed.data) : null;
}

/*
 * The tabs in their order, each read on its own, so a kind this release does not know drops that tab and
 * not the list, and a second tab under one key drops too. A file from before the strip has its file tabs
 * and the tabs of the databases cell, which follow them.
 */
function tabsOf(stored: ProjectPanels | undefined): Tab[] {
    const read =
        stored?.strip !== undefined
            ? stored.strip.map((entry) => {
                  const parsed = ProjectStripTabSchema.safeParse(entry);
                  return parsed.success ? tabOf(parsed.data) : null;
              })
            : [...(stored?.tabs ?? []).map(fileTabOf), ...(stored?.databases?.tabs ?? []).map(oldDatabaseTabOf)];
    const tabs: Tab[] = [];
    for (const tab of read) {
        if (tab !== null && !tabs.some((other) => other.key === tab.key)) {
            tabs.push(tab);
        }
    }
    return tabs;
}

function storedFileTab(tab: FileTab): ProjectFileTab {
    return { path: tab.path, pinned: tab.pinned, ...(tab.view ? { view: tab.view } : {}), ...(tab.console ? { console: tab.console } : {}) };
}

function storedDatabaseTab(tab: DatabaseTab): ProjectStripTab {
    const base = { id: databaseTabId(tab.key), pinned: tab.pinned, connectionId: tab.connectionId, schema: tab.schema };
    switch (tab.kind) {
        case 'table':
            return {
                kind: 'table',
                ...base,
                table: tab.table,
                ...(tab.where === undefined ? {} : { where: tab.where }),
                ...(tab.tableKind === undefined ? {} : { tableKind: tab.tableKind })
            };
        case 'structure':
            return { kind: 'structure', ...base, table: tab.table, ...(tab.tableKind === undefined ? {} : { tableKind: tab.tableKind }) };
        case 'designer':
            return { kind: 'designer', ...base, ...(tab.table === undefined ? {} : { table: tab.table }) };
    }
}

function storedTab(tab: Tab): ProjectStripTab {
    return isDatabaseTab(tab) ? storedDatabaseTab(tab) : { kind: 'file', ...storedFileTab(tab) };
}

/* The tab in front, which has to be one of them, or the first. */
function activeOf(tabs: readonly Tab[], stored: ProjectPanels | undefined): string | null {
    return tabs.some((tab) => tab.key === stored?.activeTab) ? (stored?.activeTab ?? null) : (tabs[0]?.key ?? null);
}

/* The loose views a project had open and the one in front, which the layout may stand in its cells. */
export function stripOf(stored: ProjectPanels | undefined): LooseStrip {
    const tabs = tabsOf(stored);
    return { keys: tabs.map((tab) => tab.key), active: activeOf(tabs, stored) };
}

/*
 * What the project's local file says, with the app's defaults filling in for whatever it leaves
 * out. A file written before the panels lived here says nothing, so it opens on the defaults.
 */
export function parsePanels(stored: ProjectPanels | undefined, defaults: PanelsState): PanelsState {
    const tabs = tabsOf(stored);
    const active = activeOf(tabs, stored);
    return {
        panel: stored?.panel === undefined ? defaults.panel : { open: stored.panel.open, kind: storedPanelKind(stored, stored.panel.kind) },
        panelWidth: width(stored?.panelWidth, defaults.panelWidth),
        planAnchor: stored?.plan ?? defaults.planAnchor,
        planWidth: width(stored?.planWidth, defaults.planWidth),
        tabs,
        active,
        expandedDirs: stored?.expandedDirs ?? [],
        gitScope: stored?.git?.scope ?? DEFAULT_SCOPE,
        gitCollapsedDirs: stored?.git?.collapsedDirs ?? [],
        gitLogHeight: width(stored?.git?.logHeight, DEFAULT_LOG_HEIGHT) ?? DEFAULT_LOG_HEIGHT,
        gitHiddenRepos: stored?.git?.hiddenRepos ?? [],
        sidebarExpanded: stored?.sidebarExpanded ?? null,
        favicons: stored?.favicons ?? {}
    };
}

/* The other way, for the machine-local file. A width nobody dragged stays out of it. */
export function serializePanels(state: PanelsState): ProjectPanels {
    return {
        // A client from before launches or databases reads the files panel in its place.
        panel:
            state.panel.kind === 'launches' || state.panel.kind === 'databases'
                ? { open: state.panel.open, kind: 'files' }
                : state.panel.kind === 'problems'
                  ? { open: false, kind: 'files' }
                  : { open: state.panel.open, kind: state.panel.kind },
        ...(state.panel.kind === 'launches' ? { launchesPanel: true } : {}),
        ...(state.panel.kind === 'databases' ? { databasesPanel: true } : {}),
        ...(state.panelWidth === null ? {} : { panelWidth: Math.round(state.panelWidth) }),
        ...(state.planAnchor === null ? {} : { plan: state.planAnchor }),
        ...(state.planWidth === null ? {} : { planWidth: Math.round(state.planWidth) }),
        // A client from before the strip reads the file tabs alone.
        tabs: state.tabs.filter((tab): tab is FileTab => !isDatabaseTab(tab)).map(storedFileTab),
        activeTab: state.active,
        strip: state.tabs.map(storedTab),
        expandedDirs: state.expandedDirs,
        git: {
            scope: state.gitScope,
            collapsedDirs: state.gitCollapsedDirs,
            logHeight: Math.round(state.gitLogHeight),
            ...(state.gitHiddenRepos.length === 0 ? {} : { hiddenRepos: state.gitHiddenRepos })
        },
        /* A list nobody has folded stays out of the file, so the next open still seeds itself. */
        ...(state.sidebarExpanded === null ? {} : { sidebarExpanded: state.sidebarExpanded }),
        /* A project with no page open writes no map at all. */
        ...(Object.keys(state.favicons).length === 0 ? {} : { favicons: state.favicons })
    };
}
