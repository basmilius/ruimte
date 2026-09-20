import { readFile } from 'node:fs/promises';
import { EMPTY_FLOW, FLOW_VERSION, isFlowView, type FlowContent, type FlowDocument } from '@ruimte/contracts';
import { flowProblemIn } from '@ruimte/flow';
import type { WatchSeams } from '../fs/watch-seam.ts';
import { flowsDirOf, parseFlow, privateFlowsDirOf, readFlow, viewFilePathIn, writeFlow } from './project-files.ts';
import type { ProjectStore } from './project-store.ts';
import { ProjectViewFileStore, type ViewFileKind } from './view-file-store.ts';
import { CodedError } from '../coded-error.ts';

type FlowErrorCode = 'project-not-found' | 'flow-not-found' | 'flow-invalid' | 'rev-conflict';

export class FlowError extends CodedError<FlowErrorCode> {}

const FLOW_FILES: ViewFileKind<FlowDocument, FlowContent> = {
    noun: 'flow',
    version: FLOW_VERSION,
    dirOf: flowsDirOf,
    privateDirOf: privateFlowsDirOf,
    read: readFlow,
    write: writeFlow,
    documentOf: (content, rev) => ({
        version: FLOW_VERSION,
        rev,
        ...(content.folder === undefined ? {} : { folder: content.folder }),
        cards: content.cards,
        links: content.links
    }),
    empty: EMPTY_FLOW,
    isViewOf: (projects, projectId, viewId) => projects.isFlowView(projectId, viewId),
    problemIn: flowProblemIn,
    changed: (projectId, viewId, document) => ({ event: 'flow.changed', payload: { projectId, viewId, document } }),
    projectNotFound: (message) => new FlowError('project-not-found', message),
    notFound: (message) => new FlowError('flow-not-found', message),
    invalid: (message) => new FlowError('flow-invalid', message),
    revConflict: (message) => new FlowError('rev-conflict', message)
};

/*
 * The flows of every project, one file per flow view under `.ruimte/flows`, private ones beside it.
 * The recipe and nothing else: whether a flow runs here is the switch store's, per machine.
 */
export class FlowStore extends ProjectViewFileStore<FlowDocument, FlowContent> {
    constructor(projects: ProjectStore, seams?: WatchSeams) {
        super(projects, FLOW_FILES, seams);
    }

    /*
     * The recipe of a flow in a project that may well be closed, which is how the runner reads it: a
     * flow keeps running after the person switched to another project. A file that is not a flow
     * reads as null rather than being set aside, since nobody asked for a repair here.
     */
    async read(projectId: string, viewId: string): Promise<FlowDocument | null> {
        const place = await this.projects.place(projectId).catch(() => null);
        if (!place || !place.views.some((view) => view.id === viewId && isFlowView(view))) {
            return null;
        }
        const dir = place.shared.includes(viewId) ? flowsDirOf(place.documentPath) : privateFlowsDirOf(place.documentPath);
        let text: string;
        try {
            text = await readFile(viewFilePathIn(dir, viewId), 'utf8');
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                return EMPTY_FLOW;
            }
            throw e;
        }
        const parsed = parseFlow(text);
        return parsed.kind === 'ok' ? parsed.document : null;
    }
}
