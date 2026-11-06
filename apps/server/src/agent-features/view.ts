import { diagramActions } from '../actions/diagram-actions.ts';
import { drawingActions, drawingPreviews } from '../actions/drawing-actions.ts';
import { viewActions } from '../actions/view-actions.ts';
import { viewToolkit } from '../tools/view-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const viewFeature = defineAgentFeature({
    name: 'view',
    toolkit: viewToolkit,
    actions: { ...viewActions, ...diagramActions, ...drawingActions },
    previews: drawingPreviews,
    host: ({ projects }) => ({ diagrams: projects.diagrams, drawings: projects.drawings })
});
