import { diagramActions } from '../actions/diagram-actions.ts';
import { drawingActions, drawingPreviews } from '../actions/drawing-actions.ts';
import { viewActions } from '../actions/view-actions.ts';
import type { DiagramStore } from '../projects/diagram-store.ts';
import type { DrawingStore } from '../projects/drawing-store.ts';
import { viewToolkit } from '../tools/view-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* Replaces the diagram of a view, whether or not anyone has its project open, and answers the new rev. */
        diagrams: Pick<DiagramStore, 'write'> & Partial<Pick<DiagramStore, 'read'>>;
        /* Reads and edits the drawing of a view, whether or not anyone has its project open; absent on a host that keeps none. */
        drawings?: Pick<DrawingStore, 'read' | 'edit'>;
    }
}

export const viewFeature = defineAgentFeature({
    name: 'view',
    toolkit: viewToolkit,
    actions: { ...viewActions, ...diagramActions, ...drawingActions },
    previews: drawingPreviews,
    host: ({ projects }) => ({ diagrams: projects.diagrams, drawings: projects.drawings })
});
