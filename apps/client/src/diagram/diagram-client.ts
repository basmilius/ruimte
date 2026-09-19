import { isDiagramView, type DiagramContent, type DiagramDocument } from '@ruimte/contracts';
import type { DiagramState } from '@/state/diagram';
import type { EditorRegistry } from '@/state/editors';
import { FileEditorClient, type DocumentAccess, type FileEditorChannel, type FileEditorClientOptions, type ProjectAccess } from '@/state/file-editor-client';
import type { Transport } from '@/transport/transport';

const DIAGRAMS: FileEditorChannel<DiagramDocument, DiagramContent> = {
    isView: isDiagramView,
    onChanged: (transport, listener) => transport.on('diagram.changed', ({ projectId, viewId, document }) => listener(projectId, viewId, document)),
    open: (transport, projectId, viewId) => transport.request('diagram.open', { projectId, viewId }).then(({ document }) => document),
    save: (transport, projectId, viewId, baseRev, content) => transport.request('diagram.save', { projectId, viewId, baseRev, content }).then(({ rev }) => rev),
    close: (transport, projectId, viewId) => transport.request('diagram.close', { projectId, viewId }),
    copy: (transport, projectId, from, to) => transport.request('diagram.copy', { projectId, from, to }),
    errors: {
        open: 'drawing:error.diagramOpen',
        save: 'drawing:error.diagramSave',
        copy: 'drawing:error.diagramCopy'
    }
};

/* Keeps the diagram on screen and its file in step. Everything it does is `FileEditorClient`. */
export class DiagramClient extends FileEditorClient<DiagramState, DiagramDocument, DiagramContent> {
    constructor(
        transport: Transport,
        diagrams: EditorRegistry<DiagramState>,
        documents: DocumentAccess,
        projects: ProjectAccess,
        options: FileEditorClientOptions = {}
    ) {
        super(transport, diagrams, documents, projects, DIAGRAMS, options);
    }
}
