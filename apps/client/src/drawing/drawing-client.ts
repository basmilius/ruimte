import { isDrawingView, type DrawingContent, type DrawingDocument } from '@ruimte/contracts';
import type { DrawingState } from '@/state/drawing';
import type { EditorRegistry } from '@/state/editors';
import { FileEditorClient, type DocumentAccess, type FileEditorChannel, type FileEditorClientOptions, type ProjectAccess } from '@/state/file-editor-client';
import type { Transport } from '@/transport/transport';

const DRAWINGS: FileEditorChannel<DrawingDocument, DrawingContent> = {
    isView: isDrawingView,
    onChanged: (transport, listener) => transport.on('drawing.changed', ({ projectId, viewId, document }) => listener(projectId, viewId, document)),
    open: (transport, projectId, viewId) => transport.request('drawing.open', { projectId, viewId }).then(({ document }) => document),
    save: (transport, projectId, viewId, baseRev, content) => transport.request('drawing.save', { projectId, viewId, baseRev, content }).then(({ rev }) => rev),
    close: (transport, projectId, viewId) => transport.request('drawing.close', { projectId, viewId }),
    copy: (transport, projectId, from, to) => transport.request('drawing.copy', { projectId, from, to }),
    errors: {
        open: 'drawing:error.drawingOpen',
        save: 'drawing:error.drawingSave',
        copy: 'drawing:error.drawingCopy'
    }
};

/* Keeps the drawing on screen and its file in step. Everything it does is `FileEditorClient`. */
export class DrawingClient extends FileEditorClient<DrawingState, DrawingDocument, DrawingContent> {
    constructor(
        transport: Transport,
        drawings: EditorRegistry<DrawingState>,
        documents: DocumentAccess,
        projects: ProjectAccess,
        options: FileEditorClientOptions = {}
    ) {
        super(transport, drawings, documents, projects, DRAWINGS, options);
    }
}
