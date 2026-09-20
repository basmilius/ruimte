import type { ProjectPanels } from '@ruimte/contracts';
import { faviconsOfProject, useBrowser } from '@/browser/registry';
import { useFiles } from '@/state/files';
import { currentEndpointId } from '@/state/keys';
import { DEFAULT_LOG_HEIGHT, DEFAULT_SCOPE, useGit } from '@/state/git';
import { parsePanels, serializePanels, type PanelsState } from '@/state/panel-state';
import { PANEL_DEFAULTS, useUi } from '@/state/ui';

const defaults = (): PanelsState => ({
    ...PANEL_DEFAULTS,
    tabs: [],
    active: null,
    expandedDirs: [],
    gitScope: DEFAULT_SCOPE,
    gitCollapsedDirs: [],
    gitLogHeight: DEFAULT_LOG_HEIGHT,
    sidebarExpanded: null,
    favicons: {}
});

const read = (): PanelsState => {
    const ui = useUi.getState();
    const files = useFiles.getState();
    return {
        panel: ui.panel,
        preview: ui.preview,
        panelWidth: ui.panelWidth,
        previewWidth: ui.previewWidth,
        planAnchor: ui.planAnchor,
        planWidth: ui.planWidth,
        flowWidth: ui.flowWidth,
        tabs: files.tabs,
        active: files.active,
        expandedDirs: files.expandedDirs,
        gitScope: useGit.getState().scope,
        gitCollapsedDirs: useGit.getState().collapsedDirs,
        gitLogHeight: useGit.getState().logHeight,
        sidebarExpanded: ui.sidebarExpanded,
        favicons: faviconsOfProject(useBrowser.getState().byKey, currentEndpointId())
    };
};

/*
 * The panels on one side, the project's machine-local file on the other. It puts a project's panels
 * on screen the moment it opens and reports every change made after that, so the client can write
 * it. What it applies itself is never reported: opening a project would otherwise save it back.
 */
export class PanelsPort {
    private readonly listeners = new Set<() => void>();
    private readonly unsubscribe: Array<() => void>;
    private applying = false;
    /* The panels as the listeners last saw them; the stores also carry state that is none of their
       business, so a change is what the local file would hold differing, not any set at all. */
    private snapshot: string;

    constructor() {
        const publish = (): void => this.publish();
        this.unsubscribe = [useUi.subscribe(publish), useFiles.subscribe(publish), useGit.subscribe(publish), useBrowser.subscribe(publish)];
        this.snapshot = this.stringify();
    }

    load(projectId: string | null, stored: ProjectPanels | undefined): void {
        const state = parsePanels(stored, defaults());
        this.applying = true;
        try {
            useUi.getState().setPanels(state);
            useFiles.getState().load(projectId, { tabs: state.tabs, active: state.active, expandedDirs: state.expandedDirs });
            useGit.getState().setScope(state.gitScope);
            useGit.getState().setCollapsedDirs(state.gitCollapsedDirs);
            useGit.getState().setLogHeight(state.gitLogHeight);
            useUi.getState().setSidebarExpanded(state.sidebarExpanded);
            useBrowser.getState().loadFavicons(currentEndpointId(), state.favicons);
        } finally {
            this.applying = false;
            this.snapshot = this.stringify();
        }
    }

    export(): ProjectPanels {
        return serializePanels(read());
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        this.listeners.clear();
    }

    private publish(): void {
        if (this.applying) {
            return;
        }
        const next = this.stringify();
        if (next === this.snapshot) {
            return;
        }
        this.snapshot = next;
        for (const listener of this.listeners) {
            listener();
        }
    }

    private stringify(): string {
        return JSON.stringify(this.export());
    }
}

/* The panels are the viewer's, not a daemon's, so every connection writes the same port. */
export const panelsPort = new PanelsPort();
