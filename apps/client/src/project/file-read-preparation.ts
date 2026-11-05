import { isFileView, resolveStoredPath, type ProjectView, type SplitLayout } from '@ruimte/contracts';
import { shownViewIdsIn } from '@/layout/split';
import type { Tab } from '@/state/files';
import { endpointKey } from '@/state/keys';
import { dirnameOf } from '../paths/file-path';

const NO_TABS: readonly Tab[] = [];

interface Source<State> {
    getState(): State;
    subscribe(listener: () => void): () => void;
}

interface ProjectState {
    current: { folder: string } | null;
    currentEndpointId: string | null;
    switching: boolean;
}

interface DocumentState {
    views: ProjectView[];
    layout: SplitLayout | null;
    maximized: string | null;
}

/* A restored file can prepare its watch while workspace code loads, without reading before that watch is ready. */
export function startFileReadPreparation(
    project: Source<ProjectState>,
    document: Source<DocumentState>,
    watches: { prepare(endpointId: string, path: string): () => void },
    files?: Source<{ tabs: readonly Tab[] }>
): () => void {
    const prepared = new Map<string, () => void>();
    let previous: (DocumentState & { folder: string | null; endpointId: string | null; switching: boolean; tabs: readonly Tab[] }) | null = null;
    const refresh = (): void => {
        const { current, currentEndpointId: endpointId, switching } = project.getState();
        const { views, layout, maximized } = document.getState();
        const tabs = files?.getState().tabs ?? NO_TABS;
        const folder = current?.folder ?? null;
        if (
            previous &&
            previous.views === views &&
            previous.layout === layout &&
            previous.maximized === maximized &&
            previous.tabs === tabs &&
            previous.folder === folder &&
            previous.endpointId === endpointId &&
            previous.switching === switching
        ) {
            return;
        }
        previous = { views, layout, maximized, folder, endpointId, switching, tabs };
        const wanted = new Map<string, { endpointId: string; path: string }>();
        if (!switching && folder !== null && endpointId !== null) {
            const shown = new Set(maximized === null ? (layout === null ? [] : shownViewIdsIn(layout)) : [maximized]);
            const add = (path: string): void => {
                const parent = dirnameOf(path);
                wanted.set(endpointKey(endpointId, parent), { endpointId, path: parent });
            };
            for (const view of views) {
                if (!isFileView(view) || !shown.has(view.id)) {
                    continue;
                }
                const path = resolveStoredPath(folder, view.path);
                if (path !== null) {
                    add(path);
                }
            }
            for (const tab of tabs) {
                if (!('kind' in tab) && tab.view === undefined && shown.has(tab.key)) {
                    add(tab.path);
                }
            }
        }
        for (const [key, release] of prepared) {
            if (!wanted.has(key)) {
                release();
                prepared.delete(key);
            }
        }
        for (const [key, value] of wanted) {
            if (!prepared.has(key)) {
                prepared.set(key, watches.prepare(value.endpointId, value.path));
            }
        }
    };
    const offProject = project.subscribe(refresh);
    const offDocument = document.subscribe(refresh);
    const offFiles = files?.subscribe(refresh);
    refresh();
    return () => {
        offProject();
        offDocument();
        offFiles?.();
        for (const release of prepared.values()) {
            release();
        }
        prepared.clear();
    };
}
