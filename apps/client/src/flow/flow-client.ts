import { isFlowView, type FlowContent, type FlowDocument } from '@ruimte/contracts';
import type { EditorRegistry } from '@/state/editors';
import { FileEditorClient, type DocumentAccess, type FileEditorChannel, type FileEditorClientOptions, type ProjectAccess } from '@/state/file-editor-client';
import type { FlowState } from '@/state/flow';
import type { Transport } from '@/transport/transport';

const FLOWS: FileEditorChannel<FlowDocument, FlowContent> = {
    isView: isFlowView,
    onChanged: (transport, listener) => transport.on('flow.changed', ({ projectId, viewId, document }) => listener(projectId, viewId, document)),
    open: (transport, projectId, viewId) => transport.request('flow.open', { projectId, viewId }).then(({ document }) => document),
    save: (transport, projectId, viewId, baseRev, content) => transport.request('flow.save', { projectId, viewId, baseRev, content }).then(({ rev }) => rev),
    close: (transport, projectId, viewId) => transport.request('flow.close', { projectId, viewId }),
    copy: (transport, projectId, from, to) => transport.request('flow.copy', { projectId, from, to }),
    errors: {
        open: 'flow:error.open',
        save: 'flow:error.save',
        copy: 'flow:error.copy'
    }
};

/* Keeps the worksheet on screen and its file in step. Everything it does is `FileEditorClient`. */
export class FlowClient extends FileEditorClient<FlowState, FlowDocument, FlowContent> {
    constructor(
        transport: Transport,
        flows: EditorRegistry<FlowState>,
        documents: DocumentAccess,
        projects: ProjectAccess,
        options: FileEditorClientOptions = {}
    ) {
        super(transport, flows, documents, projects, FLOWS, options);
    }
}
